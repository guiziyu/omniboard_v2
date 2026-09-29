import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { ensurePersonDossier } from './person-dossier';
import { records } from './records';
import { conflictingClaimIds } from '../shared/claim-conflicts';
import {
  dateIsCurrent,
  type Access,
  type KnowledgeClaim,
  type KnowledgeGraph,
  type KnowledgeObject,
  type KnowledgeRelation,
} from '../shared/operations';
import type { ExplorationGraph } from '../shared/exploration';
import type { IdentityHistory, IdentitySearch } from '../shared/identities';
// 共享对象、结论、关系与跨机构身份(frontend-spec 7;data-model §3.4),从 v1 src/server/operations/
// (shared、queries、identity-index、exploration、knowledge、identities)迁移。
// v1 里个人履历上的任职机构随人才库(6.9)一起迁移;关联任务见 work.ts。

type Db = Pool | Client;
const admin = (user: User) => user.role === 'admin';

// ---- 输入约定(v1 operations/shared.ts) ----
export const text = (max = 4000) => z.string().trim().max(max);
export const dateInput = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    'Use a valid YYYY-MM-DD date.',
  );
const urlInput = text(2000).refine(
  (v) => !v || (/^https?:\/\//.test(v) && URL.canParse(v)),
  'Use an http(s) URL.',
);
export const visibilityInput = z.enum(['team', 'admin']);
const dates = { validFrom: dateInput.default(''), validUntil: dateInput.default('') };
export const reference = {
  rawText: text(100000).default(''),
  sourceUrl: urlInput.default(''),
  sourceRecordId: text(100).default(''),
};
export function checkAccess(access: Access, user: User) {
  if (access === 'admin' && !admin(user)) problem(403, 'Administrator access is required.');
}
function checkDates(from: string, until: string) {
  if (from && until && from > until)
    problem(422, 'The end date must not be before the start date.');
}
/** 引用本机构的一条记录:看不到 → 403;admin 记录不能支撑 team 对象 → 422。 */
export async function checkReference(
  client: Client,
  recordId: string,
  organizationId: string,
  access: Access,
  user: User,
) {
  if (!recordId) return undefined;
  const record = (
    await client.query<{ evidence_id: string; visibility: Access }>(
      'SELECT evidence_id, visibility FROM omniboard.module_records WHERE id = $1 AND organization_id = $2',
      [recordId, organizationId],
    )
  ).rows[0];
  if (!record) problem(404, 'The source record is not available in this organization.');
  checkAccess(record.visibility, user);
  if (record.visibility === 'admin' && access !== 'admin')
    problem(422, 'Restricted evidence requires an administrator-only item.');
  return record;
}
/** 原文优先存为新证据;否则沿用所选记录的原文;两者都没有 → 422。 */
export async function evidence(
  client: Client,
  store: EvidenceStore,
  organizationId: string,
  access: Access,
  user: User,
  input: { rawText: string; sourceUrl: string; sourceRecordId: string },
): Promise<string> {
  const record = await checkReference(client, input.sourceRecordId, organizationId, access, user);
  if (input.rawText)
    return saveEvidence(client, store, Buffer.from(input.rawText), {
      source: 'manual',
      url: input.sourceUrl,
      contentType: 'text/plain; charset=utf-8',
      visibility: access,
    });
  if (record) return record.evidence_id;
  problem(422, 'Add the original information or select an existing source record.');
}
/** 活动历史(frontend-spec 8.4)。 */
export async function event(
  client: Client,
  organizationId: string,
  targetId: string,
  kind: string,
  title: string,
  access: Access,
  user: User,
  payload: unknown,
) {
  await client.query(
    `INSERT INTO omniboard.operation_events
       (organization_id, target_id, kind, title, payload, visibility, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [organizationId, targetId, kind, title, payload, access, user.id],
  );
}
/** 身份相关写入全部串行:合并链、重定向与记录归属的检查读到的都是提交后的状态。 */
async function lockKnowledge(client: Client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('omniboard.knowledge', 0))");
}

// ---- 身份索引(v1 identity-index.ts):重定向保留原对象、证据与引用,用于撤销 ----
export async function identityIndex(db: Db, user: User) {
  const originals = (
    await db.query<
      Omit<KnowledgeObject, 'records'> & { organizationName: string; revision: number }
    >(
      `SELECT k.id, k.organization_id AS "organizationId", o.name AS "organizationName", k.kind,
              k.name, k.scope, k.visibility, k.revision
         FROM omniboard.knowledge_objects k JOIN omniboard.organizations o ON o.id = k.organization_id
        WHERE k.visibility = 'team' OR $1
        ORDER BY k.kind COLLATE "C", k.name COLLATE "C", k.id COLLATE "C"`,
      [admin(user)],
    )
  ).rows;
  const visible = new Map(originals.map((o) => [o.id, o]));
  const redirects = (
    await db.query<{ objectId: string; targetId: string }>(
      `SELECT object_id AS "objectId", target_id AS "targetId"
         FROM omniboard.knowledge_identity_redirects`,
    )
  ).rows;
  const next = new Map(
    redirects
      .filter((x) => visible.has(x.objectId) && visible.has(x.targetId))
      .map((x) => [x.objectId, x.targetId]),
  );
  const canonical = new Map<string, string>();
  for (const o of originals) {
    let cursor = o.id;
    const visited = new Set<string>();
    while (next.has(cursor)) {
      if (visited.has(cursor)) throw Error('Identity redirect cycle.');
      visited.add(cursor);
      cursor = next.get(cursor)!;
    }
    canonical.set(o.id, cursor);
  }
  const objects = new Map<string, KnowledgeObject>();
  for (const o of originals)
    if (canonical.get(o.id) === o.id) {
      const { organizationName: _name, ...header } = o;
      objects.set(o.id, { ...header, organizations: [], records: [], aliases: [] });
    }
  const addOrganization = (object: KnowledgeObject, orgId: string, name: string) => {
    if (!object.organizations!.some((o) => o.id === orgId))
      object.organizations!.push({ id: orgId, name });
  };
  for (const o of originals) {
    const object = objects.get(canonical.get(o.id)!)!;
    addOrganization(object, o.organizationId, o.organizationName);
    if (!object.aliases!.includes(o.name)) object.aliases!.push(o.name);
  }
  const linked = (
    await db.query<
      KnowledgeObject['records'][number] & {
        objectId: string;
        organizationId: string;
        organizationName: string;
      }
    >(
      `SELECT x.object_id AS "objectId", r.id, r.title, r.tab_id AS "tabId",
              r.evidence_id AS "evidenceId", r.organization_id AS "organizationId",
              o.name AS "organizationName"
         FROM omniboard.object_records x
         JOIN omniboard.module_records r ON r.id = x.record_id
         JOIN omniboard.organizations o ON o.id = r.organization_id
        WHERE r.visibility = 'team' OR $1
        ORDER BY o.name COLLATE "C", r.tab_id COLLATE "C", r.title COLLATE "C", r.id COLLATE "C"`,
      [admin(user)],
    )
  ).rows;
  for (const { objectId, ...record } of linked) {
    const object = objects.get(canonical.get(objectId) || '');
    if (!object) continue;
    if (!object.records.some((r) => r.id === record.id)) object.records.push(record);
    addOrganization(object, record.organizationId, record.organizationName);
  }
  return { objects: [...objects.values()], canonical };
}
export async function getObject(db: Db, user: User, objectId: string) {
  const index = await identityIndex(db, user);
  return (
    index.objects.find((o) => o.id === index.canonical.get(objectId)) ??
    problem(404, 'Object not found.')
  );
}
export async function objectRows(db: Db, user: User, orgId = '') {
  return (await identityIndex(db, user)).objects.filter(
    (o) => !orgId || o.organizations?.some((org) => org.id === orgId),
  );
}

// ---- 读模型(v1 queries.ts) ----
export async function claimRows(
  db: Db,
  user: User,
  today: string,
  orgId = '',
  index?: Awaited<ReturnType<typeof identityIndex>>,
): Promise<KnowledgeClaim[]> {
  index ??= await identityIndex(db, user);
  const relevant = new Set(
    index.objects
      .filter((o) => !orgId || o.organizations?.some((org) => org.id === orgId))
      .map((o) => o.id),
  );
  const claims = (
    await db.query<
      Omit<KnowledgeClaim, 'current' | 'conflict' | 'recordedAt'> & { recordedAt: Date }
    >(
      `SELECT c.id, c.object_id AS "objectId", c.field, c.value, c.scope,
              COALESCE(c.valid_from, '') AS "validFrom", COALESCE(c.valid_until, '') AS "validUntil",
              COALESCE(c.observed_on, '') AS "observedOn", c.recorded_at AS "recordedAt", c.status,
              c.evidence_id AS "evidenceId", COALESCE(c.source_record_id, '') AS "sourceRecordId",
              c.revision, c.organization_id AS "organizationId", o.name AS "organizationName"
         FROM omniboard.knowledge_claims c
         JOIN omniboard.knowledge_objects k ON k.id = c.object_id
         JOIN omniboard.organizations o ON o.id = c.organization_id
        WHERE k.visibility = 'team' OR $1
        ORDER BY c.recorded_at DESC, c.id`,
      [admin(user)],
    )
  ).rows
    .map((c) => ({
      ...c,
      recordedAt: c.recordedAt.toISOString(),
      objectId: index.canonical.get(c.objectId) || c.objectId,
      current: c.status !== 'superseded' && dateIsCurrent(c.validFrom, c.validUntil, today),
      conflict: false,
    }))
    .filter((c) => relevant.has(c.objectId));
  const conflicts = conflictingClaimIds(claims);
  return claims.map((c) => ({ ...c, conflict: conflicts.has(c.id) }));
}
export async function knowledgeGraph(
  db: Db,
  user: User,
  today: string,
  orgId = '',
): Promise<KnowledgeGraph> {
  const index = await identityIndex(db, user);
  const available = new Set(index.objects.map((o) => o.id));
  const direct = new Set(
    index.objects
      .filter((o) => !orgId || o.organizations?.some((org) => org.id === orgId))
      .map((o) => o.id),
  );
  const relations: KnowledgeRelation[] = (
    await db.query<Omit<KnowledgeRelation, 'current'>>(
      `SELECT r.id, r.from_id AS "fromId", r.to_id AS "toId", r.label, r.certainty,
              COALESCE(r.valid_from, '') AS "validFrom", COALESCE(r.valid_until, '') AS "validUntil",
              r.evidence_id AS "evidenceId"
         FROM omniboard.knowledge_relations r
         JOIN omniboard.knowledge_objects k ON k.id = r.from_id
        WHERE k.visibility = 'team' OR $1`,
      [admin(user)],
    )
  ).rows
    .map((r) => ({
      ...r,
      fromId: index.canonical.get(r.fromId) || r.fromId,
      toId: index.canonical.get(r.toId) || r.toId,
    }))
    .filter(
      (r) =>
        r.fromId !== r.toId &&
        available.has(r.fromId) &&
        available.has(r.toId) &&
        (direct.has(r.fromId) || direct.has(r.toId)),
    )
    .map((r) => ({ ...r, current: dateIsCurrent(r.validFrom, r.validUntil, today) }));
  const ids = new Set([...direct, ...relations.flatMap((r) => [r.fromId, r.toId])]);
  const objects = index.objects.filter((o) => ids.has(o.id));
  const claims = (await claimRows(db, user, today, '', index)).filter((c) => ids.has(c.objectId));
  const claimIds = new Set(claims.map((c) => c.id));
  const recordRows = (
    await db.query<KnowledgeGraph['records'][number]>(
      `SELECT id, title, tab_id AS "tabId", evidence_id AS "evidenceId", visibility
         FROM omniboard.module_records
        WHERE organization_id = $1 AND (visibility = 'team' OR $2)
        ORDER BY tab_id COLLATE "C", title COLLATE "C"`,
      [orgId, admin(user)],
    )
  ).rows;
  const decisions = (
    await db.query<{
      payload: { claimId?: string; reason?: string };
      createdAt: Date;
      author: string;
    }>(
      `SELECT e.payload, e.created_at AS "createdAt", m.name AS author
         FROM omniboard.operation_events e JOIN omniboard.member m ON m.id = e.author_id
        WHERE e.kind = 'claim' AND (e.visibility = 'team' OR $1)
        ORDER BY e.id DESC`,
      [admin(user)],
    )
  ).rows.flatMap((e) =>
    e.payload.claimId && claimIds.has(e.payload.claimId) && e.payload.reason
      ? [
          {
            claimId: e.payload.claimId,
            reason: e.payload.reason,
            author: e.author,
            createdAt: e.createdAt.toISOString(),
          },
        ]
      : [],
  );
  return { objects, claims, relations, records: recordRows, decisions };
}
/** 关系页的读模型(7.4):本机构可见记录,加上共享对象关联的其他机构记录;浏览不写入任何数据。 */
export async function exploration(
  pool: Pool,
  organization: { id: string; name: string },
  user: User,
  today: string,
): Promise<Omit<ExplorationGraph, 'tasks'>> {
  const graph = await knowledgeGraph(pool, user, today, organization.id);
  const contextRecords = await records(pool, organization.id, '', user.role);
  const known = new Set(contextRecords.map((r) => r.id));
  const external = new Map<string, Set<string>>();
  for (const object of graph.objects)
    for (const record of object.records)
      if (record.organizationId && record.organizationId !== organization.id) {
        const ids = external.get(record.organizationId) || new Set<string>();
        ids.add(record.id);
        external.set(record.organizationId, ids);
      }
  for (const [orgId, ids] of external)
    for (const record of await records(pool, orgId, '', user.role))
      if (ids.has(record.id) && !known.has(record.id)) {
        contextRecords.push(record);
        known.add(record.id);
      }
  const objectIds = new Set(graph.objects.map((o) => o.id));
  const evidenceIds = [
    ...new Set(
      [
        ...contextRecords.flatMap((r) => [r.evidenceId, r.relationshipEvidenceId || '']),
        ...graph.claims.map((c) => c.evidenceId),
        ...graph.relations.map((r) => r.evidenceId),
      ].filter(Boolean),
    ),
  ];
  const references = (
    await pool.query<{ id: string; source: string; url: string; capturedAt: Date }>(
      `SELECT id, source, url, captured_at AS "capturedAt" FROM omniboard.evidence
        WHERE id = ANY($1) AND (visibility = 'team' OR $2)`,
      [evidenceIds, admin(user)],
    )
  ).rows;
  const index = await identityIndex(pool, user);
  return {
    ...graph,
    organization: { id: organization.id, name: organization.name },
    contextRecords,
    identityAliases: Object.fromEntries(
      [...index.canonical].filter(
        ([alias, canonical]) => alias !== canonical && objectIds.has(canonical),
      ),
    ),
    records: contextRecords.map((r) => ({
      id: r.id,
      title: r.title,
      tabId: r.tabId,
      evidenceId: r.evidenceId,
      visibility: r.visibility,
    })),
    references: Object.fromEntries(
      references.map(({ id: key, capturedAt, ...ref }) => [
        key,
        { ...ref, capturedAt: capturedAt.toISOString() },
      ]),
    ),
  };
}

// ---- 共享对象(7.10) ----
export const objectInput = z
  .object({
    kind: z.enum(['person', 'account', 'capability', 'resource']),
    name: text(160).min(1),
    scope: text(500).min(1),
    visibility: visibilityInput,
    sourceRecordId: text(100).min(1),
  })
  .strict();
export async function createObject(
  pool: Pool,
  user: User,
  organizationId: string,
  input: z.infer<typeof objectInput>,
): Promise<{ id: string }> {
  checkAccess(input.visibility, user);
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    await checkReference(client, input.sourceRecordId, organizationId, input.visibility, user);
    if (input.kind === 'person') {
      // 记录已有人员档案时复用它;还没动过的自动档案改用新名称和范围。
      const existingId = await ensurePersonDossier(client, input.sourceRecordId);
      if (existingId) {
        const existing = await getObject(client, user, existingId);
        if (existing.visibility !== input.visibility)
          problem(422, 'Choose a person with the same access level.');
        if (
          existing.id.startsWith('person-record:') &&
          existing.revision === 1 &&
          existing.scope === 'Personnel dossier'
        )
          await client.query(
            'UPDATE omniboard.knowledge_objects SET name = $2, scope = $3, updated_at = now() WHERE id = $1',
            [existing.id, input.name, input.scope],
          );
        return { id: existing.id };
      }
    }
    const objectId = id();
    await client.query(
      `INSERT INTO omniboard.knowledge_objects (id, organization_id, kind, name, scope, visibility)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [objectId, organizationId, input.kind, input.name, input.scope, input.visibility],
    );
    await client.query(
      'INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1, $2)',
      [objectId, input.sourceRecordId],
    );
    await event(
      client,
      organizationId,
      objectId,
      'object',
      `Object added · ${input.name}`,
      input.visibility,
      user,
      input,
    );
    return { id: objectId };
  });
}

// ---- 结论(7.11、7.13) ----
export const claimInput = z
  .object({
    field: text(100).min(1),
    value: text(2000).min(1),
    scope: text(500).min(1),
    ...dates,
    observedOn: dateInput.default(''),
    organizationId: text(100).optional(),
    ...reference,
  })
  .strict();
/** 引用记录所在的机构(退役记录、退役机构和看不到的记录都 → 404);没有引用时用 fallback。 */
async function referenceOrganization(
  client: Client,
  user: User,
  recordId: string,
  fallback: string,
): Promise<string> {
  if (!recordId) return fallback;
  const row = (
    await client.query<{ organization_id: string }>(
      `SELECT r.organization_id FROM omniboard.module_records r
        WHERE r.id = $1 AND (r.visibility = 'team' OR $2)
          AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a
                           WHERE a.alias_id = r.organization_id)`,
      [recordId, admin(user)],
    )
  ).rows[0];
  return row?.organization_id ?? problem(404, 'Source record not found.');
}
export async function addClaim(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  objectId: string,
  input: z.infer<typeof claimInput>,
  today: string,
): Promise<{ id: string }> {
  checkDates(input.validFrom, input.validUntil);
  if (input.observedOn && input.observedOn > today)
    problem(422, 'An observation date cannot be in the future.');
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const obj = await getObject(client, user, objectId);
    const contextOrg = await referenceOrganization(
      client,
      user,
      input.sourceRecordId,
      input.organizationId || obj.organizationId,
    );
    if (!obj.organizations?.some((o) => o.id === contextOrg))
      problem(422, 'Link this identity to the organization before adding its evidence.');
    const evidenceId = await evidence(client, store, contextOrg, obj.visibility, user, input);
    const claimId = id();
    await client.query(
      `INSERT INTO omniboard.knowledge_claims
         (id, object_id, field, value, scope, valid_from, valid_until, observed_on, status,
          evidence_id, source_record_id, organization_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'reported',$9,$10,$11)`,
      [
        claimId,
        obj.id,
        input.field,
        input.value,
        input.scope,
        input.validFrom || null,
        input.validUntil || null,
        input.observedOn || null,
        evidenceId,
        input.sourceRecordId || null,
        contextOrg,
      ],
    );
    await event(
      client,
      obj.organizationId,
      obj.id,
      'claim',
      `Evidence added · ${obj.name} · ${input.field}`,
      obj.visibility,
      user,
      { ...input, evidenceId, claimId },
    );
    return { id: claimId };
  });
}
export const acceptInput = z
  .object({ revision: z.number().int().positive(), reason: text().min(1) })
  .strict();
/** 采纳:同对象、同机构、同字段、同 scope 的其他当前结论变为 superseded,本条变为 accepted。 */
export async function acceptClaim(
  pool: Pool,
  user: User,
  claimId: string,
  input: z.infer<typeof acceptInput>,
  today: string,
) {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const claims = await claimRows(client, user, today);
    const claim = claims.find((c) => c.id === claimId) ?? problem(404, 'Evidence claim not found.');
    if (input.revision !== claim.revision)
      problem(409, 'This evidence changed. Reload before reviewing.');
    if (!claim.current)
      problem(422, 'Only a currently valid claim can be adopted. Add updated evidence first.');
    const obj = await getObject(client, user, claim.objectId);
    const superseded = claims.filter(
      (c) =>
        c.id !== claim.id &&
        c.objectId === obj.id &&
        c.field === claim.field &&
        c.scope === claim.scope &&
        c.organizationId === claim.organizationId &&
        c.current,
    );
    await client.query(
      `UPDATE omniboard.knowledge_claims SET status = 'superseded', revision = revision + 1
        WHERE id = ANY($1)`,
      [superseded.map((c) => c.id)],
    );
    await client.query(
      `UPDATE omniboard.knowledge_claims SET status = 'accepted', revision = revision + 1
        WHERE id = $1`,
      [claim.id],
    );
    await event(
      client,
      obj.organizationId,
      obj.id,
      'claim',
      `Evidence reviewed · ${obj.name} · ${claim.field}`,
      obj.visibility,
      user,
      { claimId: claim.id, reason: input.reason, supersededIds: superseded.map((c) => c.id) },
    );
    return { ok: true };
  });
}

// ---- 连接对象(7.10) ----
export const relationInput = z
  .object({
    fromId: text(100).min(1),
    toId: text(100).min(1),
    label: text(120).min(1),
    certainty: z.enum(['confirmed', 'unconfirmed']),
    ...dates,
    ...reference,
  })
  .strict();
export async function addRelation(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  input: z.infer<typeof relationInput>,
): Promise<{ id: string }> {
  checkDates(input.validFrom, input.validUntil);
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const from = await getObject(client, user, input.fromId);
    const to = await getObject(client, user, input.toId);
    if (from.id === to.id) problem(422, 'Choose two different identities.');
    if (from.visibility !== to.visibility)
      problem(422, 'Connected objects must have the same access level.');
    const contextOrg = await referenceOrganization(
      client,
      user,
      input.sourceRecordId,
      from.organizationId,
    );
    if (
      !from.organizations?.some((o) => o.id === contextOrg) &&
      !to.organizations?.some((o) => o.id === contextOrg)
    )
      problem(422, 'Use evidence from an organization associated with these identities.');
    const evidenceId = await evidence(client, store, contextOrg, from.visibility, user, input);
    const relationId = id();
    await client.query(
      `INSERT INTO omniboard.knowledge_relations
         (id, from_id, to_id, label, certainty, valid_from, valid_until, evidence_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        relationId,
        from.id,
        to.id,
        input.label,
        input.certainty,
        input.validFrom || null,
        input.validUntil || null,
        evidenceId,
      ],
    );
    await event(
      client,
      from.organizationId,
      from.id,
      'relation',
      `${from.name} → ${to.name}`,
      from.visibility,
      user,
      { ...input, evidenceId },
    );
    return { id: relationId };
  });
}

// ---- 跨机构身份(7.14,v1 identities.ts) ----
/** 每个身份决定都记下理由、操作人、时间和独立的决定证据,并使对象 revision +1。 */
async function identityDecision(
  client: Client,
  store: EvidenceStore,
  user: User,
  obj: KnowledgeObject,
  kind: IdentityHistory['kind'],
  reason: string,
  otherId: string | null = null,
  recordId: string | null = null,
  reversesId: string | null = null,
) {
  const evidenceId = await saveEvidence(
    client,
    store,
    Buffer.from(JSON.stringify({ kind, identityId: obj.id, otherId, recordId, reason }, null, 2)),
    {
      source: 'manual',
      url: '',
      contentType: 'application/json',
      filename: 'identity-decision.json',
      visibility: obj.visibility,
    },
  );
  await client.query(
    `INSERT INTO omniboard.knowledge_identity_events
       (id, object_id, other_id, record_id, kind, reason, evidence_id, author_id, reverses_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id(), obj.id, otherId, recordId, kind, reason, evidenceId, user.id, reversesId],
  );
  await client.query(
    'UPDATE omniboard.knowledge_objects SET revision = revision + 1, updated_at = now() WHERE id = $1',
    [obj.id],
  );
  await event(
    client,
    obj.organizationId,
    obj.id,
    'identity',
    `Identity updated · ${obj.name}`,
    obj.visibility,
    user,
    { kind, reason, evidenceId, otherId, recordId },
  );
}
export const linkInput = z
  .object({
    recordId: text(100).min(1),
    reason: text(4000).default(''),
    revision: z.number().int().positive().optional(),
  })
  .strict();
export async function linkIdentityRecord(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  objectId: string,
  input: z.infer<typeof linkInput>,
): Promise<{ id: string }> {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const obj = await getObject(client, user, objectId);
    if (input.revision !== undefined && obj.revision !== input.revision)
      problem(409, 'This identity changed. Refresh and try again.');
    const orgId = await referenceOrganization(client, user, input.recordId, obj.organizationId);
    await checkReference(client, input.recordId, orgId, obj.visibility, user);
    if (orgId !== obj.organizationId && !input.reason.trim())
      problem(422, 'Explain why these records describe the same identity.');
    const index = await identityIndex(client, user);
    const occupied = index.objects.find(
      (o) =>
        o.id !== obj.id && o.kind === obj.kind && o.records.some((r) => r.id === input.recordId),
    );
    if (occupied)
      problem(
        409,
        'This record already has an identity of this type. Review an identity merge instead.',
      );
    if (obj.records.some((r) => r.id === input.recordId)) return { id: obj.id };
    await client.query(
      'INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1, $2)',
      [obj.id, input.recordId],
    );
    await identityDecision(
      client,
      store,
      user,
      obj,
      'link',
      input.reason.trim() || 'Linked an existing source record.',
      null,
      input.recordId,
    );
    return { id: obj.id };
  });
}
export const mergeInput = z
  .object({
    otherId: text(100).min(1),
    revision: z.number().int().positive(),
    otherRevision: z.number().int().positive(),
    reason: text(4000).min(1),
  })
  .strict();
/** 把 other 合并进 target(target 保留);只有同类型、同可见性的身份能合并。 */
export async function mergeIdentities(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  targetId: string,
  input: z.infer<typeof mergeInput>,
): Promise<{ id: string }> {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const target = await getObject(client, user, targetId);
    const source = await getObject(client, user, input.otherId);
    if (target.id === source.id) problem(422, 'These records already share an identity.');
    if (target.kind !== source.kind || target.visibility !== source.visibility)
      problem(422, 'Only identities of the same type and access level can be merged.');
    if (target.revision !== input.revision || source.revision !== input.otherRevision)
      problem(409, 'This identity changed. Refresh and try again.');
    await client.query(
      'INSERT INTO omniboard.knowledge_identity_redirects (object_id, target_id) VALUES ($1, $2)',
      [source.id, target.id],
    );
    await client.query(
      'UPDATE omniboard.knowledge_objects SET revision = revision + 1, updated_at = now() WHERE id = $1',
      [source.id],
    );
    await identityDecision(client, store, user, target, 'merge', input.reason, source.id);
    return { id: target.id };
  });
}
export const undoInput = z
  .object({
    eventId: text(100).min(1),
    revision: z.number().int().positive(),
    reason: text(4000).min(1),
  })
  .strict();
/** 撤销合并:链式合并必须先撤销后发生的那次;重复撤销 → 409。 */
export async function undoMerge(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  targetId: string,
  input: z.infer<typeof undoInput>,
): Promise<{ id: string }> {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const target = await getObject(client, user, targetId);
    if (target.revision !== input.revision)
      problem(409, 'This identity changed. Refresh and try again.');
    const merge = (
      await client.query<{ other_id: string }>(
        `SELECT e.other_id FROM omniboard.knowledge_identity_events e
          WHERE e.id = $1 AND e.object_id = $2 AND e.kind = 'merge'
            AND NOT EXISTS (SELECT 1 FROM omniboard.knowledge_identity_events r WHERE r.reverses_id = e.id)
            AND EXISTS (SELECT 1 FROM omniboard.knowledge_identity_redirects x
                         WHERE x.object_id = e.other_id AND x.target_id = e.object_id)`,
        [input.eventId, target.id],
      )
    ).rows[0];
    if (!merge) problem(409, 'This merge can no longer be undone from this identity.');
    await client.query(
      'DELETE FROM omniboard.knowledge_identity_redirects WHERE object_id = $1 AND target_id = $2',
      [merge.other_id, target.id],
    );
    await client.query(
      'UPDATE omniboard.knowledge_objects SET revision = revision + 1, updated_at = now() WHERE id = $1',
      [merge.other_id],
    );
    await identityDecision(
      client,
      store,
      user,
      target,
      'undo_merge',
      input.reason,
      merge.other_id,
      null,
      input.eventId,
    );
    return { id: target.id };
  });
}
export const unlinkInput = z
  .object({
    recordId: text(100).min(1),
    revision: z.number().int().positive(),
    reason: text(4000).min(1),
  })
  .strict();
/** 取消关联:不删除记录,之后可以重新关联;对象的最后一条记录不能取消关联。 */
export async function unlinkRecord(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  objectId: string,
  input: z.infer<typeof unlinkInput>,
): Promise<{ id: string }> {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const index = await identityIndex(client, user);
    const obj = await getObject(client, user, objectId);
    if (obj.revision !== input.revision)
      problem(409, 'This identity changed. Refresh and try again.');
    if (!obj.records.some((r) => r.id === input.recordId)) problem(404, 'Source record not found.');
    if (obj.records.length < 2) problem(422, 'Keep at least one source record for this identity.');
    const members = [...index.canonical].filter(([, c]) => c === obj.id).map(([m]) => m);
    await client.query(
      'DELETE FROM omniboard.object_records WHERE object_id = ANY($1) AND record_id = $2',
      [members, input.recordId],
    );
    await identityDecision(client, store, user, obj, 'unlink', input.reason, null, input.recordId);
    return { id: obj.id };
  });
}
export const searchInput = z.object({
  q: text(160).default(''),
  kind: z.enum(['person', 'account', 'capability', 'resource']).optional(),
});
/** 关联对话框的候选:共享身份与未关联记录;退役记录和退役机构不出现。 */
export async function identitySearch(
  pool: Pool,
  user: User,
  input: z.infer<typeof searchInput>,
): Promise<IdentitySearch> {
  const index = await identityIndex(pool, user);
  const needle = input.q.toLowerCase();
  const objects = index.objects
    .filter(
      (o) =>
        (!input.kind || o.kind === input.kind) &&
        [o.name, ...(o.aliases || []), o.scope, ...(o.organizations || []).map((org) => org.name)]
          .join(' ')
          .toLowerCase()
          .includes(needle),
    )
    .slice(0, 40);
  const rows = (
    await pool.query<Omit<IdentitySearch['records'][number], 'objectIds'>>(
      `SELECT r.id, r.title, r.person_name AS "personName", r.tab_id AS "tabId",
              r.organization_id AS "organizationId", o.name AS "organizationName",
              r.evidence_id AS "evidenceId", r.visibility
         FROM omniboard.module_records r JOIN omniboard.organizations o ON o.id = r.organization_id
        WHERE NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
          AND (r.visibility = 'team' OR $1)
          AND ($2 <> 'person' OR r.person_name <> '')
          AND strpos(lower(r.person_name || ' ' || r.title || ' ' || o.name), $3) > 0
        ORDER BY o.name COLLATE "C", r.person_name COLLATE "C", r.title COLLATE "C" LIMIT 40`,
      [admin(user), input.kind ?? '', needle],
    )
  ).rows;
  return {
    objects,
    records: rows.map((r) => ({
      ...r,
      objectIds: index.objects
        .filter(
          (o) =>
            (!input.kind || o.kind === input.kind) &&
            o.records.some((record) => record.id === r.id),
        )
        .map((o) => o.id),
    })),
  };
}
export async function identityHistory(
  pool: Pool,
  user: User,
  objectId: string,
): Promise<{ object: KnowledgeObject; history: IdentityHistory[] }> {
  const index = await identityIndex(pool, user);
  const object = await getObject(pool, user, objectId);
  const rows = (
    await pool.query<
      Omit<IdentityHistory, 'canUndo' | 'createdAt'> & {
        objectId: string;
        otherId: string | null;
        reversesId: string | null;
        createdAt: Date;
        redirected: boolean;
      }
    >(
      `SELECT e.id, e.object_id AS "objectId", e.other_id AS "otherId", e.kind, e.reason,
              e.evidence_id AS "evidenceId", m.name AS author, e.created_at AS "createdAt",
              COALESCE(k.name, '') AS "otherName", COALESCE(r.title, '') AS "recordTitle",
              e.reverses_id AS "reversesId",
              EXISTS (SELECT 1 FROM omniboard.knowledge_identity_redirects x
                       WHERE x.object_id = e.other_id AND x.target_id = e.object_id) AS redirected
         FROM omniboard.knowledge_identity_events e
         JOIN omniboard.member m ON m.id = e.author_id
         JOIN omniboard.knowledge_objects owner ON owner.id = e.object_id
         LEFT JOIN omniboard.knowledge_objects k ON k.id = e.other_id
         LEFT JOIN omniboard.module_records r ON r.id = e.record_id
        WHERE owner.visibility = 'team' OR $1
        ORDER BY e.created_at DESC, e.id DESC`,
      [admin(user)],
    )
  ).rows;
  const undone = new Set(rows.map((r) => r.reversesId));
  const history = rows
    .filter(
      (e) =>
        index.canonical.get(e.objectId) === object.id ||
        index.canonical.get(e.otherId ?? '') === object.id,
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      reason: e.reason,
      evidenceId: e.evidenceId,
      author: e.author,
      createdAt: e.createdAt.toISOString(),
      otherName: e.otherName,
      recordTitle: e.recordTitle,
      canUndo: e.kind === 'merge' && !undone.has(e.id) && e.objectId === object.id && e.redirected,
    }));
  return { object, history };
}
