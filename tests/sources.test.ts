import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrapAdmin } from '../src/server/auth';
import { metric, parsePage } from '../src/server/source-pages';
import { knownExchangeOrganization } from '../src/server/exchange-identities';
import {
  dailyCollection,
  INTERRUPTED,
  PROCESSING_FAILED,
  recoverRuns,
  startCollection,
  waitForCollections,
  type Fetcher,
} from '../src/server/collect';
import type { DirectoryOrganization, MetricPoint } from '../src/shared/columns';
import type { SourcesState, WebSourceId } from '../src/shared/sources';
import { harness, tokenOf } from './helpers';
// 数据来源、排行页采集与来源身份(frontend-spec 9.4–9.7)。v1 tests/domain.test.ts 的解析断言、
// tests/exchange-identities.test.ts 的身份断言、tests/integration.test.ts 的失败批次断言逐条保留。

const fixture = (source: WebSourceId) => readFileSync(`tests/fixtures/${source}.html`, 'utf8');
const page = (html: string) => ({ bytes: Buffer.from(html), contentType: 'text/html' });
const fixtures: Fetcher = async (url) =>
  page(fixture(url.includes('coingecko') ? 'coingecko_web' : 'cmc_web'));

test('amounts preserve decimal strings and unknown never becomes zero', () => {
  assert.deepEqual(metric('v', 'Volume', 'BTC127,076.6283', 'BTC'), {
    key: 'v',
    label: 'Volume',
    rawText: 'BTC127,076.6283',
    value: '127076.6283',
    unit: 'BTC',
    precision: 4,
  });
  assert.equal(metric('v', 'Volume', '—', 'USD').value, null);
  assert.equal(metric('v', 'Volume', '$0', 'USD').value, '0');
  assert.equal(
    metric('v', 'Volume', '12345678901234567890.12345678', 'USD').value,
    '12345678901234567890.12345678',
  );
});

test('CMC uses spot volume and verifies embedded rows against the public table', () => {
  const html = fixture('cmc_web');
  const rows = parsePage('cmc_web', html);
  assert.equal(rows.length, 50);
  assert.equal(rows[0]?.name, 'Binance');
  assert.equal(rows[0]?.metrics[0]?.unit, 'USD');
  assert.ok(rows[49]?.metrics[0]?.value);
  assert.equal(rows[0]?.metrics.find((m) => m.key === 'liquidity')?.value, '928');
  assert.throws(() => parsePage('cmc_web', html.replace('$9,592,847,641', '$1')), /does not match/);
});

test('CoinGecko uses displayed BTC precision, not the hidden converted currency', () => {
  const rows = parsePage('coingecko_web', fixture('coingecko_web'));
  assert.equal(rows.length, 50);
  assert.equal(rows[0]?.metrics[1]?.unit, 'BTC');
  assert.equal(rows[0]?.metrics[1]?.precision, 4);
  assert.equal(rows[0]?.metrics[0]?.value, '10');
});

test('challenge, wrong headers, row loss and unknown units are rejected', () => {
  assert.throws(() => parsePage('cmc_web', '<title>Just a moment</title>'), /challenge/);
  assert.throws(
    () => parsePage('coingecko_web', '<table><thead>Exchange Changed</thead></table>'),
    /headers/,
  );
  const html = fixture('coingecko_web');
  assert.throws(() => parsePage('coingecko_web', html.replaceAll('BTC', 'XYZ')), /currency/);
  assert.throws(
    () => parsePage('coingecko_web', html.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>')),
    /valid rows/,
  );
});

async function setup(fetcher: Fetcher = fixtures) {
  let current = fetcher;
  const h = await harness({ sourceFetcher: (url) => current(url) });
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const sessions: Record<string, string> = { admin: owner.cookie };
  for (const role of ['editor', 'reader']) {
    h.tick();
    const invited = await h.request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name: role, email: `${role}@example.test`, role },
    );
    sessions[role] = (await h.activate(tokenOf(invited.json().inviteLink))).cookie;
  }
  const as = (role: string) => ({ cookie: sessions[role]! });
  const store = h.store;
  const pool = h.db.pool;
  /** 直接调用采集并等它写完运行记录。 */
  async function collect(source: WebSourceId, options: { fetcher?: Fetcher; limit?: number } = {}) {
    const { runId, done } = await startCollection(pool, store, source, {
      fetcher: options.fetcher ?? current,
      limit: options.limit,
    });
    await done;
    return (
      await pool.query<{ status: string; error: string | null; evidence_id: string | null }>(
        'SELECT status, error, evidence_id FROM omniboard.collection_runs WHERE id = $1',
        [runId],
      )
    ).rows[0]!;
  }
  const directory = async (query = '') =>
    (await h.request('GET', `/api/organizations?pageSize=100${query}`, as('reader'))).json() as {
      total: number;
      organizations: DirectoryOrganization[];
    };
  const points = async (organizationId: string) =>
    (await h.request('GET', `/api/organizations/${organizationId}/metrics`, as('reader'))).json()
      .points as MetricPoint[];
  const count = async (table: string) =>
    Number((await pool.query(`SELECT count(*) AS n FROM omniboard.${table}`)).rows[0].n);
  return {
    h,
    pool,
    store,
    as,
    collect,
    directory,
    points,
    count,
    setFetcher: (f: Fetcher) => (current = f),
  };
}

test('either collection order reuses verified identities and repeated runs keep one directory row', async (t) => {
  for (const order of [
    ['cmc_web', 'coingecko_web'],
    ['coingecko_web', 'cmc_web'],
  ] as const) {
    const s = await setup();
    t.after(s.h.close);
    for (const source of order) assert.equal((await s.collect(source)).status, 'success');
    const all = await s.directory();
    assert.equal(all.total, 74);
    assert.equal(new Set(all.organizations.map((o) => o.name.toLowerCase())).size, 74);
    for (const tag of ['', '&tag=exchange']) {
      const matches = (await s.directory(`&q=Binance${tag}`)).organizations.filter(
        (o) => o.name === 'Binance',
      );
      assert.equal(matches.length, 1);
      assert.deepEqual(matches[0]!.sourceNames, ['cmc_web', 'coingecko_web']);
      const points = await s.points(matches[0]!.id);
      assert.deepEqual(
        new Set(points.filter((p) => p.columnId === 'volume_24h').map((p) => p.unit)),
        new Set(['USD', 'BTC']),
      );
      assert.equal(new Set(points.map((p) => p.evidenceId)).size, 2);
    }
    // 自动建的机构带 exchange(触发器补 company)。
    const tags = await s.pool.query(
      `SELECT DISTINCT tag FROM omniboard.organization_tags ORDER BY tag`,
    );
    assert.deepEqual(
      tags.rows.map((r) => r.tag),
      ['company', 'exchange'],
    );
    for (const source of order) await s.collect(source);
    assert.equal((await s.directory()).total, 74);
    assert.equal(await s.count('source_entity_links'), 100);
    // 原始 HTML 作为证据保存,带解析器版本。
    const evidence = await s.pool.query(
      `SELECT DISTINCT parser_version, filename, visibility FROM omniboard.evidence ORDER BY 1`,
    );
    assert.deepEqual(evidence.rows, [
      { parser_version: 'cmc-html-v1', filename: 'cmc_web.html', visibility: 'team' },
      { parser_version: 'coingecko-html-v1', filename: 'coingecko_web.html', visibility: 'team' },
    ]);
  }
});

test('unreviewed names and administrator mappings are never merged implicitly', async (t) => {
  const s = await setup();
  t.after(s.h.close);
  const ownerId = (await s.h.request('GET', '/api/session', s.as('admin'))).json().user.id;
  const exchange = async (name: string) => {
    const created = await s.h.request('POST', '/api/organizations', s.as('editor'), {
      name,
      tags: ['exchange'],
    });
    return created.json().id as string;
  };
  const reviewed = await exchange('Binance');
  await s.pool.query(
    `INSERT INTO omniboard.source_entity_links (id, source, slug, organization_id, name, url, mapped_by)
     VALUES ('cmc-binance','cmc_web','binance',$1,'Binance','https://example.test/',$2)`,
    [reviewed, ownerId],
  );
  const client = await s.pool.connect();
  try {
    // 管理员改过映射的档案不参与自动配对;不在对照表里的同名档案也不配对。
    assert.equal(await knownExchangeOrganization(client, 'coingecko_web', 'binance'), undefined);
    assert.equal(
      await knownExchangeOrganization(client, 'coingecko_web', 'same-name-but-unreviewed'),
      undefined,
    );
    // 配对档案所在的机构已被合并时,归到规范机构。
    const legacy = await exchange('Kraken (legacy)');
    const canonical = await exchange('Kraken');
    await s.pool.query(
      `INSERT INTO omniboard.source_entity_links (id, source, slug, organization_id, name, url)
       VALUES ('cmc-kraken','cmc_web','kraken',$1,'Kraken','https://example.test/')`,
      [legacy],
    );
    await s.pool.query(
      `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
       VALUES ($1,$2,'merged','{}')`,
      [legacy, canonical],
    );
    assert.equal(await knownExchangeOrganization(client, 'coingecko_web', 'kraken'), canonical);
  } finally {
    client.release();
  }
  await s.collect('coingecko_web');
  const binance = (await s.directory('&q=Binance')).organizations.filter(
    (o) => o.name === 'Binance',
  );
  assert.equal(binance.length, 2, 'the reviewed CMC profile keeps its own organization');
});

test('failed collectors and interrupted runs cannot replace the last good batch', async (t) => {
  const s = await setup();
  t.after(s.h.close);
  assert.equal((await s.collect('cmc_web')).status, 'success');
  const binance = (await s.directory('&q=Binance')).organizations.find(
    (o) => o.name === 'Binance',
  )!;
  const before = (await s.points(binance.id))[0]!.evidenceId;

  const challenge = await s.collect('cmc_web', {
    fetcher: async () => page('<title>Just a moment</title>'),
  });
  assert.equal(challenge.status, 'failed');
  assert.match(challenge.error!, /challenge page/);
  assert.ok(challenge.evidence_id, 'the rejected page is kept as evidence');
  assert.equal((await s.points(binance.id))[0]!.evidenceId, before);

  // 行数少于上一次成功批次的 80%。
  const shrunk = await s.collect('cmc_web', { limit: 10 });
  assert.equal(shrunk.status, 'failed');
  assert.match(shrunk.error!, /coverage dropped/);

  // HTTP 失败:没有原文。
  const http = await s.collect('cmc_web', {
    fetcher: async () => {
      throw new Error('Page HTTP 503');
    },
  });
  assert.deepEqual([http.status, http.error, http.evidence_id], ['failed', 'Page HTTP 503', null]);

  // 数据库错误不暴露内部信息。
  const tooLong = fixture('coingecko_web').replace(
    /(\/en\/exchanges\/zoomex">\s*<div>)\s*Zoomex\s*/,
    `$1${'Z'.repeat(200)}`,
  );
  const database = await s.collect('coingecko_web', { fetcher: async () => page(tooLong) });
  assert.deepEqual([database.status, database.error], ['failed', PROCESSING_FAILED]);
  assert.equal(await s.count('source_observations'), 50, 'nothing from the failed batch');

  // 同时只有一个运行;重启后遗留的 running 改为 interrupted。
  await s.pool.query(
    `INSERT INTO omniboard.collection_runs (id, source, status) VALUES ('stale','cmc_web','running')`,
  );
  await assert.rejects(() => s.collect('coingecko_web'), /already running/);
  assert.equal(
    (
      await s.h.request('POST', '/api/sources/collect', s.as('admin'), {
        source: 'coingecko_web',
      })
    ).statusCode,
    409,
  );
  assert.equal(await recoverRuns(s.pool), 1);
  const stale = await s.pool.query(
    `SELECT status, error, finished_at FROM omniboard.collection_runs WHERE id = 'stale'`,
  );
  assert.equal(stale.rows[0].status, 'interrupted');
  assert.equal(stale.rows[0].error, INTERRUPTED);
  assert.ok(stale.rows[0].finished_at);

  // 运行期间被标为 interrupted 的批次不发布。
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { runId, done } = await startCollection(s.pool, s.store, 'coingecko_web', {
    fetcher: async (url) => {
      await gate;
      return fixtures(url);
    },
  });
  await recoverRuns(s.pool);
  release();
  await done;
  const interrupted = await s.pool.query(
    'SELECT status FROM omniboard.collection_runs WHERE id = $1',
    [runId],
  );
  assert.equal(interrupted.rows[0].status, 'interrupted');
  assert.equal(await s.count('source_observations'), 50);

  assert.equal((await s.collect('coingecko_web')).status, 'success');
  assert.equal(await s.count('source_observations'), 100);
});

test('sources page: roles, background collection, daily schedule', async (t) => {
  const s = await setup();
  t.after(s.h.close);
  const call = (role: string, method: 'GET' | 'POST', url: string, body?: unknown) =>
    s.h.request(method, url, s.as(role), body);
  const state = async (role: string) =>
    (await call(role, 'GET', '/api/sources')).json() as SourcesState;
  assert.deepEqual(await state('reader'), { runs: [], mappings: [], daily: false, running: false });

  assert.equal(
    (await call('editor', 'POST', '/api/sources/collect', { source: 'cmc_web' })).statusCode,
    403,
  );
  assert.equal(
    (await call('admin', 'POST', '/api/sources/collect', { source: 'quant_pg' })).statusCode,
    422,
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  s.setFetcher(async (url) => {
    await gate;
    return fixtures(url);
  });
  const accepted = await call('admin', 'POST', '/api/sources/collect', { source: 'cmc_web' });
  assert.equal(accepted.statusCode, 202, accepted.body);
  assert.equal((await state('reader')).running, true);
  const second = await call('admin', 'POST', '/api/sources/collect', { source: 'coingecko_web' });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().message, 'A collection is already running.');
  release();
  await waitForCollections();
  s.setFetcher(fixtures);
  const afterRun = await state('admin');
  assert.equal(afterRun.running, false);
  assert.equal(afterRun.runs[0]!.status, 'success');
  assert.equal(afterRun.runs[0]!.rowCount, 50);
  assert.ok(afterRun.runs[0]!.evidenceId);
  assert.equal(afterRun.mappings.length, 50);
  assert.ok(afterRun.mappings.every((m) => m.source === 'cmc_web' && m.mappedBy === null));
  assert.deepEqual((await state('reader')).mappings, [], 'mappings are admin-only');
  assert.equal((await state('reader')).runs.length, 1);
  // 原文快照所有成员可读。
  assert.equal(
    (await call('reader', 'GET', `/api/evidence/${afterRun.runs[0]!.evidenceId}`)).statusCode,
    200,
  );

  // 每日采集:默认关闭;打开后每次只发起一个最久未运行的来源。
  const now = Date.now();
  assert.equal(await dailyCollection(s.pool, s.store, now, { fetcher: fixtures }), null);
  assert.equal(
    (await call('editor', 'POST', '/api/sources/schedule', { daily: true })).statusCode,
    403,
  );
  assert.deepEqual((await call('admin', 'POST', '/api/sources/schedule', { daily: true })).json(), {
    daily: true,
  });
  assert.equal((await state('reader')).daily, true);
  assert.equal(await dailyCollection(s.pool, s.store, now, { fetcher: fixtures }), 'coingecko_web');
  await waitForCollections();
  assert.equal(await dailyCollection(s.pool, s.store, now, { fetcher: fixtures }), null);
  assert.equal(
    await dailyCollection(s.pool, s.store, now + 86_400_000, { fetcher: fixtures }),
    'cmc_web',
  );
  assert.equal(
    await dailyCollection(s.pool, s.store, now + 86_400_000, { fetcher: fixtures }),
    null,
    'one collection at a time',
  );
  await waitForCollections();
  await call('admin', 'POST', '/api/sources/schedule', { daily: false });
  assert.equal(
    await dailyCollection(s.pool, s.store, now + 3 * 86_400_000, { fetcher: fixtures }),
    null,
  );
  assert.equal((await state('admin')).runs.length, 3);
});

test('source links import with canonical organizations and the one-link rule', async (t) => {
  const s = await setup();
  t.after(s.h.close);
  const bearer = (
    await s.h.request('POST', '/api/tokens', s.as('admin'), {
      name: 'importer',
      role: 'admin',
      expiresInDays: 7,
    })
  ).json().token as string;
  const post = (body: object, auth: { bearer?: string; cookie?: string } = { bearer }) =>
    s.h.request('POST', '/api/import/source-links', auth, body);
  const org = async (name: string, tags: string[]) =>
    (await s.h.request('POST', '/api/organizations', s.as('editor'), { name, tags })).json()
      .id as string;
  const ownerId = (await s.h.request('GET', '/api/session', s.as('admin'))).json().user.id;
  const legacy = await org('OKX old', ['exchange']);
  const okx = await org('OKX', ['exchange']);
  const company = await org('Plain company', ['company']);
  await s.pool.query(
    `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
     VALUES ($1,$2,'merged','{}')`,
    [legacy, okx],
  );
  const link = {
    id: 'v1-okx-cmc',
    source: 'cmc_web',
    slug: 'okx',
    organizationId: legacy,
    name: 'OKX',
    url: 'https://coinmarketcap.com/exchanges/okx/',
    mappedBy: ownerId,
  };
  assert.equal((await post(link, s.as('admin'))).statusCode, 403);
  assert.equal((await post({ ...link, slug: 'OKX!' })).statusCode, 422);
  assert.equal((await post({ ...link, organizationId: company })).statusCode, 422);
  assert.equal((await post({ ...link, organizationId: 'missing' })).statusCode, 422);
  assert.equal((await post({ ...link, mappedBy: 'missing' })).statusCode, 422);
  assert.equal((await post(link)).statusCode, 201);
  assert.equal((await post(link)).statusCode, 200);
  assert.equal((await post({ ...link, name: 'OKX renamed' })).statusCode, 409);
  assert.equal((await post({ ...link, id: 'other', slug: 'okx-2' })).statusCode, 409);
  const stored = await s.pool.query(
    `SELECT organization_id, mapped_by FROM omniboard.source_entity_links WHERE id = 'v1-okx-cmc'`,
  );
  assert.deepEqual(stored.rows[0], { organization_id: okx, mapped_by: ownerId });
  // 导入的人工映射在之后的采集里沿用:CMC 的 okx 不会再建一个机构。
  await s.collect('cmc_web');
  assert.equal(
    (await s.directory('&q=OKX')).organizations.filter((o) => o.name === 'OKX').length,
    1,
  );
  await s.pool.query("UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'");
  assert.equal((await post({ ...link, id: 'late', slug: 'late' })).statusCode, 403);
});
