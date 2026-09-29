import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type Role, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { metricLabel } from '../shared/columns';
import { validateKnowledge } from '../shared/knowledge';
import { compareMovementDates, movementDateSchema } from '../shared/movement-date';
import { pendingModules, tabs, tabsFor } from '../shared/registry';
import type {
  ModuleData,
  ModuleRecord,
  Observation,
  RecordVersion,
  Tag,
  Visibility,
} from '../shared/types';
import { getOrganizationProfile } from './profiles';
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
    `SELECT r.*, m.name AS author FROM omniboard.module_records r
       JOIN omniboard.member m ON m.id = r.author_id
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

const urlSchema = z
  .string()
  .max(2000)
  .refine((v) => !v || (/^https?:\/\//.test(v) && URL.canParse(v)), 'Use an HTTP or HTTPS URL.')
  .default('');
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
    relationshipKind: z.enum(['confirmed', 'unconfirmed']).optional(),
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
    authorId: z.string().min(1).max(100).optional(), // import
    importedRevision: z.number().int().positive().optional(), // import
    updatedAt: z.iso.datetime({ offset: true }).optional(), // import
  })
  .strict();
export type RecordInput = z.infer<typeof recordInput>;
export const importFields = [
  'evidenceId',
  'attachmentEvidenceId',
  'authorId',
  'importedRevision',
  'updatedAt',
] as const;

/** 引用已存在的证据:必须存在;team 记录不能引用 admin 证据(frontend-spec 0.2)。 */
async function checkEvidence(client: Client, evidenceId: string, visibility: Visibility) {
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
  if (pendingModules.includes(tabId))
    problem(422, 'This module is being moved to the new version and does not accept records yet.');
  const structured = validateKnowledge(tabId, input.structured);
  if (structured.sensitivity === 'NDA' && input.visibility !== 'admin')
    problem(422, 'NDA records must use administrator visibility.');
  if (input.visibility === 'admin' && user.role !== 'admin')
    problem(403, 'Administrator access is required.');
  if (input.reportsTo || input.relationshipKind || input.relationshipNote)
    problem(422, 'Reporting relationships are only available in Org Chart.');
  if (recordId && input.id) problem(422, 'A new record must not specify an existing ID.');

  return tx(pool, async (client) => {
    const existing = recordId
      ? (
          await client.query<{
            id: string;
            revision: number;
            visibility: Visibility;
            evidence_id: string;
            attachment_evidence_id: string | null;
          }>(
            `SELECT id, revision, visibility, evidence_id, attachment_evidence_id
               FROM omniboard.module_records
              WHERE id = $1 AND organization_id = $2 AND tab_id = $3 FOR UPDATE`,
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
    ];
    if (existing) {
      const updated = await client.query(
        `UPDATE omniboard.module_records
            SET title = $2, body = $3, scope = $4, status = $5, person_name = $6, person_email = $7,
                structured = $8, event_date = $9, event_type = $10, evidence_id = $11,
                attachment_evidence_id = $12, revision = $13, author_id = $14,
                updated_at = COALESCE($15, now())
          WHERE id = $1 AND revision = $16`,
        [...values, input.revision],
      );
      if (updated.rowCount !== 1) problem(409, 'Record revision conflict. Reload and try again.');
    } else {
      const inserted = await client.query(
        `INSERT INTO omniboard.module_records
           (id, title, body, scope, status, person_name, person_email, structured, event_date,
            event_type, evidence_id, attachment_evidence_id, revision, author_id, updated_at,
            organization_id, tab_id, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15, now()),$16,$17,$18)
         ON CONFLICT (id) DO NOTHING`,
        [...values, org.id, tabId, input.visibility],
      );
      if (!inserted.rowCount) problem(409, 'A record with this id already exists.');
    }
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))`,
      [
        id(),
        id_,
        existing ? 'record_updated' : 'record_created',
        revision,
        {
          title: input.title,
          body: input.body,
          scope: input.scope,
          status: input.status,
          visibility: input.visibility,
          personName: input.personName,
          personEmail: input.personEmail,
          structured,
          eventDate: input.eventDate,
          eventType: input.eventType,
          evidenceId,
          attachmentEvidenceId: attachmentId,
        },
        authorId,
        updatedAt,
      ],
    );
    return { id: id_, revision, created: !existing };
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
