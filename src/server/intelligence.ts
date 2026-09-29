import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem, type User } from './auth';
import type { Client, Pool } from './db';
import { tx } from './db';
import { requireImport } from './access';
import { canonicalId, getOrganization } from './organizations';
import { knowledgeGraph } from './knowledge';
import { taskRows } from './work';
import { insert } from './knowledge-import';
import type { OrganizationDeps } from './organization-routes';
import type { IntelligenceDetail, IntelligenceFeed, IntelligenceItem } from '../shared/operations';
// 情报收件箱、已读与关注(frontend-spec 8.1–8.3;data-model §3.3),从 v1 src/server/intelligence.ts 迁移。
// 只列各记录的最新版本;看不到的记录、证据,别名记录和别名机构都不出现。已读与关注是个人状态,
// 不改变记录的评审状态、证据等级或任务状态;reader 也可以写。

const admin = (user: User) => user.role === 'admin';
type Row = {
  id: string;
  organizationId: string;
  organizationName: string;
  tabId: string;
  title: string;
  body: string;
  personName: string;
  scope: string;
  status: string;
  revision: number;
  updatedAt: Date;
  evidenceId: string;
  structured: Record<string, string>;
  readRevision: number;
  source: string;
  url: string;
  capturedAt: Date;
};
// $1 = 成员 id,$2 = 是否 admin。
const select = `SELECT r.id, r.organization_id AS "organizationId", o.name AS "organizationName",
       r.tab_id AS "tabId", r.title, r.body, r.person_name AS "personName", r.scope, r.status,
       r.revision, r.updated_at AS "updatedAt", r.evidence_id AS "evidenceId", r.structured,
       COALESCE(i.revision, 0) AS "readRevision", e.source, e.url, e.captured_at AS "capturedAt"`;
const from = `FROM omniboard.module_records r
  JOIN omniboard.organizations o ON o.id = r.organization_id
  JOIN omniboard.evidence e ON e.id = r.evidence_id
  LEFT JOIN omniboard.intelligence_reads i ON i.record_id = r.id AND i.owner_id = $1`;
const access = `(r.visibility = 'team' OR $2) AND (e.visibility = 'team' OR $2)
  AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases ra WHERE ra.alias_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)`;
// related = 我关注的机构 ∪ 有「我负责或未分配、未完成、我可见」任务的机构。
const relevant = `(EXISTS (SELECT 1 FROM omniboard.organization_follows f
                    WHERE f.organization_id = r.organization_id AND f.owner_id = $1)
  OR EXISTS (SELECT 1 FROM omniboard.work_tasks t
              WHERE t.organization_id = r.organization_id
                AND (t.owner_id = $1 OR t.owner_id IS NULL)
                AND t.state NOT IN ('done','skipped') AND (t.visibility = 'team' OR $2)))`;

export const feedQuery = z.object({
  organizationId: z.string().max(200).default(''),
  scope: z.enum(['related', 'all']).default('related'),
  view: z.enum(['unread', 'all']).default('unread'),
  queue: z.enum(['all', 'review', 'expired']).default('all'),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

/** 相关性原因(8.1):按页里出现的机构一次查出。 */
async function reasonsFor(db: Pool | Client, user: User, orgIds: string[]) {
  const work = await db.query<{ id: string; mine: boolean; open: boolean }>(
    `SELECT organization_id AS id, bool_or(owner_id = $1) AS mine, bool_or(owner_id IS NULL) AS open
       FROM omniboard.work_tasks
      WHERE organization_id = ANY($3) AND state NOT IN ('done','skipped')
        AND (visibility = 'team' OR $2)
      GROUP BY organization_id`,
    [user.id, admin(user), orgIds],
  );
  const follows = await db.query<{ id: string }>(
    `SELECT organization_id AS id FROM omniboard.organization_follows
      WHERE owner_id = $1 AND organization_id = ANY($2)`,
    [user.id, orgIds],
  );
  const followed = new Set(follows.rows.map((f) => f.id));
  const tasks = new Map(work.rows.map((w) => [w.id, w]));
  return (orgId: string) => {
    const reasons: string[] = [];
    const t = tasks.get(orgId);
    if (t?.mine) reasons.push('You have work at this organization');
    else if (t?.open) reasons.push('Open team work at this organization');
    if (followed.has(orgId)) reasons.push('You follow this organization');
    return reasons;
  };
}
function item(r: Row, reasons: string[]): IntelligenceItem {
  return {
    id: r.id,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    tabId: r.tabId,
    // 架构图与人员变动的标题里没有人名时,前面加人名。
    title:
      r.personName &&
      ['org_chart', 'people_movements'].includes(r.tabId) &&
      !r.title.toLowerCase().includes(r.personName.toLowerCase())
        ? r.personName + ' · ' + r.title
        : r.title,
    summary: r.body.length > 260 ? r.body.slice(0, 260) + '…' : r.body,
    scope: r.scope,
    status: r.status,
    verification: r.structured.evidenceLevel || '',
    revision: r.revision,
    updatedAt: r.updatedAt.toISOString(),
    evidenceId: r.evidenceId,
    read: r.readRevision >= r.revision,
    reasons,
  };
}
async function rowById(db: Pool | Client, user: User, recordId: string): Promise<Row> {
  const row = (
    await db.query<Row>(`${select} ${from} WHERE ${access} AND r.id = $3`, [
      user.id,
      admin(user),
      recordId,
    ])
  ).rows[0];
  return row ?? problem(404, 'Information not found.');
}

export async function intelligenceFeed(
  pool: Pool,
  user: User,
  input: unknown,
  today: string,
): Promise<IntelligenceFeed> {
  const q = feedQuery.parse(input);
  const orgId = q.organizationId
    ? (await getOrganization(pool, q.organizationId, user.role)).id
    : '';
  const where = `${access} AND ($3 = '' OR r.organization_id = $3)
    AND ($3 <> '' OR $4 = 'all' OR ${relevant})
    AND ($5 = 'all' OR COALESCE(i.revision, 0) < r.revision)
    AND ($6 = 'all' OR ($6 = 'review' AND r.status = 'unverified')
         OR ($6 = 'expired' AND COALESCE(r.structured->>'expiresOn', '') <> ''
             AND r.structured->>'expiresOn' < $7))`;
  const values = [user.id, admin(user), orgId, q.scope, q.view, q.queue, today];
  const rows = (
    await pool.query<Row>(
      `${select} ${from} WHERE ${where}
        ORDER BY r.updated_at DESC, r.id DESC LIMIT $8 OFFSET $9`,
      [...values, q.limit, q.offset],
    )
  ).rows;
  const total = Number(
    (await pool.query<{ n: string }>(`SELECT count(*) AS n ${from} WHERE ${where}`, values))
      .rows[0]!.n,
  );
  const reasons = await reasonsFor(pool, user, [...new Set(rows.map((r) => r.organizationId))]);
  return {
    items: rows.map((r) => item(r, reasons(r.organizationId))),
    total,
    hasMore: q.offset + rows.length < total,
  };
}

export async function intelligenceDetail(
  pool: Pool,
  user: User,
  recordId: string,
  today: string,
): Promise<IntelligenceDetail> {
  const r = await rowById(pool, user, recordId);
  const graph = await knowledgeGraph(pool, user, today, r.organizationId);
  const objects = graph.objects.filter((o) => o.records.some((x) => x.id === r.id));
  const linked = new Set(objects.map((o) => o.id));
  const tasks = (await taskRows(pool, user, r.organizationId))
    .map((t) => ({
      id: t.id,
      title: t.title,
      state: t.displayState,
      link: (t.sourceRecordId === r.id || t.objectIds.some((o) => linked.has(o))
        ? 'direct'
        : 'organization') as 'direct' | 'organization',
    }))
    .sort((a, b) => Number(b.link === 'direct') - Number(a.link === 'direct'));
  // 与上一个历史版本比较(8.2 What changed);v1 导入的记录没有 v2 之前的历史。
  const previous = (
    await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM omniboard.edit_history
        WHERE subject_id = $1 AND revision < $2
        ORDER BY revision DESC, created_at DESC LIMIT 1`,
      [r.id, r.revision],
    )
  ).rows[0];
  const changes: IntelligenceDetail['changes'] = [];
  if (previous) {
    const old = previous.payload;
    for (const key of ['title', 'body', 'scope', 'status'] as const)
      if (typeof old[key] === 'string' && old[key] !== r[key])
        changes.push({ field: key, before: old[key], after: r[key] });
    const oldFields = (old.structured ?? {}) as Record<string, string>;
    for (const key of new Set([...Object.keys(oldFields), ...Object.keys(r.structured)]))
      if ((oldFields[key] || '') !== (r.structured[key] || ''))
        changes.push({
          field: key,
          before: String(oldFields[key] || ''),
          after: r.structured[key] || '',
        });
  }
  const contacts = (
    await pool.query<IntelligenceDetail['contacts'][number]>(
      `SELECT r.id, r.title, r.person_name AS name
         FROM omniboard.module_records r
         JOIN omniboard.evidence e ON e.id = r.evidence_id
        WHERE r.organization_id = $1 AND r.tab_id = 'contacts'
          AND (r.visibility = 'team' OR $2) AND (e.visibility = 'team' OR $2)
          AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
        ORDER BY r.updated_at DESC, r.id COLLATE "C" LIMIT 5`,
      [r.organizationId, admin(user)],
    )
  ).rows;
  const reasons = await reasonsFor(pool, user, [r.organizationId]);
  return {
    item: item(r, reasons(r.organizationId)),
    body: r.body,
    structured: r.structured,
    source: { source: r.source, url: r.url, capturedAt: r.capturedAt.toISOString() },
    changes,
    hasPrevious: !!previous,
    tasks,
    objects: objects.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
    contacts,
  };
}

export const readInput = z
  .object({ revision: z.number().int().positive(), read: z.boolean() })
  .strict();
export async function markRead(pool: Pool, user: User, recordId: string, input: unknown) {
  const parsed = readInput.parse(input);
  const r = await rowById(pool, user, recordId);
  if (parsed.revision !== r.revision)
    problem(409, 'This information changed. Reopen the latest revision before marking it read.');
  if (parsed.read)
    await pool.query(
      `INSERT INTO omniboard.intelligence_reads (owner_id, record_id, revision, read_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (owner_id, record_id)
       DO UPDATE SET revision = excluded.revision, read_at = excluded.read_at`,
      [user.id, r.id, r.revision],
    );
  else
    await pool.query(
      'DELETE FROM omniboard.intelligence_reads WHERE owner_id = $1 AND record_id = $2',
      [user.id, r.id],
    );
}

export const followInput = z.object({ follow: z.boolean() }).strict();
/** 关注机构(8.3):别名机构读作规范机构。 */
export async function follow(pool: Pool, user: User, organizationId: string, input: unknown) {
  const parsed = followInput.parse(input);
  const org = await getOrganization(pool, organizationId, user.role);
  if (parsed.follow)
    await pool.query(
      `INSERT INTO omniboard.organization_follows (owner_id, organization_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [user.id, org.id],
    );
  else
    await pool.query(
      'DELETE FROM omniboard.organization_follows WHERE owner_id = $1 AND organization_id = $2',
      [user.id, org.id],
    );
}

// 迁移导入(proposal §9):保留 v1 的已读 revision 与时间、关注时间。按成员 + 记录 / 机构幂等,
// 同一对已存在且内容相同返回 200,不同返回 409。
const key = z.string().min(1).max(200);
const at = z.iso.datetime({ offset: true });
const readImport = z
  .object({ ownerId: key, recordId: key, revision: z.number().int().positive(), readAt: at })
  .strict();
const followImport = z.object({ ownerId: key, organizationId: key, createdAt: at }).strict();
async function importRead(client: Client, input: z.infer<typeof readImport>) {
  if (
    await insert(
      client,
      `INSERT INTO omniboard.intelligence_reads (owner_id, record_id, revision, read_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [input.ownerId, input.recordId, input.revision, input.readAt],
    )
  )
    return true;
  const current = await client.query(
    `SELECT 1 FROM omniboard.intelligence_reads
      WHERE owner_id = $1 AND record_id = $2 AND revision = $3 AND read_at = $4`,
    [input.ownerId, input.recordId, input.revision, input.readAt],
  );
  return current.rowCount ? false : problem(409, 'This item has already been imported.');
}
/** 关注的若是后来被合并的机构,记到规范机构上。 */
async function importFollow(client: Client, input: z.infer<typeof followImport>) {
  return insert(
    client,
    `INSERT INTO omniboard.organization_follows (owner_id, organization_id, created_at)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [input.ownerId, await canonicalId(client, input.organizationId), input.createdAt],
  );
}

const idParam = z.object({ id: z.string().min(1).max(200) });
export function registerIntelligenceRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool } = deps;
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);
  app.get('/api/intelligence', async (request) =>
    intelligenceFeed(pool, request.user, request.query, today()),
  );
  app.get('/api/intelligence/:id', async (request) =>
    intelligenceDetail(pool, request.user, idParam.parse(request.params).id, today()),
  );
  app.post('/api/intelligence/:id/read', async (request) => {
    await markRead(pool, request.user, idParam.parse(request.params).id, request.body);
    return { ok: true };
  });
  app.post('/api/organizations/:id/follow', async (request) => {
    await follow(pool, request.user, idParam.parse(request.params).id, request.body);
    return { ok: true };
  });
  app.post('/api/import/intelligence-reads', async (request, reply) => {
    const input = readImport.parse(request.body);
    await requireImport(pool, request);
    const created = await tx(pool, (client) => importRead(client, input));
    return reply.code(created ? 201 : 200).send({ ok: true });
  });
  app.post('/api/import/organization-follows', async (request, reply) => {
    const input = followImport.parse(request.body);
    await requireImport(pool, request);
    const created = await tx(pool, (client) => importFollow(client, input));
    return reply.code(created ? 201 : 200).send({ ok: true });
  });
}
