import pg from 'pg';
import type { Pool } from './db';
import { id, tx } from './db';
import { Problem, problem } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { knownExchangeOrganization } from './exchange-identities';
import { parsePage, sources } from './source-pages';
import { webSources, type WebSourceId } from '../shared/sources';
// 排行页采集(frontend-spec 9.7),从 v1 src/collectors/collect.ts 迁移。每次采集先存原始 HTML 证据,
// 解析与发布在一个事务里;失败的批次不发布,上一次成功批次继续生效。同时最多一个运行(部分唯一索引)。

export type Page = { bytes: Buffer; contentType: string };
export type Fetcher = (url: string) => Promise<Page>;
type Log = { error: (error: unknown) => void };

export async function fetchPage(url: string): Promise<Page> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: {
      'User-Agent': 'Omniboard/0.1 (internal organization research)',
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`Page HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('The source did not return HTML.');
  if (!response.body) throw new Error('Page body is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 5_000_000) throw new Error('Page exceeds the 5 MB limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

export const INTERRUPTED = 'Interrupted after restart. The last successful batch is retained.';
export const PROCESSING_FAILED = 'Data processing failed. This batch was not published.';
/** 服务启动时(已持有单实例锁)把上次遗留的 running 改为 interrupted。 */
export async function recoverRuns(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE omniboard.collection_runs SET status = 'interrupted', finished_at = now(), error = $1
      WHERE status = 'running'`,
    [INTERRUPTED],
  );
  return result.rowCount ?? 0;
}

const activeJobs = new Set<Promise<unknown>>();
/** 关闭服务前等所有后台采集结束。 */
export async function waitForCollections(): Promise<void> {
  await Promise.allSettled([...activeJobs]);
}

/**
 * 开始一次采集:先登记 running(已有运行时 409),然后在后台抓取、存证、解析、发布。
 * 返回 runId 和后台任务;后台任务不会 reject,失败记在运行记录上。
 */
export async function startCollection(
  pool: Pool,
  store: EvidenceStore,
  source: WebSourceId,
  options: { fetcher?: Fetcher; limit?: number; log?: Log } = {},
): Promise<{ runId: string; done: Promise<void> }> {
  const runId = id();
  try {
    await pool.query(
      `INSERT INTO omniboard.collection_runs (id, source, status) VALUES ($1,$2,'running')`,
      [runId, source],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      problem(409, 'A collection is already running.');
    throw error;
  }
  const done = execute(pool, store, runId, source, options).catch((error: unknown) =>
    options.log?.error(error),
  );
  activeJobs.add(done);
  void done.finally(() => activeJobs.delete(done));
  return { runId, done };
}

async function execute(
  pool: Pool,
  store: EvidenceStore,
  runId: string,
  source: WebSourceId,
  { fetcher = fetchPage, limit = 50, log }: { fetcher?: Fetcher; limit?: number; log?: Log },
): Promise<void> {
  const config = sources[source];
  try {
    const page = await fetcher(config.url);
    // 原文先存:失败的批次也能在活动表里打开原文。
    await tx(pool, async (client) => {
      const evidenceId = await saveEvidence(client, store, page.bytes, {
        source,
        url: config.url,
        contentType: page.contentType,
        parserVersion: config.parserVersion,
        filename: `${source}.html`,
      });
      await client.query('UPDATE omniboard.collection_runs SET evidence_id = $2 WHERE id = $1', [
        runId,
        evidenceId,
      ]);
    });
    const rows = parsePage(source, page.bytes.toString('utf8'), limit);
    const previous = await pool.query<{ row_count: number }>(
      `SELECT row_count FROM omniboard.collection_runs WHERE source = $1 AND status = 'success'
        ORDER BY started_at DESC LIMIT 1`,
      [source],
    );
    if (previous.rows[0] && rows.length < previous.rows[0].row_count * 0.8)
      throw new Error(
        'Collection coverage dropped unexpectedly. The last successful batch is retained.',
      );
    await tx(pool, async (client) => {
      const run = await client.query<{ evidence_id: string }>(
        'SELECT evidence_id FROM omniboard.collection_runs WHERE id = $1',
        [runId],
      );
      const evidenceId = run.rows[0]!.evidence_id;
      for (const row of rows) {
        let linkId = (
          await client.query<{ id: string }>(
            'SELECT id FROM omniboard.source_entity_links WHERE source = $1 AND slug = $2',
            [source, row.slug],
          )
        ).rows[0]?.id;
        if (!linkId) {
          // 新 slug:对照表里有已采集的配对档案就归到那个机构,否则新建一个交易所机构。
          let organizationId = await knownExchangeOrganization(client, source, row.slug);
          if (!organizationId) {
            organizationId = id();
            await client.query('INSERT INTO omniboard.organizations (id, name) VALUES ($1,$2)', [
              organizationId,
              row.name,
            ]);
            await client.query(
              `INSERT INTO omniboard.organization_tags (organization_id, tag) VALUES ($1,'exchange')`,
              [organizationId],
            );
          }
          linkId = id();
          await client.query(
            `INSERT INTO omniboard.source_entity_links (id, source, slug, organization_id, name, url)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [linkId, source, row.slug, organizationId, row.name, row.url],
          );
        }
        await client.query(
          `INSERT INTO omniboard.source_observations (id, link_id, evidence_id, run_id, rank, metrics)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id(), linkId, evidenceId, runId, row.rank, JSON.stringify(row.metrics)],
        );
      }
      // 运行期间服务重启过(已被标为 interrupted)就不发布。
      const finished = await client.query(
        `UPDATE omniboard.collection_runs SET status = 'success', finished_at = now(), row_count = $2
          WHERE id = $1 AND status = 'running'`,
        [runId, rows.length],
      );
      if (!finished.rowCount) throw new Error(INTERRUPTED);
    });
  } catch (error) {
    // 数据库内部错误不展示给用户(frontend-spec 9.5),原文只进日志。
    const database = error instanceof pg.DatabaseError;
    if (database) log?.error(error);
    const message = database ? PROCESSING_FAILED : String((error as Error).message);
    await pool.query(
      `UPDATE omniboard.collection_runs SET status = 'failed', finished_at = now(), error = $2
        WHERE id = $1 AND status = 'running'`,
      [runId, message.slice(0, 500)],
    );
  }
}

/**
 * 每日采集(每分钟调用一次):开关打开、没有运行中的任务时,对最近一次运行已满 24 小时(或从未运行)的
 * 来源发起一次采集,每次只发起一个。返回发起的来源。
 */
export async function dailyCollection(
  pool: Pool,
  store: EvidenceStore,
  now: number,
  options: { fetcher?: Fetcher; log?: Log } = {},
): Promise<WebSourceId | null> {
  const state = await pool.query<{ daily: boolean; running: boolean }>(
    `SELECT COALESCE((SELECT value = 'true'::jsonb FROM omniboard.app_setting
                       WHERE key = 'daily_collection'), false) AS daily,
            EXISTS (SELECT 1 FROM omniboard.collection_runs WHERE status = 'running') AS running`,
  );
  if (!state.rows[0]!.daily || state.rows[0]!.running) return null;
  const latest = await pool.query<{ source: WebSourceId; started_at: Date }>(
    `SELECT DISTINCT ON (source) source, started_at FROM omniboard.collection_runs
      ORDER BY source, started_at DESC`,
  );
  for (const source of webSources) {
    const last = latest.rows.find((r) => r.source === source)?.started_at;
    if (last && now - last.getTime() < 86_400_000) continue;
    try {
      await startCollection(pool, store, source, options);
    } catch (error) {
      // 与手动采集撞上时跳过这一分钟。
      if (error instanceof Problem && error.statusCode === 409) return null;
      throw error;
    }
    return source;
  }
  return null;
}
