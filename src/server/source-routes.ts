import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from './auth';
import type { Client } from './db';
import { tx } from './db';
import { requireImport, requireRole } from './access';
import { canonicalId } from './organizations';
import { insert } from './knowledge-import';
import { startCollection, type Fetcher } from './collect';
import type { OrganizationDeps } from './organization-routes';
import { webSources, type SourcesState } from '../shared/sources';
// 数据来源页(frontend-spec 9.5–9.7),从 v1 src/server/app.ts `/sources` 迁移。所有角色可读;
// 采集、每日开关与映射仅 admin。映射的 PATCH 在 organization-routes(指标对话框也用它)。

export type SourceDeps = OrganizationDeps & { fetcher?: Fetcher };

async function sourcesState(deps: SourceDeps, admin: boolean): Promise<SourcesState> {
  const { pool } = deps;
  const runs = await pool.query(
    `SELECT id, source, status, started_at AS "startedAt", finished_at AS "finishedAt",
            row_count AS "rowCount", error, evidence_id AS "evidenceId"
       FROM omniboard.collection_runs ORDER BY started_at DESC, id DESC LIMIT 50`,
  );
  const mappings = admin
    ? await pool.query(
        `SELECT l.id, l.source, l.name, l.slug, l.organization_id AS "organizationId",
                o.name AS "organizationName", l.mapped_by AS "mappedBy"
           FROM omniboard.source_entity_links l
           JOIN omniboard.organizations o ON o.id = l.organization_id
          ORDER BY l.source, lower(l.name), l.id`,
      )
    : { rows: [] };
  const setting = await pool.query<{ daily: boolean }>(
    `SELECT value = 'true'::jsonb AS daily FROM omniboard.app_setting WHERE key = 'daily_collection'`,
  );
  const running = await pool.query(
    `SELECT 1 FROM omniboard.collection_runs WHERE status = 'running'`,
  );
  return {
    runs: runs.rows,
    mappings: mappings.rows,
    daily: setting.rows[0]?.daily ?? false,
    running: !!running.rowCount,
  };
}

// 迁移导入(data-model §3.1):保留 v1 的来源档案与人工映射。机构按规范机构记;同 id 同内容返回 200。
const key = z.string().min(1).max(200);
const linkImport = z
  .object({
    id: key,
    source: z.enum(webSources),
    slug: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .max(200),
    organizationId: key,
    name: z.string().trim().min(1).max(200),
    url: z.url({ protocol: /^https?$/ }).max(2000),
    mappedBy: key.nullable().default(null),
  })
  .strict();
async function importLink(client: Client, input: z.infer<typeof linkImport>): Promise<boolean> {
  const organizationId = await canonicalId(client, input.organizationId);
  const tags = await client.query<{ tag: string }>(
    'SELECT tag FROM omniboard.organization_tags WHERE organization_id = $1',
    [organizationId],
  );
  if (!tags.rowCount) problem(422, 'A referenced item has not been imported yet.');
  if (!tags.rows.some((t) => t.tag === 'exchange'))
    problem(422, 'Exchange sources can only be linked to exchange organizations.');
  const values = [
    input.id,
    input.source,
    input.slug,
    organizationId,
    input.name,
    input.url,
    input.mappedBy,
  ];
  const same = await client.query(
    `SELECT 1 FROM omniboard.source_entity_links
      WHERE id = $1 AND source = $2 AND slug = $3 AND organization_id = $4 AND name = $5 AND url = $6
        AND mapped_by IS NOT DISTINCT FROM $7`,
    values,
  );
  if (same.rowCount) return false;
  const other = await client.query(
    `SELECT 1 FROM omniboard.source_entity_links
      WHERE organization_id = $1 AND source = $2 AND id <> $3`,
    [organizationId, input.source, input.id],
  );
  if (other.rowCount)
    problem(409, 'This organization already has a different link to this source.');
  await insert(
    client,
    `INSERT INTO omniboard.source_entity_links (id, source, slug, organization_id, name, url, mapped_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    values,
  );
  return true;
}

export function registerSourceRoutes(app: FastifyInstance, deps: SourceDeps) {
  const { pool } = deps;
  app.get('/api/sources', async (request) => sourcesState(deps, request.user.role === 'admin'));
  const collectInput = z.object({ source: z.enum(webSources) }).strict();
  app.post('/api/sources/collect', async (request, reply) => {
    requireRole(request, 'admin');
    const { source } = collectInput.parse(request.body);
    const { runId } = await startCollection(pool, source, {
      fetcher: deps.fetcher,
      log: request.log,
    });
    return reply.code(202).send({ accepted: true, runId });
  });
  const scheduleInput = z.object({ daily: z.boolean() }).strict();
  app.post('/api/sources/schedule', async (request) => {
    requireRole(request, 'admin');
    const { daily } = scheduleInput.parse(request.body);
    await pool.query(
      `INSERT INTO omniboard.app_setting (key, value) VALUES ('daily_collection', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(daily)],
    );
    return { daily };
  });
  app.post('/api/import/source-links', async (request, reply) => {
    const input = linkImport.parse(request.body);
    await requireImport(pool, request);
    const created = await tx(pool, (client) => importLink(client, input));
    return reply.code(created ? 201 : 200).send({ ok: true });
  });
}
