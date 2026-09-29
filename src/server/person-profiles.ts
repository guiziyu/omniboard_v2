import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { checkAccess, getObject, identityIndex, lockKnowledge, mergeInto } from './knowledge';
import { ensurePersonDossier } from './person-dossier';
import { getOrganization } from './organizations';
import { writeHistory } from './records';
import { event } from './operation-log';
import {
  careerTransitionProblem,
  personProfileSchema,
  personSourceKey,
  type CareerPositionInput,
  type PersonCareer,
  type PersonProfileInput,
  type PersonSourceProfile,
} from '../shared/person-profile';
import type { Visibility } from '../shared/types';
// 个人履历(frontend-spec 6.12–6.15;data-model §3.4),从 v1 src/server/person-profiles.ts 迁移。
// 一个个人主页对应一个人;任职按来源 key 稳定;只有已映射机构、明确分类的任职生成人员变动。

type Db = Pool | Client;
const admin = (user: User) => user.role === 'admin';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const normalizedName = (v: string) =>
  v
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
/** jsonb 不保留键序:比较结构化内容时按键排序,并像 JSON.stringify 一样去掉 undefined。 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export type ProfileData = { sources: PersonSourceProfile[]; careers: PersonCareer[] };
/** 可见的履历来源与任职,按规范人员对象分组;没有可见采集的来源不出现。 */
export async function profileIndex(
  db: Db,
  user: User,
  canonicalIds: Map<string, string>,
): Promise<Map<string, ProfileData>> {
  const profiles = (
    await db.query<
      Omit<PersonSourceProfile, 'captures' | 'note' | 'updatedAt'> & {
        updatedAt: Date;
      }
    >(
      `SELECT p.id, p.object_id AS "objectId", p.provider, p.url, p.revision, p.visibility,
              p.updated_at AS "updatedAt"
         FROM omniboard.person_source_profiles p
         JOIN omniboard.knowledge_objects k ON k.id = p.object_id
        WHERE (p.visibility = 'team' OR $1) AND (k.visibility = 'team' OR $1)
        ORDER BY p.updated_at DESC, p.id`,
      [admin(user)],
    )
  ).rows;
  const ids = profiles.map((p) => p.id);
  const captures = (
    await db.query<{
      id: string;
      profileId: string;
      evidenceId: string;
      observedOn: string;
      createdAt: Date;
      author: string;
      note: string;
    }>(
      `SELECT c.id, c.profile_id AS "profileId", c.evidence_id AS "evidenceId",
              c.observed_on AS "observedOn", c.created_at AS "createdAt", m.name AS author,
              COALESCE(c.payload->>'note', '') AS note
         FROM omniboard.person_profile_captures c
         JOIN omniboard.member m ON m.id = c.author_id
        WHERE c.profile_id = ANY($1)
        ORDER BY c.seq DESC`,
      [ids],
    )
  ).rows;
  const positions = (
    await db.query<{
      id: string;
      profileId: string;
      data: CareerPositionInput;
      evidenceId: string;
      updatedAt: Date;
    }>(
      `SELECT id, profile_id AS "profileId", data, evidence_id AS "evidenceId",
              updated_at AS "updatedAt"
         FROM omniboard.person_profile_positions WHERE profile_id = ANY($1)`,
      [ids],
    )
  ).rows;
  const result = new Map<string, ProfileData>();
  for (const p of profiles) {
    const own = captures.filter((c) => c.profileId === p.id);
    if (!own.length) continue;
    const objectId = canonicalIds.get(p.objectId);
    if (!objectId) continue;
    const entry = result.get(objectId) ?? { sources: [], careers: [] };
    result.set(objectId, entry);
    entry.sources.push({
      ...p,
      updatedAt: p.updatedAt.toISOString(),
      note: own[0]!.note,
      captures: own.map(({ profileId: _profile, createdAt, ...c }) => ({
        ...c,
        createdAt: createdAt.toISOString(),
      })),
    });
    for (const { data, updatedAt, ...row } of positions.filter((x) => x.profileId === p.id))
      entry.careers.push({
        ...data,
        ...row,
        updatedAt: updatedAt.toISOString(),
        provider: p.provider,
      });
  }
  for (const entry of result.values())
    entry.careers.sort(
      (a, b) =>
        Number(b.tenure === 'current') - Number(a.tenure === 'current') ||
        b.start.localeCompare(a.start) ||
        a.id.localeCompare(b.id),
    );
  return result;
}
export async function personProfileData(db: Db, user: User, objectId: string) {
  const index = await identityIndex(db, user);
  return (
    (await profileIndex(db, user, index.canonical)).get(objectId) ?? { sources: [], careers: [] }
  );
}

// ---- 由任职生成的人员变动(6.14) ----
type Saved = { id: string; evidenceId: string; position: CareerPositionInput };
type Owner = { profileId: string; objectId: string; personName: string; visibility: Visibility };
async function writeCareerRecord(
  client: Client,
  user: User,
  owner: Owner,
  current: Saved,
  kind: 'start' | 'end',
  previous?: Saved,
  next?: Saved,
) {
  const p = current.position;
  if (!p.organizationId) return;
  const existing = (
    await client.query<{
      id: string;
      organization_id: string;
      title: string;
      body: string;
      person_name: string;
      event_type: string;
      event_date: string | null;
      structured: Record<string, string>;
      evidence_id: string;
      revision: number;
    }>(
      `SELECT r.id, r.organization_id, r.title, r.body, r.person_name, r.event_type, r.event_date,
              r.structured, r.evidence_id, r.revision
         FROM omniboard.person_profile_records x
         JOIN omniboard.module_records r ON r.id = x.record_id
        WHERE x.position_id = $1 AND x.kind = $2`,
      [current.id, kind],
    )
  ).rows[0];
  // 不从缺失的职位或新的采集推断入职 / 离职。
  const eventType =
    kind === 'end'
      ? p.endedEmployment
        ? 'left'
        : ''
      : p.changeType === 'unknown'
        ? ''
        : p.changeType;
  if (!eventType && !existing) return;
  const date = kind === 'end' ? p.end : p.start;
  const linked = (kind === 'start' && previous) || (kind === 'end' && next);
  const structured: Record<string, string> = {
    role: p.role,
    dateBasis: 'effective',
    eventDatePrecision: !date
      ? 'unknown'
      : date.length === 4
        ? 'year'
        : date.length === 7
          ? 'month'
          : 'day',
    dateLabel:
      'Employment dates reported on the personal profile; precision is preserved, not independently verified.',
    ...(kind === 'end'
      ? { fromOrganization: p.organizationName, fromRole: p.role }
      : { toOrganization: p.organizationName, toRole: p.role }),
    ...(kind === 'start' && previous
      ? {
          fromOrganization: previous.position.organizationName,
          fromRole: previous.position.role,
          previousCareerPositionId: previous.id,
          previousRoleEvidenceId: previous.evidenceId,
        }
      : {}),
    ...(kind === 'end' && next
      ? {
          toOrganization: next.position.organizationName,
          toRole: next.position.role,
          nextCareerPositionId: next.id,
          nextRoleEvidenceId: next.evidenceId,
        }
      : {}),
    ...(linked
      ? {
          transitionBasis: (
            kind === 'start' ? p.previousPositionKey : next?.position.previousPositionKey
          )
            ? 'explicit_profile_transition'
            : 'adjacent_profile_roles',
          previousRoleEnd: kind === 'start' ? previous!.position.end : p.end,
          nextRoleStart: kind === 'end' ? next!.position.start : p.start,
          movementGroupId: `career:${owner.profileId}:${kind === 'start' ? previous!.id : current.id}:${kind === 'end' ? next!.id : current.id}`,
        }
      : {}),
    personProfileId: owner.profileId,
    careerPositionId: current.id,
  };
  const label =
    eventType === 'left'
      ? 'Departure'
      : eventType === 'role_change'
        ? 'Role change'
        : eventType === 'joined'
          ? 'Joined'
          : 'Career entry';
  const title = `${owner.personName} · ${label} · ${p.role}`;
  const body = `${p.organizationName} · ${p.role}\n${p.start || 'Start not published'} – ${p.tenure === 'current' ? 'Present' : p.end || 'End not published'}\n${p.note}`;
  if (
    existing &&
    existing.organization_id === p.organizationId &&
    existing.title === title &&
    existing.body === body &&
    existing.person_name === owner.personName &&
    existing.event_type === eventType &&
    (existing.event_date ?? '') === date &&
    canonical(existing.structured) === canonical(structured) &&
    existing.evidence_id === current.evidenceId
  )
    return;
  const recordId = existing?.id ?? id();
  const revision = (existing?.revision ?? 0) + 1;
  if (existing)
    await client.query(
      `UPDATE omniboard.module_records
          SET organization_id = $2, title = $3, body = $4, person_name = $5, event_type = $6,
              event_date = $7, structured = $8, evidence_id = $9, revision = $10, author_id = $11,
              updated_at = now()
        WHERE id = $1`,
      [
        recordId,
        p.organizationId,
        title,
        body,
        owner.personName,
        eventType,
        date || null,
        structured,
        current.evidenceId,
        revision,
        user.id,
      ],
    );
  else {
    await client.query(
      `INSERT INTO omniboard.module_records
         (id, organization_id, tab_id, title, body, scope, status, visibility, person_name,
          event_type, event_date, structured, evidence_id, revision, author_id)
       VALUES ($1,$2,'people_movements',$3,$4,'Personal profile','unverified',$5,$6,$7,$8,$9,$10,1,$11)`,
      [
        recordId,
        p.organizationId,
        title,
        body,
        owner.visibility,
        owner.personName,
        eventType,
        date || null,
        structured,
        current.evidenceId,
        user.id,
      ],
    );
    await client.query(
      'INSERT INTO omniboard.person_profile_records (position_id, kind, record_id) VALUES ($1,$2,$3)',
      [current.id, kind, recordId],
    );
    await client.query(
      'INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [owner.objectId, recordId],
    );
  }
  await writeHistory(
    client,
    recordId,
    existing ? 'record_updated' : 'record_created',
    revision,
    user.id,
  );
}

/** 按保存后的完整履历(含本次没提交的旧条目)重算所有生成的事件;违反衔接规则 → 422,整批不写。 */
async function refreshCareerRecords(client: Client, user: User, owner: Owner) {
  const positions: Saved[] = (
    await client.query<{ id: string; data: CareerPositionInput; evidence_id: string }>(
      `SELECT id, data, evidence_id FROM omniboard.person_profile_positions
        WHERE profile_id = $1 ORDER BY source_key COLLATE "C"`,
      [owner.profileId],
    )
  ).rows.map((row) => ({ id: row.id, evidenceId: row.evidence_id, position: row.data }));
  const problemText = careerTransitionProblem(positions.map((row) => row.position));
  if (problemText) problem(422, problemText);
  const explicitlyUsed = new Set(
    positions.map((row) => row.position.previousPositionKey).filter(Boolean),
  );
  const priorCandidates = (current: Saved) => {
    const p = current.position;
    if (p.previousPositionKey)
      return positions.filter((row) => row.position.key === p.previousPositionKey);
    if (!p.start || !p.organizationId || p.changeType === 'unknown') return [];
    return positions.filter(
      ({ id: candidate, position: prior }) =>
        candidate !== current.id &&
        !explicitlyUsed.has(prior.key) &&
        prior.organizationId &&
        prior.tenure === 'former' &&
        prior.end === p.start &&
        prior.role.trim() &&
        (p.changeType === 'role_change'
          ? prior.organizationId === p.organizationId && !prior.endedEmployment
          : prior.organizationId !== p.organizationId && prior.endedEmployment),
    );
  };
  for (const current of positions) {
    // 只衔接双方都唯一、分类明确的边界。显式关联可以跨日期;自动衔接要求结束与开始字符串完全相同,
    // 同月 / 同年不能证明具体日期或没有空档。
    const predecessors = priorCandidates(current);
    const previous =
      predecessors.length === 1 &&
      positions.filter((candidate) =>
        priorCandidates(candidate).some((r) => r.id === predecessors[0]!.id),
      ).length === 1
        ? predecessors[0]
        : undefined;
    const successors = positions.filter((candidate) => {
      const candidates = priorCandidates(candidate);
      return candidates.length === 1 && candidates[0]!.id === current.id;
    });
    const next = successors.length === 1 ? successors[0] : undefined;
    for (const kind of ['start', 'end'] as const)
      await writeCareerRecord(client, user, owner, current, kind, previous, next);
  }
}

// ---- 导入 / 更新个人履历(6.13) ----
export type ProfileImportResult = {
  id: string;
  identityId: string;
  revision: number;
  unchanged: boolean;
  positions: number;
};
export async function importPersonProfile(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  body: unknown,
  today: string,
): Promise<ProfileImportResult> {
  if (user.role === 'reader') problem(403, 'Read-only users cannot change personnel profiles.');
  const input = personProfileSchema.parse(body);
  const source = personSourceKey(input.url);
  checkAccess(input.visibility, user);
  if (input.observedOn > today) problem(422, 'An observation date cannot be in the future.');
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    for (const p of input.positions)
      if (p.organizationId)
        p.organizationId = (await getOrganization(client, p.organizationId, user.role)).id;
    let profile = (
      await client.query<{
        id: string;
        object_id: string;
        visibility: Visibility;
        revision: number;
      }>(
        `SELECT id, object_id, visibility, revision FROM omniboard.person_source_profiles
          WHERE provider = $1 AND external_key = $2 FOR UPDATE`,
        [source.provider, source.key],
      )
    ).rows[0];
    if (
      profile &&
      (profile.visibility !== input.visibility || (profile.visibility === 'admin' && !admin(user)))
    )
      problem(409, 'This source profile cannot be imported at the requested access level.');
    const index = await identityIndex(client, user);
    let objectId = profile ? (index.canonical.get(profile.object_id) ?? profile.object_id) : '';
    if (input.identityId) {
      const target = await getObject(client, user, input.identityId);
      if (target.kind !== 'person' || target.visibility !== input.visibility)
        problem(422, 'Choose a person with the same access level.');
      if (objectId && objectId !== target.id)
        problem(
          409,
          'This source profile already belongs to another person. Review the dossiers before merging.',
        );
      if (!objectId && !input.reason.trim())
        problem(422, 'Explain why this source profile belongs to the selected person.');
      objectId = target.id;
    }
    // 只认明确指向这个个人主页的引用;新闻 URL、同名、同邮箱都不合并。
    const candidates = (
      await client.query<{
        id: string;
        name: string;
        structured: Record<string, string>;
        url: string;
      }>(
        `SELECT r.id, r.person_name AS name, r.structured, e.url
           FROM omniboard.module_records r JOIN omniboard.evidence e ON e.id = r.evidence_id
          WHERE r.visibility = $1 AND e.visibility = $1 AND btrim(r.person_name) <> ''
            AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
            AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a
                             WHERE a.alias_id = r.organization_id)`,
        [input.visibility],
      )
    ).rows;
    const matching = candidates.filter((r) =>
      [
        r.structured.profileUrl,
        r.structured.linkedinUrl,
        r.structured.channel === 'linkedin' ? r.structured.value : '',
        normalizedName(r.name) === normalizedName(input.name) ? r.url : '',
      ].some((url) => {
        try {
          const candidate = personSourceKey(url || '');
          return candidate.provider === source.provider && candidate.key === source.key;
        } catch {
          return false;
        }
      }),
    );
    const matchingIds: string[] = [];
    for (const r of matching) {
      const dossier = await ensurePersonDossier(client, r.id);
      const key = dossier && (index.canonical.get(dossier) ?? dossier);
      if (key && !matchingIds.includes(key)) matchingIds.push(key);
    }
    if (!objectId) objectId = matchingIds[0] ?? '';
    if (!objectId) {
      const anchor = input.positions.find((p) => p.organizationId)?.organizationId;
      if (!anchor) problem(422, 'Map at least one career entry to an organization.');
      objectId = id();
      await client.query(
        `INSERT INTO omniboard.knowledge_objects (id, organization_id, kind, name, scope, visibility)
         VALUES ($1,$2,'person',$3,'Personnel dossier',$4)`,
        [objectId, anchor, input.name, input.visibility],
      );
    }
    const obj = await getObject(client, user, objectId);
    const normalize = (value: PersonProfileInput) => ({
      ...value,
      url: source.url,
      identityId: objectId,
      positions: [...value.positions].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      revision: undefined,
      observedOn: undefined,
      reason: undefined,
    });
    const fingerprint = digest(JSON.stringify(normalize(input)));
    const last = profile
      ? (
          await client.query<{ fingerprint: string; payload: unknown; observed_on: string }>(
            `SELECT fingerprint, payload, observed_on FROM omniboard.person_profile_captures
              WHERE profile_id = $1 ORDER BY seq DESC LIMIT 1`,
            [profile.id],
          )
        ).rows[0]
      : undefined;
    const owner = {
      profileId: profile?.id ?? '',
      objectId,
      personName: input.name,
      visibility: input.visibility,
    };
    // 迁移来的旧采集可能不符合当前格式:读不出来就按「有变化」处理。
    const lastPayload = last && personProfileSchema.safeParse(last.payload);
    if (
      profile &&
      last &&
      (last.fingerprint === fingerprint ||
        (lastPayload?.success &&
          digest(JSON.stringify(normalize(lastPayload.data))) === fingerprint))
    ) {
      // 无变化的导入也重建生成的事件(修复旧导入器留下的缺项),但不新增采集。
      await refreshCareerRecords(client, user, owner);
      return {
        id: profile.id,
        identityId: objectId,
        revision: profile.revision,
        unchanged: true,
        positions: input.positions.length,
      };
    }
    if (profile && input.revision !== profile.revision)
      problem(409, 'This source profile changed. Reload its latest version before updating.');
    if (last && input.observedOn < last.observed_on)
      problem(409, 'An older observation cannot replace the latest profile.');
    if (!profile) {
      profile = { id: id(), object_id: objectId, visibility: input.visibility, revision: 1 };
      await client.query(
        `INSERT INTO omniboard.person_source_profiles
           (id, object_id, provider, external_key, url, visibility)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [profile.id, objectId, source.provider, source.key, source.url, input.visibility],
      );
    } else {
      profile.revision++;
      await client.query(
        'UPDATE omniboard.person_source_profiles SET revision = $2, updated_at = now() WHERE id = $1',
        [profile.id, profile.revision],
      );
    }
    owner.profileId = profile.id;
    for (const other of matchingIds)
      if (other !== objectId) {
        const fresh = await getObject(client, user, objectId);
        const merged = await getObject(client, user, other);
        if (fresh.id !== merged.id)
          await mergeInto(client, store, user, fresh.id, {
            otherId: merged.id,
            revision: fresh.revision,
            otherRevision: merged.revision,
            reason: `Same personal source profile: ${source.url}`,
          });
      }
    const evidenceId = await saveEvidence(client, store, Buffer.from(input.rawText), {
      source: 'person_profile',
      url: source.url,
      contentType: 'text/plain; charset=utf-8',
      parserVersion: 'person-profile-v1',
      filename: 'profile-capture.txt',
      visibility: input.visibility,
    });
    await client.query(
      `INSERT INTO omniboard.person_profile_captures
         (id, profile_id, evidence_id, payload, fingerprint, observed_on, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id(), profile.id, evidenceId, input, fingerprint, input.observedOn, user.id],
    );
    for (const position of input.positions) {
      const previous = (
        await client.query<{ id: string; data: CareerPositionInput }>(
          `SELECT id, data FROM omniboard.person_profile_positions
            WHERE profile_id = $1 AND source_key = $2`,
          [profile.id, position.key],
        )
      ).rows[0];
      if (previous?.data.organizationId && !position.organizationId)
        problem(422, 'Keep the existing organization mapping when updating this career entry.');
      if (previous && canonical(previous.data) === canonical(position)) continue;
      if (previous)
        await client.query(
          `UPDATE omniboard.person_profile_positions
              SET data = $2, evidence_id = $3, updated_at = now() WHERE id = $1`,
          [previous.id, position, evidenceId],
        );
      else
        await client.query(
          `INSERT INTO omniboard.person_profile_positions (id, profile_id, source_key, data, evidence_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [id(), profile.id, position.key, position, evidenceId],
        );
    }
    await refreshCareerRecords(client, user, owner);
    await event(
      client,
      obj.organizationId,
      objectId,
      'identity',
      'Career profile updated · ' + input.name,
      input.visibility,
      user,
      { profileId: profile.id, evidenceId, reason: input.reason },
    );
    return {
      id: profile.id,
      identityId: objectId,
      revision: profile.revision,
      unchanged: false,
      positions: input.positions.length,
    };
  });
}

/** 更新模式的回填:来源、当前任职与规范人员的名称。 */
export async function sourceProfile(pool: Pool, user: User, profileId: string) {
  const row = (
    await pool.query<{ object_id: string; visibility: Visibility }>(
      'SELECT object_id, visibility FROM omniboard.person_source_profiles WHERE id = $1',
      [profileId],
    )
  ).rows[0];
  if (!row || (row.visibility === 'admin' && !admin(user)))
    problem(404, 'Source profile not found.');
  const object = await getObject(pool, user, row.object_id);
  const { sources, careers } = await personProfileData(pool, user, object.id);
  const profile =
    sources.find((p) => p.id === profileId) ?? problem(404, 'Source profile not found.');
  return {
    profile,
    name: object.name,
    positions: careers.filter((p) => p.profileId === profileId),
  };
}

// ---- 疑似重复档案的决定(6.15) ----
export const duplicateDecisionInput = z
  .object({
    otherId: z.string().min(1).max(200),
    decision: z.enum(['different', 'later']),
    reason: z.string().trim().min(1).max(4000),
  })
  .strict();
export async function decideDuplicate(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  objectId: string,
  input: z.infer<typeof duplicateDecisionInput>,
) {
  return tx(pool, async (client) => {
    await lockKnowledge(client);
    const a = await getObject(client, user, objectId);
    const b = await getObject(client, user, input.otherId);
    if (
      a.kind !== 'person' ||
      b.kind !== 'person' ||
      a.id === b.id ||
      a.visibility !== b.visibility
    )
      problem(422, 'Choose two separate people with the same access level.');
    const [left, right] = [a.id, b.id].sort();
    const evidenceId = await saveEvidence(
      client,
      store,
      Buffer.from(JSON.stringify(input, null, 2)),
      {
        source: 'manual',
        url: '',
        contentType: 'application/json',
        filename: 'duplicate-decision.json',
        visibility: a.visibility,
      },
    );
    await client.query(
      `INSERT INTO omniboard.person_duplicate_decisions
         (left_id, right_id, decision, reason, evidence_id, author_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (left_id, right_id) DO UPDATE
         SET decision = excluded.decision, reason = excluded.reason,
             evidence_id = excluded.evidence_id, author_id = excluded.author_id, created_at = now()`,
      [left, right, input.decision, input.reason, evidenceId, user.id],
    );
    await event(
      client,
      a.organizationId,
      a.id,
      'identity',
      'Duplicate review · ' + a.name,
      a.visibility,
      user,
      { ...input, evidenceId },
    );
    return { ok: true };
  });
}
