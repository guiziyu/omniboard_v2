import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type Role, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { tagIds, type OrganizationTag } from '../shared/tags';
import {
  choosePoint,
  columns,
  columnsFor,
  defaultSort,
  metricBases,
  metricPeriod,
  qualifiers,
  reportingYear,
  type DirectoryOrganization,
  type MetricPoint,
} from '../shared/columns';
// 机构(data-model §3.2)与目录排名(frontend-spec 3.2–3.4、9.1)。

/** 取一个参数占位符;SQL 按需拼接,值一律走参数。 */
class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
const decimal = '^\\d{1,40}(\\.\\d{1,30})?$';
/**
 * 每个机构、每列、每个来源/单位/期间的最新一条候选值。采集值只取各来源最近一次成功采集。
 * organizations 为空 = 全部机构。
 */
function latestPoints(p: Params, organizations?: string[]): string {
  const orgs = organizations ? p.add(organizations) : null;
  const scope = (column: string) => (orgs ? `AND ${column} = ANY(${orgs}::text[])` : '');
  return `current_runs AS (
    SELECT DISTINCT ON (source) id FROM omniboard.collection_runs
     WHERE status = 'success' ORDER BY source, started_at DESC, id DESC
  ), candidates AS (
    SELECT ob.id || ':' || (j->>'key') AS id, l.organization_id, j->>'key' AS column_id,
           j->>'value' AS value, j->>'unit' AS unit,
           CASE j->>'key' WHEN 'volume_24h' THEN '24h' ELSE 'current' END AS period,
           l.source, CASE l.source WHEN 'cmc_web' THEN 'CoinMarketCap' ELSE 'CoinGecko' END AS source_name,
           l.url AS source_url, ob.evidence_id, e.captured_at, '' AS assumptions, ob.seq,
           'exact' AS qualifier
      FROM omniboard.source_observations ob
      JOIN current_runs cr ON cr.id = ob.run_id
      JOIN omniboard.source_entity_links l ON l.id = ob.link_id
      JOIN omniboard.evidence e ON e.id = ob.evidence_id
      CROSS JOIN LATERAL jsonb_array_elements(ob.metrics) j
     WHERE j->>'value' ~ ${p.add(decimal)} ${scope('l.organization_id')}
    UNION ALL
    SELECT m.id, m.organization_id, m.column_id, m.value::text, m.unit, m.period, 'manual',
           m.source_name, m.source_url, m.evidence_id, m.captured_at, m.assumptions, m.seq, m.qualifier
      FROM omniboard.metric_observations m WHERE true ${scope('m.organization_id')}
  ), latest AS (
    SELECT DISTINCT ON (organization_id, column_id, source, source_name, unit, period) *
      FROM candidates
     ORDER BY organization_id, column_id, source, source_name, unit, period,
              captured_at DESC, seq DESC, id DESC
  )`;
}
type PointRow = {
  id: string;
  organization_id: string;
  column_id: string;
  value: string;
  unit: string;
  period: string;
  source: string;
  source_name: string;
  source_url: string;
  evidence_id: string;
  captured_at: Date;
  assumptions: string;
  seq: string;
  qualifier: MetricPoint['qualifier'];
};
const providerName = (source: string) =>
  source === 'cmc_web'
    ? 'CoinMarketCap'
    : source === 'coingecko_web'
      ? 'CoinGecko'
      : 'Team observation';
function toPoint(row: PointRow): MetricPoint {
  const definition = columns.find((c) => c.id === row.column_id);
  return {
    id: row.id,
    organizationId: row.organization_id,
    columnId: row.column_id,
    value: row.value,
    unit: row.unit,
    period: row.period,
    source: row.source,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    evidenceId: row.evidence_id,
    capturedAt: row.captured_at.toISOString(),
    // 采集值没有团队填写的口径,用来源名加列定义代替(v1 explain())。
    assumptions:
      row.assumptions ||
      `${providerName(row.source)}. ${definition?.description || 'Provider-reported value.'}` +
        (row.column_id === 'volume_24h'
          ? ` Original ${row.unit} amount; no currency conversion.`
          : ''),
    sequence: Number(row.seq),
    qualifier: row.qualifier,
  };
}
export async function metricPoints(
  pool: Pool,
  organizations: string[],
  columnId?: string,
): Promise<MetricPoint[]> {
  const p = new Params();
  const cte = latestPoints(p, organizations);
  const column = columnId ? `WHERE column_id = ${p.add(columnId)}` : '';
  const result = await pool.query<PointRow>(
    `WITH ${cte} SELECT * FROM latest ${column} ORDER BY captured_at DESC, seq DESC`,
    p.values,
  );
  return result.rows.map(toPoint);
}

export const directoryQuery = z.object({
  q: z.string().max(200).default(''),
  tag: z.enum(['', ...tagIds]).default(''),
  sort: z.string().max(40).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
  basis: z.enum(metricBases).default('preferred'),
  unit: z.string().max(20).optional(),
  year: z
    .string()
    .regex(/^(19|20|21)\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  // 旧链接参数;界面已不用(frontend-spec 3.2),API 保留给 agent 只取有值的机构。
  rankedOnly: z.enum(['true', 'false']).default('false'),
});
export const rankingPolicy =
  'Preferred source uses CoinMarketCap, then CoinGecko, then team observations, within the same unit and period. No averaging or currency conversion. Ties share a rank; missing values remain unranked. Search preserves ranks within the selected tag.';
/** 目录:在所选 tag 内先排名,再搜索、分页,所以搜索与翻页不改变名次(frontend-spec 3.4)。 */
export async function directory(pool: Pool, role: Role, input: unknown, now: number) {
  const query = directoryQuery.parse(input);
  const year = query.year ?? reportingYear(now);
  const available = columnsFor(query.tag);
  const sort = !query.sort || query.sort === 'rank' ? defaultSort(query.tag) : query.sort;
  const definition = available.find((c) => c.id === sort);
  if (!definition && !['name', 'updated'].includes(sort))
    problem(422, 'This ranking column is not available for the selected organization tag.');
  const unit = query.unit || definition?.units[0] || '';
  if (definition && !definition.units.includes(unit))
    problem(422, 'The selected unit is not supported for this column.');
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';

  const p = new Params();
  const ctes: string[] = [];
  let key: string;
  let join = '';
  if (definition?.kind === 'metric') {
    ctes.push(latestPoints(p));
    const basis = p.add(query.basis);
    ctes.push(`chosen AS (
      SELECT DISTINCT ON (organization_id) organization_id, value FROM latest
       WHERE column_id = ${p.add(sort)} AND unit = ${p.add(unit)}
         AND period = ${p.add(metricPeriod(definition, year))}
         AND (${basis} = 'preferred' OR source = ${basis})
       ORDER BY organization_id,
                CASE source WHEN 'cmc_web' THEN 0 WHEN 'coingecko_web' THEN 1 ELSE 2 END,
                captured_at DESC, seq DESC, id DESC)`);
    key = 'ch.value::numeric';
    join = 'LEFT JOIN chosen ch ON ch.organization_id = o.id';
  } else if (sort === 'record_count') {
    key = `(SELECT count(*) FROM omniboard.module_records r
             WHERE r.organization_id = o.id AND (r.visibility = 'team' OR ${p.add(role === 'admin')}))`;
  } else if (sort === 'name') key = 'lower(o.name) COLLATE "C"';
  else key = 'o.created_at';
  const tag = p.add(query.tag);
  ctes.push(`cohort AS (
    SELECT o.id, o.name, ${key} AS sort_key FROM omniboard.organizations o ${join}
     WHERE NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
       AND (${tag} = '' OR EXISTS (SELECT 1 FROM omniboard.organization_tags t
                                    WHERE t.organization_id = o.id AND t.tag = ${tag}))
  ), ranked AS (
    SELECT *, CASE WHEN sort_key IS NOT NULL
                   THEN rank() OVER (ORDER BY sort_key ${direction} NULLS LAST) END AS rank
      FROM cohort
  ), filtered AS (
    SELECT * FROM ranked
     WHERE strpos(lower(name), lower(${p.add(query.q)})) > 0
       AND (${p.add(query.rankedOnly === 'true')} = false OR rank IS NOT NULL)
  )`);
  const result = await pool.query<{ total: string; id: string | null; rank: string | null }>(
    `WITH ${ctes.join(', ')}
     SELECT t.total, f.id, f.rank FROM (SELECT count(*) AS total FROM filtered) t
     LEFT JOIN LATERAL (
       SELECT id, rank FROM filtered
        ORDER BY sort_key ${direction} NULLS LAST, lower(name) COLLATE "C", id
        LIMIT ${p.add(query.pageSize)} OFFSET ${p.add((query.page - 1) * query.pageSize)}
     ) f ON true`,
    p.values,
  );
  const page = result.rows.filter((r) => r.id !== null) as { id: string; rank: string | null }[];
  const ids = page.map((r) => r.id);
  const details = await organizationRows(pool, ids, role);
  const points = await metricPoints(pool, ids);
  const organizations: DirectoryOrganization[] = page.map((row) => {
    const org = details.get(row.id)!;
    const own = points.filter((pt) => pt.organizationId === row.id);
    const values = Object.fromEntries(
      available
        .filter((c) => c.kind === 'metric')
        .map((c) => [
          c.id,
          choosePoint(own, c, c.id === sort ? unit : c.units[0]!, year, query.basis),
        ]),
    );
    return { ...org, rank: row.rank === null ? null : Number(row.rank), values };
  });
  return {
    organizations,
    total: Number(result.rows[0]?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    columns: available,
    ranking: {
      sort,
      direction: query.direction,
      unit,
      year,
      basis: query.basis,
      description: definition?.description || 'Alphabetical or creation-date ordering.',
      policy: rankingPolicy,
    },
  };
}
type OrganizationRow = Omit<DirectoryOrganization, 'rank' | 'values'>;
// 带上 logo 证据 id:换 logo 后地址随之变化,浏览器缓存不会显示旧图。
const logoUrl = (organizationId: string, evidenceId: string) =>
  `/api/organizations/${encodeURIComponent(organizationId)}/logo?v=${encodeURIComponent(evidenceId)}`;
async function organizationRows(
  pool: Pool | Client,
  ids: string[],
  role: Role,
): Promise<Map<string, OrganizationRow>> {
  const result = await pool.query<{
    id: string;
    name: string;
    description: string;
    created_at: Date;
    logo: string | null;
    tags: OrganizationTag[];
    record_count: string;
  }>(
    `SELECT o.id, o.name, o.description, o.created_at,
            (SELECT g.logo_evidence_id FROM omniboard.organization_logos g WHERE g.organization_id = o.id) AS logo,
            ARRAY(SELECT t.tag FROM omniboard.organization_tags t
                   WHERE t.organization_id = o.id ORDER BY t.tag) AS tags,
            (SELECT count(*) FROM omniboard.module_records r
              WHERE r.organization_id = o.id AND (r.visibility = 'team' OR $2)) AS record_count
       FROM omniboard.organizations o WHERE o.id = ANY($1::text[])`,
    [ids, role === 'admin'],
  );
  return new Map(
    result.rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        description: r.description,
        createdAt: r.created_at.toISOString(),
        logoUrl: r.logo ? logoUrl(r.id, r.logo) : '',
        tags: r.tags,
        recordCount: Number(r.record_count),
      },
    ]),
  );
}
/** 已合并为别名的旧机构 ID → 规范 ID(frontend-spec 4.1)。 */
export async function canonicalId(pool: Pool | Client, organizationId: string): Promise<string> {
  const result = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM omniboard.organization_aliases WHERE alias_id = $1',
    [organizationId],
  );
  return result.rows[0]?.organization_id ?? organizationId;
}
export async function getOrganization(
  pool: Pool | Client,
  organizationId: string,
  role: Role,
): Promise<OrganizationRow> {
  const canonical = await canonicalId(pool, organizationId);
  const org = (await organizationRows(pool, [canonical], role)).get(canonical);
  if (!org) problem(404, 'Organization not found.');
  return org;
}
/**
 * 机构别名(data-model §3.2):合并后的旧机构 → 规范机构。只经导入写入;规范机构自己不能是别名,
 * 同 alias 同目标视为已导入,指向别处返回 409。
 */
export const organizationAliasInput = z
  .object({
    aliasId: z.string().min(1).max(100),
    organizationId: z.string().min(1).max(100),
    reason: z.string().trim().min(1).max(500),
    createdAt: z.iso.datetime({ offset: true }),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export async function importOrganizationAlias(
  pool: Pool,
  input: z.infer<typeof organizationAliasInput>,
): Promise<boolean> {
  if (input.aliasId === input.organizationId)
    problem(422, 'An organization cannot be an alias of itself.');
  return tx(pool, async (client) => {
    const found = await client.query('SELECT id FROM omniboard.organizations WHERE id = ANY($1)', [
      [input.aliasId, input.organizationId],
    ]);
    if (found.rowCount !== 2)
      problem(422, 'Both organizations must exist before they can be aliased.');
    const chained = await client.query(
      'SELECT 1 FROM omniboard.organization_aliases WHERE alias_id = $1 OR organization_id = $2',
      [input.organizationId, input.aliasId],
    );
    if (chained.rowCount) problem(422, 'Aliases must point directly to a canonical organization.');
    const inserted = await client.query(
      `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, created_at, payload)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (alias_id) DO NOTHING`,
      [input.aliasId, input.organizationId, input.reason, input.createdAt, input.payload],
    );
    if (inserted.rowCount) return true;
    const current = await client.query<{ organization_id: string }>(
      'SELECT organization_id FROM omniboard.organization_aliases WHERE alias_id = $1',
      [input.aliasId],
    );
    if (current.rows[0]!.organization_id !== input.organizationId)
      problem(409, 'This organization is already an alias of another organization.');
    return false;
  });
}
export async function organizationCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM omniboard.organizations o
      WHERE NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)`,
  );
  return Number(result.rows[0]!.n);
}

export const organizationInput = z
  .object({
    // agent 迁移时传入 v1 原 id(proposal §9)。
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(3000).default(''),
    tags: z
      .array(z.enum(tagIds))
      .min(1, 'Select at least one organization tag.')
      .transform((tags) => [...new Set(tags)]),
    createdAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type OrganizationInput = z.infer<typeof organizationInput>;
export async function createOrganization(
  pool: Pool,
  user: User,
  input: Omit<OrganizationInput, 'createdAt'>,
  createdAt?: Date,
): Promise<OrganizationRow> {
  const organizationId = input.id ?? id();
  return tx(pool, async (client) => {
    const inserted = await client.query(
      `INSERT INTO omniboard.organizations (id, name, description, created_at)
       VALUES ($1,$2,$3,COALESCE($4, now())) ON CONFLICT (id) DO NOTHING`,
      [organizationId, input.name, input.description, createdAt ?? null],
    );
    if (!inserted.rowCount) problem(409, 'An organization with this id already exists.');
    await client.query(
      `INSERT INTO omniboard.organization_tags (organization_id, tag)
       SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [organizationId, input.tags],
    );
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id)
       VALUES ($1,$2,'organization_created',1,$3,$4)`,
      [
        id(),
        organizationId,
        { name: input.name, description: input.description, tags: input.tags },
        user.id,
      ],
    );
    return (await organizationRows(client, [organizationId], user.role)).get(organizationId)!;
  });
}

/** 设置 logo(frontend-spec 2.16):原件是一条 team 可见的图片证据。 */
export async function setLogo(
  pool: Pool,
  organizationId: string,
  input: { logoEvidenceId: string; sourceUrl: string; evidenceId?: string },
): Promise<void> {
  const logo = await pool.query<{ content_type: string; visibility: string }>(
    'SELECT content_type, visibility FROM omniboard.evidence WHERE id = $1',
    [input.logoEvidenceId],
  );
  const row = logo.rows[0];
  if (!row) problem(422, 'Logo evidence not found.');
  if (!row.content_type.startsWith('image/') || row.visibility !== 'team')
    problem(422, 'A logo must be a team-visible image.');
  const result = await pool.query(
    `INSERT INTO omniboard.organization_logos (organization_id, logo_evidence_id, source_url, evidence_id)
     SELECT id, $2, $3, $4 FROM omniboard.organizations WHERE id = $1
     ON CONFLICT (organization_id) DO UPDATE
       SET logo_evidence_id = EXCLUDED.logo_evidence_id, source_url = EXCLUDED.source_url,
           evidence_id = EXCLUDED.evidence_id`,
    [organizationId, input.logoEvidenceId, input.sourceUrl, input.evidenceId ?? null],
  );
  if (!result.rowCount) problem(404, 'Organization not found.');
}
export async function logoEvidence(pool: Pool, organizationId: string) {
  const result = await pool.query<{ sha256: string; content_type: string }>(
    `SELECT e.sha256, e.content_type FROM omniboard.organization_logos g
       JOIN omniboard.evidence e ON e.id = g.logo_evidence_id WHERE g.organization_id = $1`,
    [organizationId],
  );
  return result.rows[0] ?? problem(404, 'Logo not found.');
}

export const metricInput = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    qualifier: z.enum(qualifiers).default('exact'),
    columnId: z.string().max(40),
    value: z.string().regex(/^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/),
    unit: z.string().max(20),
    period: z.string().max(20),
    sourceName: z.string().trim().min(1).max(160),
    sourceUrl: z
      .string()
      .max(2000)
      .refine((v) => !v || (/^https?:\/\//.test(v) && URL.canParse(v))),
    assumptions: z.string().trim().min(1).max(3000),
    rawText: z
      .string()
      .min(1)
      .max(100000)
      .refine((v) => v.trim().length > 0),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type MetricInput = z.infer<typeof metricInput>;
/** 添加团队观测(frontend-spec 9.3):原文存为证据,观测只追加;同来源同期间的新值取代旧值显示。 */
export async function recordMetric(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  organizationId: string,
  input: Omit<MetricInput, 'capturedAt'>,
  capturedAt?: Date,
): Promise<{ id: string; evidenceId: string }> {
  const tags = await pool.query<{ tag: OrganizationTag }>(
    'SELECT tag FROM omniboard.organization_tags WHERE organization_id = $1',
    [organizationId],
  );
  if (!tags.rowCount) problem(404, 'Organization not found.');
  const orgTags = tags.rows.map((r) => r.tag);
  const column = columns.find(
    (c) =>
      c.id === input.columnId && c.kind === 'metric' && c.tags.some((t) => orgTags.includes(t)),
  );
  if (!column) problem(422, 'This metric is not available for these organization tags.');
  if (!column.units.includes(input.unit)) problem(422, 'Unsupported metric unit.');
  if (
    column.period === 'annual'
      ? !/^(19|20|21)\d{2}$/.test(input.period)
      : column.period !== input.period
  )
    problem(422, 'A valid reporting period is required.');
  const metricId = input.id ?? id();
  return tx(pool, async (client) => {
    const evidenceId = await saveEvidence(
      client,
      store,
      Buffer.from(input.rawText),
      {
        source: 'manual',
        url: input.sourceUrl,
        contentType: 'text/plain; charset=utf-8',
        filename: `${column.id}-reference.txt`,
      },
      { capturedAt },
    );
    const inserted = await client.query(
      `INSERT INTO omniboard.metric_observations
         (id, organization_id, column_id, value, qualifier, unit, period, source_name, source_url,
          assumptions, evidence_id, captured_at, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()),$13) ON CONFLICT (id) DO NOTHING`,
      [
        metricId,
        organizationId,
        column.id,
        input.value,
        input.qualifier,
        input.unit,
        input.period,
        input.sourceName,
        input.sourceUrl,
        input.assumptions,
        evidenceId,
        capturedAt ?? null,
        user.id,
      ],
    );
    if (!inserted.rowCount) problem(409, 'A metric observation with this id already exists.');
    // 原文已存为证据,历史里只记证据 id。
    const payload: Record<string, unknown> = { ...input, evidenceId };
    delete payload.rawText;
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id)
       VALUES ($1,$2,'metric_recorded',1,$3,$4)`,
      [id(), metricId, payload, user.id],
    );
    return { id: metricId, evidenceId };
  });
}

/**
 * 同名但未确认身份的其他来源档案(frontend-spec 9.2「Other source matches」):名称大小写不敏感相等、
 * 尚未人工映射、本机构还没有该来源的链接;最多 10 条。这些观测不计入本机构。
 */
export async function sourceMatches(pool: Pool, organizationId: string) {
  const links = await pool.query<{
    linkId: string;
    profileName: string;
    organizationId: string;
    source: string;
  }>(
    `SELECT l.id AS "linkId", l.name AS "profileName", l.organization_id AS "organizationId", l.source
       FROM omniboard.source_entity_links l
       JOIN omniboard.organizations target ON target.id = $1
      WHERE l.organization_id <> $1 AND l.mapped_by IS NULL AND lower(l.name) = lower(target.name)
        AND NOT EXISTS (SELECT 1 FROM omniboard.source_entity_links own
                         WHERE own.organization_id = $1 AND own.source = l.source)
      ORDER BY l.source, l.id LIMIT 10`,
    [organizationId],
  );
  const points = await metricPoints(
    pool,
    links.rows.map((l) => l.organizationId),
  );
  return links.rows.map((link) => ({
    ...link,
    points: points.filter(
      (p) => p.organizationId === link.organizationId && p.source === link.source,
    ),
  }));
}
/** 确认身份并把来源链接归到本机构(frontend-spec 9.2、9.6):仅 admin,只能链到交易所。 */
export async function linkSource(
  pool: Pool,
  user: User,
  linkId: string,
  organizationId: string,
): Promise<void> {
  await tx(pool, async (client) => {
    const tags = await client.query<{ tag: string }>(
      'SELECT tag FROM omniboard.organization_tags WHERE organization_id = $1',
      [organizationId],
    );
    if (!tags.rowCount) problem(404, 'Organization not found.');
    if (!tags.rows.some((t) => t.tag === 'exchange'))
      problem(422, 'Exchange sources can only be linked to exchange organizations.');
    const link = (
      await client.query<{ source: string; organization_id: string }>(
        'SELECT source, organization_id FROM omniboard.source_entity_links WHERE id = $1 FOR UPDATE',
        [linkId],
      )
    ).rows[0];
    if (!link) problem(404, 'Source mapping not found.');
    const other = await client.query(
      `SELECT 1 FROM omniboard.source_entity_links
        WHERE organization_id = $1 AND source = $2 AND id <> $3`,
      [organizationId, link.source, linkId],
    );
    if (other.rowCount)
      problem(409, 'This organization already has a different link to this source.');
    await client.query(
      'UPDATE omniboard.source_entity_links SET organization_id = $2, mapped_by = $3 WHERE id = $1',
      [linkId, organizationId, user.id],
    );
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id)
       VALUES ($1,$2,'source_mapped',1,$3,$4)`,
      [id(), linkId, { from: link.organization_id, to: organizationId }, user.id],
    );
  });
}
