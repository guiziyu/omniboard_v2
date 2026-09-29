import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type Role, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { metricLabel } from '../shared/columns';
import { validateKnowledge } from '../shared/knowledge';
import {
  compareMovementDates,
  movementDateSchema,
  validateMovementDate,
} from '../shared/movement-date';
import { tabs, tabsFor } from '../shared/registry';
import type {
  ModuleData,
  ModuleRecord,
  Observation,
  RecordVersion,
  Tag,
  Visibility,
} from '../shared/types';
import { getOrganizationProfile } from './profiles';
import { lockChart, saveRelationship, validateReportsTo } from './org-chart';
import { validateDiscussionReferences } from './discussion';
import { ensurePersonDossier } from './person-dossier';
import { onRecordSaved } from './connector-requests';
// 模块数据与记录(frontend-spec 4.3、5.1–5.6;data-model §3.3)。

/** 各来源最近一次成功采集中该机构的观测;history=true 时取全部成功批次(最多 200 行)。 */
export async function observations(
  pool: Pool | Client,
  organizationId: string,
  history = false,
): Promise<Observation[]> {
  const latest = history
    ? ''
    : `AND r.id = (SELECT r2.id FROM omniboard.collection_runs r2
                    WHERE r2.source = l.source AND r2.status = 'success'
                    ORDER BY r2.started_at DESC, r2.id DESC LIMIT 1)`;
  const result = await pool.query<Omit<Observation, 'capturedAt'> & { capturedAt: Date }>(
    `SELECT l.id AS "linkId", l.slug, l.name, l.url, l.source, o.rank, o.metrics,
            e.id AS "evidenceId", e.captured_at AS "capturedAt"
       FROM omniboard.source_entity_links l
       JOIN omniboard.source_observations o ON o.link_id = l.id
       JOIN omniboard.evidence e ON e.id = o.evidence_id
       JOIN omniboard.collection_runs r ON r.id = o.run_id
      WHERE l.organization_id = $1 AND r.status = 'success' ${latest}
      ORDER BY e.captured_at DESC, l.source LIMIT ${history ? 200 : 10}`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    ...row,
    capturedAt: row.capturedAt.toISOString(),
    metrics: row.metrics.map((m) => ({ ...m, label: metricLabel(m.key, m.label) })),
  }));
}

type RecordRow = {
  id: string;
  organization_id: string;
  tab_id: string;
  title: string;
  body: string;
  scope: string;
  status: string;
  visibility: Visibility;
  person_name: string;
  person_email: string;
  structured: Record<string, string>;
  reports_to: string;
  relationship_kind: 'confirmed' | 'unconfirmed' | null;
  relationship_note: string | null;
  relationship_evidence_id: string | null;
  event_date: string | null;
  event_type: string;
  evidence_id: string;
  attachment_evidence_id: string | null;
  revision: number;
  author: string;
  updated_at: Date;
};
const toRecord = (r: RecordRow): ModuleRecord => ({
  id: r.id,
  organizationId: r.organization_id,
  tabId: r.tab_id,
  title: r.title,
  body: r.body,
  scope: r.scope,
  status: r.status,
  visibility: r.visibility,
  personName: r.person_name,
  personEmail: r.person_email,
  structured: r.structured,
  reportsTo: r.reports_to,
  // 没有关系元数据的上级读作 unconfirmed(frontend-spec 6.2)。
  relationshipKind: r.relationship_kind ?? 'unconfirmed',
  relationshipNote: r.relationship_note ?? '',
  relationshipEvidenceId: r.relationship_evidence_id,
  eventDate: r.event_date ?? '',
  eventType: r.event_type,
  evidenceId: r.evidence_id,
  attachmentEvidenceId: r.attachment_evidence_id,
  revision: r.revision,
  author: r.author,
  updatedAt: r.updated_at.toISOString(),
});
export async function records(
  pool: Pool,
  organizationId: string,
  tabId: string,
  role: Role,
): Promise<ModuleRecord[]> {
  const result = await pool.query<RecordRow>(
    `SELECT r.*, m.name AS author, c.kind AS relationship_kind, c.note AS relationship_note,
            c.evidence_id AS relationship_evidence_id
       FROM omniboard.module_records r
       JOIN omniboard.member m ON m.id = r.author_id
       LEFT JOIN omniboard.org_chart_relationships c ON c.record_id = r.id
      WHERE r.organization_id = $1 AND ($2 = '' OR r.tab_id = $2)
        AND (r.visibility = 'team' OR $3)
      ORDER BY r.updated_at DESC, r.id DESC`,
    [organizationId, tabId, role === 'admin'],
  );
  const list = result.rows.map(toRecord);
  return tabId === 'people_movements' ? list.sort(compareMovementDates) : list;
}
/**
 * 模块状态(frontend-spec 4.3):not_applicable 不含 records;非 admin 只有 admin 记录、又没有来源与资料时
 * 为 restricted,不透露记录内容。
 */
export async function moduleData(
  pool: Pool,
  org: { id: string; tags: Tag[] },
  tabId: string,
  role: Role,
): Promise<ModuleData> {
  if (!tabsFor(org.tags).some((t) => t.id === tabId))
    return { organizationId: org.id, tabId, status: 'not_applicable' };
  const list = await records(pool, org.id, tabId, role);
  const sources = ['overview', 'stats'].includes(tabId) ? await observations(pool, org.id) : [];
  const hasProfile = tabId === 'overview' && !!(await getOrganizationProfile(pool, org.id, role));
  if (!list.length && !sources.length && !hasProfile && role !== 'admin') {
    const restricted = await pool.query(
      `SELECT 1 FROM omniboard.module_records
        WHERE organization_id = $1 AND tab_id = $2 AND visibility = 'admin' LIMIT 1`,
      [org.id, tabId],
    );
    if (restricted.rowCount) return { organizationId: org.id, tabId, status: 'restricted' };
  }
  return {
    organizationId: org.id,
    tabId,
    status: list.length || sources.length || hasProfile ? 'ready' : 'empty',
    records: list,
    sources,
  };
}
export const knownTab = (tabId: string) => tabs.some((t) => t.id === tabId);

export const urlSchema = z
  .string()
  .max(2000)
  .refine((v) => !v || (/^https?:\/\//.test(v) && URL.canParse(v)), 'Use an HTTP or HTTPS URL.')
  .default('');
export const relationshipKindSchema = z.enum(['confirmed', 'unconfirmed']);
export const recordInput = z
  .object({
    // 迁移导入(proposal §9):id 可由调用方传入;以下带 import 注释的字段只在导入窗口内由 admin 令牌写入。
    id: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(20000),
    scope: z.string().trim().min(1).max(300),
    status: z.enum(['unverified', 'confirmed', 'in_progress', 'done']),
    visibility: z.enum(['team', 'admin']),
    personName: z.string().trim().max(100).default(''),
    personEmail: z.union([z.email().max(200), z.literal('')]).default(''),
    structured: z.record(z.string(), z.string()).default({}),
    reportsTo: z.string().max(100).default(''),
    relationshipKind: relationshipKindSchema.optional(),
    relationshipNote: z.string().max(100000).default(''),
    eventDate: movementDateSchema.default(''),
    eventType: z.enum(['', 'joined', 'left', 'role_change']).default(''),
    rawText: z.string().max(100000).default(''),
    reuseReference: z.boolean().default(false),
    sourceUrl: urlSchema,
    attachment: z
      .object({
        filename: z.string().min(1).max(200),
        base64: z
          .string()
          .max(7_000_000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .optional(),
    revision: z.number().int().positive().optional(),
    evidenceId: z.string().min(1).max(100).optional(), // import
    attachmentEvidenceId: z.string().min(1).max(100).optional(), // import
    relationshipEvidenceId: z.string().min(1).max(100).optional(), // import
    authorId: z.string().min(1).max(100).optional(), // import
    importedRevision: z.number().int().positive().optional(), // import
    updatedAt: z.iso.datetime({ offset: true }).optional(), // import
  })
  .strict();
export type RecordInput = z.infer<typeof recordInput>;
export const importFields = [
  'evidenceId',
  'attachmentEvidenceId',
  'relationshipEvidenceId',
  'authorId',
  'importedRevision',
  'updatedAt',
] as const;

/** 引用已存在的证据:必须存在;team 记录不能引用 admin 证据(frontend-spec 0.2)。 */
export async function checkEvidence(client: Client, evidenceId: string, visibility: Visibility) {
  const found = await client.query<{ visibility: Visibility }>(
    'SELECT visibility FROM omniboard.evidence WHERE id = $1',
    [evidenceId],
  );
  const row = found.rows[0];
  if (!row) problem(422, 'Referenced evidence not found.');
  if (row.visibility === 'admin' && visibility !== 'admin')
    problem(422, 'Restricted evidence requires an administrator-only item.');
}
/** 新建或编辑一条记录(frontend-spec 5.6 服务端规则)。 */
export async function saveRecord(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  org: { id: string; tags: Tag[] },
  tabId: string,
  recordId: string | undefined,
  input: RecordInput,
): Promise<{ id: string; revision: number; created: boolean }> {
  if (!tabsFor(org.tags).some((t) => t.id === tabId) || tabId === 'stats')
    problem(422, 'This module does not accept manual records.');
  const chart = tabId === 'org_chart';
  const structured =
    tabId === 'people_movements'
      ? validateMovementDate(input.eventDate, input.structured)
      : validateKnowledge(tabId, input.structured);
  if (structured.sensitivity === 'NDA' && input.visibility !== 'admin')
    problem(422, 'NDA records must use administrator visibility.');
  if (input.visibility === 'admin' && user.role !== 'admin')
    problem(403, 'Administrator access is required.');
  if (
    !chart &&
    (input.reportsTo ||
      input.relationshipKind ||
      input.relationshipNote ||
      input.relationshipEvidenceId)
  )
    problem(422, 'Reporting relationships are only available in Org Chart.');
  if (chart && !input.personName) problem(422, 'A position requires a person name.');
  if (tabId === 'people_movements' && (!input.personName || !input.eventType))
    problem(422, 'A movement requires a person and event type. Leave unpublished dates unknown.');
  if (recordId && input.id) problem(422, 'A new record must not specify an existing ID.');
  const importing = importFields.some((field) => input[field] !== undefined);

  return tx(pool, async (client) => {
    if (chart) await lockChart(client, org.id);
    const existing = recordId
      ? (
          await client.query<{
            id: string;
            revision: number;
            visibility: Visibility;
            evidence_id: string;
            attachment_evidence_id: string | null;
            reports_to: string;
            relationship_kind: 'confirmed' | 'unconfirmed' | null;
            structured: Record<string, string>;
          }>(
            `SELECT r.id, r.revision, r.visibility, r.evidence_id, r.attachment_evidence_id,
                    r.reports_to, c.kind AS relationship_kind, r.structured
               FROM omniboard.module_records r
               LEFT JOIN omniboard.org_chart_relationships c ON c.record_id = r.id
              WHERE r.id = $1 AND r.organization_id = $2 AND r.tab_id = $3 FOR UPDATE OF r`,
            [recordId, org.id, tabId],
          )
        ).rows[0]
      : undefined;
    if (recordId && !existing) problem(404, 'Record not found.');
    if (existing?.visibility === 'admin' && user.role !== 'admin')
      problem(403, 'Administrator access is required.');
    if (existing && existing.revision !== input.revision)
      problem(409, 'This record has changed. Reopen the latest version.');
    if (existing && existing.visibility !== input.visibility)
      problem(422, 'Visibility cannot change after creation. Create a new record.');
    if (input.reuseReference && !existing)
      problem(422, 'Only an existing record can retain its reference.');
    if (!input.reuseReference && !input.evidenceId && !input.rawText.trim())
      problem(422, 'Original reference text is required.');
    if (tabId === 'comments')
      await validateDiscussionReferences(
        client,
        org.id,
        structured,
        input.visibility,
        existing?.id ?? input.id,
      );
    if ((tabId === 'api_optimization' || tabId === 'tech_stack') && structured.sourceId) {
      const clash = await client.query(
        `SELECT 1 FROM omniboard.module_records
          WHERE organization_id = $1 AND tab_id IN ('api_optimization','tech_stack')
            AND structured->>'sourceId' = $2 AND id <> $3 LIMIT 1`,
        [org.id, structured.sourceId, existing?.id ?? ''],
      );
      if (clash.rowCount)
        problem(
          409,
          `Source ID ${structured.sourceId} is already used by another record of this organization.`,
        );
    }

    // 汇报关系(frontend-spec 6.2、6.4):上级或确定性变了就要新的关系理由;只改其他字段时保留原确定性。
    let relationship:
      { kind: 'confirmed' | 'unconfirmed'; note: string; evidenceId?: string } | undefined;
    if (chart) {
      const kind = input.reportsTo
        ? (input.relationshipKind ??
          (existing?.reports_to === input.reportsTo
            ? (existing.relationship_kind ?? undefined)
            : undefined) ??
          'unconfirmed')
        : 'unconfirmed';
      const changed = existing
        ? existing.reports_to !== input.reportsTo ||
          (existing.relationship_kind ?? 'unconfirmed') !== kind
        : !!input.reportsTo;
      const note =
        input.relationshipNote || (changed && !input.reuseReference ? input.rawText : '');
      await validateReportsTo(
        client,
        org.id,
        existing?.id ?? '',
        input.reportsTo,
        input.visibility,
      );
      if (input.relationshipEvidenceId) {
        await checkEvidence(client, input.relationshipEvidenceId, input.visibility);
        relationship = { kind, note, evidenceId: input.relationshipEvidenceId };
      } else if (changed && !note.trim() && !importing)
        problem(422, 'Record the evidence or reason for this relationship change.');
      else if (note.trim()) relationship = { kind, note };
    }

    let evidenceId: string;
    if (input.evidenceId) {
      await checkEvidence(client, input.evidenceId, input.visibility);
      evidenceId = input.evidenceId;
    } else if (input.reuseReference) evidenceId = existing!.evidence_id;
    else
      evidenceId = await saveEvidence(client, store, Buffer.from(input.rawText), {
        source: 'manual',
        url: input.sourceUrl,
        contentType: 'text/plain; charset=utf-8',
        visibility: input.visibility,
      });
    let attachmentId = existing?.attachment_evidence_id ?? null;
    if (input.attachmentEvidenceId) {
      await checkEvidence(client, input.attachmentEvidenceId, input.visibility);
      attachmentId = input.attachmentEvidenceId;
    } else if (input.attachment) {
      const bytes = Buffer.from(input.attachment.base64, 'base64');
      if (bytes.length > 5_000_000 || bytes.length === 0)
        problem(422, 'Attachments must be between 1 byte and 5 MB.');
      attachmentId = await saveEvidence(client, store, bytes, {
        source: 'attachment',
        url: input.sourceUrl,
        contentType: 'application/octet-stream',
        filename: input.attachment.filename,
        visibility: input.visibility,
      });
    }

    if (input.authorId) {
      const author = await client.query('SELECT 1 FROM omniboard.member WHERE id = $1', [
        input.authorId,
      ]);
      if (!author.rowCount) problem(422, 'The imported author is not a member.');
    }
    if (existing && input.importedRevision)
      problem(422, 'An imported revision only applies to a new record.');
    const id_ = existing?.id ?? input.id ?? id();
    const revision = existing ? existing.revision + 1 : (input.importedRevision ?? 1);
    const authorId = input.authorId ?? user.id;
    const updatedAt = input.updatedAt ? new Date(input.updatedAt) : null;
    const values = [
      id_,
      input.title,
      input.body,
      input.scope,
      input.status,
      input.personName,
      input.personEmail,
      structured,
      input.eventDate || null,
      input.eventType,
      evidenceId,
      attachmentId,
      revision,
      authorId,
      updatedAt,
      input.reportsTo,
    ];
    if (existing) {
      const updated = await client.query(
        `UPDATE omniboard.module_records
            SET title = $2, body = $3, scope = $4, status = $5, person_name = $6, person_email = $7,
                structured = $8, event_date = $9, event_type = $10, evidence_id = $11,
                attachment_evidence_id = $12, revision = $13, author_id = $14,
                updated_at = COALESCE($15, now()), reports_to = $16
          WHERE id = $1 AND revision = $17`,
        [...values, input.revision],
      );
      if (updated.rowCount !== 1) problem(409, 'Record revision conflict. Reload and try again.');
    } else {
      const inserted = await client.query(
        `INSERT INTO omniboard.module_records
           (id, title, body, scope, status, person_name, person_email, structured, event_date,
            event_type, evidence_id, attachment_evidence_id, revision, author_id, updated_at,
            reports_to, organization_id, tab_id, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, now()),$16,$17,$18,$19)
         ON CONFLICT (id) DO NOTHING`,
        [...values, org.id, tabId, input.visibility],
      );
      if (!inserted.rowCount) problem(409, 'A record with this id already exists.');
    }
    // 带姓名的记录建独立人员档案(6.4);导入时 v1 的档案随共享对象一起导入,这里不自动建。
    if (!importing) await ensurePersonDossier(client, id_);
    if (relationship)
      await saveRelationship(client, store, id_, {
        ...relationship,
        sourceUrl: input.sourceUrl,
        visibility: input.visibility,
      });
    await writeHistory(
      client,
      id_,
      existing ? 'record_updated' : 'record_created',
      revision,
      authorId,
      updatedAt,
    );
    // 接入请求与由它产生的任务(frontend-spec 11.1、11.5);导入的记录不生成,v1 的请求另行导入。
    if (!importing)
      await onRecordSaved(
        client,
        user,
        {
          organizationId: org.id,
          tabId,
          recordId: id_,
          revision,
          visibility: input.visibility,
          evidenceId,
          structured,
          previous: existing?.structured,
        },
        new Date().toISOString().slice(0, 10),
      );
    return { id: id_, revision, created: !existing };
  });
}
/** 调整汇报关系(frontend-spec 6.2):只改上级与确定性,理由必填且单独存证;editor 看不到的职位返回 404。 */
export const relationshipInput = z
  .object({
    revision: z.number().int().positive(),
    reportsTo: z.string().max(100),
    relationshipKind: relationshipKindSchema,
    note: z
      .string()
      .max(100000)
      .refine((s) => !!s.trim(), 'An original reference or first-hand observation is required.'),
    sourceUrl: urlSchema,
  })
  .strict();
export async function moveRelationship(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  organizationId: string,
  recordId: string,
  input: z.infer<typeof relationshipInput>,
): Promise<{ id: string; revision: number }> {
  return tx(pool, async (client) => {
    await lockChart(client, organizationId);
    const current = (
      await client.query<{
        revision: number;
        visibility: Visibility;
        reports_to: string;
        kind: 'confirmed' | 'unconfirmed';
      }>(
        `SELECT r.revision, r.visibility, r.reports_to, COALESCE(c.kind, 'unconfirmed') AS kind
           FROM omniboard.module_records r
           LEFT JOIN omniboard.org_chart_relationships c ON c.record_id = r.id
          WHERE r.id = $1 AND r.organization_id = $2 AND r.tab_id = 'org_chart'
            AND (r.visibility = 'team' OR $3)
          FOR UPDATE OF r`,
        [recordId, organizationId, user.role === 'admin'],
      )
    ).rows[0];
    if (!current) problem(404, 'Position not found.');
    if (current.revision !== input.revision)
      problem(409, 'This position has changed. Reload the chart before saving.');
    await validateReportsTo(client, organizationId, recordId, input.reportsTo, current.visibility);
    // 移到顶层时确定性强制为 unconfirmed。
    const kind = input.reportsTo ? input.relationshipKind : 'unconfirmed';
    if (current.reports_to === input.reportsTo && current.kind === kind)
      problem(422, 'Choose a different manager or relationship certainty.');
    await saveRelationship(client, store, recordId, {
      kind,
      note: input.note,
      sourceUrl: input.sourceUrl,
      visibility: current.visibility,
    });
    const revision = current.revision + 1;
    await client.query(
      `UPDATE omniboard.module_records
          SET reports_to = $2, revision = $3, author_id = $4, updated_at = now()
        WHERE id = $1`,
      [recordId, input.reportsTo, revision, user.id],
    );
    await writeHistory(client, recordId, 'reporting_relationship_updated', revision, user.id);
    return { id: recordId, revision };
  });
}
/**
 * 版本历史写保存后的字段快照(data-model §3.3);组织架构图记录另含上级与汇报关系,
 * 所以关系调整也能在历史里看到当时的上级、确定性和关系证据。
 */
export async function writeHistory(
  client: Client,
  recordId: string,
  action: string,
  revision: number,
  authorId: string,
  at: Date | null = null,
) {
  const r = (
    await client.query<RecordRow>(
      `SELECT r.*, c.kind AS relationship_kind, c.note AS relationship_note,
              c.evidence_id AS relationship_evidence_id
         FROM omniboard.module_records r
         LEFT JOIN omniboard.org_chart_relationships c ON c.record_id = r.id
        WHERE r.id = $1`,
      [recordId],
    )
  ).rows[0]!;
  const payload = {
    title: r.title,
    body: r.body,
    scope: r.scope,
    status: r.status,
    visibility: r.visibility,
    personName: r.person_name,
    personEmail: r.person_email,
    structured: r.structured,
    eventDate: r.event_date ?? '',
    eventType: r.event_type,
    evidenceId: r.evidence_id,
    attachmentEvidenceId: r.attachment_evidence_id,
    ...(r.tab_id === 'org_chart'
      ? {
          reportsTo: r.reports_to,
          relationshipKind: r.relationship_kind ?? 'unconfirmed',
          relationshipNote: r.relationship_note ?? '',
          relationshipEvidenceId: r.relationship_evidence_id,
        }
      : {}),
  };
  await client.query(
    `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))`,
    [id(), recordId, action, revision, payload, authorId, at],
  );
}
/** 记录别名(data-model §3.3):合并机构时被归并的重复记录。只经导入写入;同 alias 同目标视为已导入。 */
export const recordAliasInput = z
  .object({ aliasId: z.string().min(1).max(100), recordId: z.string().min(1).max(100) })
  .strict();
export async function importRecordAlias(
  pool: Pool,
  input: z.infer<typeof recordAliasInput>,
): Promise<boolean> {
  if (input.aliasId === input.recordId) problem(422, 'A record cannot be an alias of itself.');
  return tx(pool, async (client) => {
    const found = await client.query('SELECT id FROM omniboard.module_records WHERE id = ANY($1)', [
      [input.aliasId, input.recordId],
    ]);
    if (found.rowCount !== 2) problem(422, 'Both records must exist before they can be aliased.');
    const inserted = await client.query(
      `INSERT INTO omniboard.record_aliases (alias_id, record_id) VALUES ($1, $2)
       ON CONFLICT (alias_id) DO NOTHING`,
      [input.aliasId, input.recordId],
    );
    if (inserted.rowCount) return true;
    const current = await client.query<{ record_id: string }>(
      'SELECT record_id FROM omniboard.record_aliases WHERE alias_id = $1',
      [input.aliasId],
    );
    if (current.rows[0]!.record_id !== input.recordId)
      problem(409, 'This record is already an alias of another record.');
    return false;
  });
}
/** 记录版本历史(frontend-spec 5.5):admin 记录的历史只有 admin 能看。 */
export async function recordHistory(
  pool: Pool,
  recordId: string,
  role: Role,
): Promise<RecordVersion[]> {
  const record = await pool.query<{ visibility: Visibility }>(
    'SELECT visibility FROM omniboard.module_records WHERE id = $1',
    [recordId],
  );
  if (!record.rows[0]) problem(404, 'Record not found.');
  if (record.rows[0].visibility === 'admin' && role !== 'admin')
    problem(403, 'Administrator access is required.');
  const history = await pool.query<RecordVersion & { createdAt: Date }>(
    `SELECT h.revision, h.action, m.name AS author, h.created_at AS "createdAt", h.payload
       FROM omniboard.edit_history h JOIN omniboard.member m ON m.id = h.author_id
      WHERE h.subject_id = $1 ORDER BY h.revision DESC, h.created_at DESC`,
    [recordId],
  );
  return history.rows.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() }));
}
