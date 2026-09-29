import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bootstrapAdmin } from '../src/server/auth';
import { columnsFor } from '../src/shared/columns';
import type { DirectoryOrganization, MetricPoint } from '../src/shared/columns';
import { tagIds } from '../src/shared/tags';
import { harness, tokenOf } from './helpers';
// 机构、目录排名、指标观测与证据(frontend-spec 2.6、3、5.10、9.1–9.3)。v1 tests/rankings.test.ts 的断言逐条保留。

test('column composition follows the selected tag', () => {
  assert.deepEqual(
    columnsFor('').map((c) => c.id),
    ['record_count'],
  );
  assert.deepEqual(
    columnsFor('company').map((c) => c.id),
    ['revenue', 'headcount', 'record_count'],
  );
  assert.deepEqual(
    columnsFor('government').map((c) => c.id),
    ['gdp', 'population', 'record_count'],
  );
  assert.ok(!columnsFor('exchange').some((c) => c.id === 'gdp'));
  // Exchanges 视图的有效 tag 含 company:Revenue、Headcount 可选但默认隐藏。
  assert.ok(columnsFor('exchange').some((c) => c.id === 'revenue' && !c.defaultVisible));
  assert.ok(columnsFor('exchange').some((c) => c.id === 'headcount'));
  // v1 tests/business-roles.test.ts:业务 tag 至少 4 列,且没有交易所专属列。
  for (const tag of tagIds.filter((t) => !['exchange', 'company', 'government'].includes(t))) {
    assert.ok(columnsFor(tag).length >= 4, tag);
    assert.ok(!columnsFor(tag).some((c) => c.id === 'volume_24h'), tag);
  }
});

test('organizations, directory ranking, metric observations and evidence', async (t) => {
  const h = await harness();
  t.after(h.close);
  const { request } = h;
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const sessions: Record<string, string> = { admin: owner.cookie };
  for (const role of ['editor', 'reader']) {
    h.tick();
    const invited = await request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name: role, email: `${role}@example.test`, role },
    );
    sessions[role] = (await h.activate(tokenOf(invited.json().inviteLink))).cookie;
  }
  const as = (role: string) => ({ cookie: sessions[role]! });
  const get = (url: string, role = 'editor') => request('GET', url, as(role));
  const post = (url: string, body: unknown, role = 'editor') =>
    request('POST', url, as(role), body);
  async function org(name: string, tags: string[]) {
    const response = await post('/api/organizations', { name, tags });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const rows = async (url: string, role = 'editor') => {
    const response = await get(url, role);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().organizations as DirectoryOrganization[];
  };

  let exchangeCo = '';
  await t.test('create organization: tags, reader, exchange implies company, history', async () => {
    assert.equal(
      (await post('/api/organizations', { name: 'Nope', tags: ['company'] }, 'reader')).statusCode,
      403,
    );
    assert.equal((await post('/api/organizations', { name: 'No tags', tags: [] })).statusCode, 422);
    assert.equal(
      (await post('/api/organizations', { name: 'Bad tag', tags: ['bakery'] })).statusCode,
      422,
    );
    assert.equal(
      (await post('/api/organizations', { name: ' ', tags: ['company'] })).statusCode,
      422,
    );
    const created = await post('/api/organizations', {
      name: 'Exchange Co',
      description: 'An exchange.',
      tags: ['exchange', 'exchange'],
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().tags, ['company', 'exchange']);
    exchangeCo = created.json().id;
    const history = await h.db.pool.query(
      'SELECT action, payload FROM omniboard.edit_history WHERE subject_id = $1',
      [created.json().id],
    );
    assert.equal(history.rows[0].action, 'organization_created');
    assert.deepEqual(history.rows[0].payload.tags, ['exchange']);
    // 交易所只出现一次:在 Companies 和 All 视图里都是同一行。
    for (const tag of ['company', '']) {
      const list = await rows(`/api/organizations?tag=${tag}&q=Exchange%20Co`);
      assert.equal(list.length, 1);
    }
    const summary = await get('/api/summary', 'reader');
    assert.equal(summary.json().organizations, 1);
  });

  const top = await org('A Precision leader', ['company']);
  const tied = await org('B Equal value', ['company']);
  const lower = await org('C One decimal lower', ['company']);
  const zero = await org('D Zero revenue', ['company']);
  const missing = await org('E Missing revenue', ['company']);
  const government = await org('F Test jurisdiction', ['government']);
  const metric = {
    columnId: 'revenue',
    value: '9007199254740993.000000000000000002',
    unit: 'USD',
    period: '2025',
    sourceName: 'Synthetic annual report',
    sourceUrl: 'https://example.test/report',
    assumptions: 'Test fixture only. Consolidated annual revenue in USD.',
    rawText: '  Original fixture excerpt\nwith preserved whitespace.  ',
  };
  const path = '/api/organizations?tag=company&sort=revenue&year=2025&pageSize=100';

  await t.test('ranks decimals exactly: ties share a rank, missing values last', async () => {
    for (const [organizationId, value] of [
      [top, metric.value],
      [tied, metric.value],
      [lower, '9007199254740993.000000000000000001'],
      [zero, '0'],
    ] as const) {
      const response = await post(`/api/organizations/${organizationId}/metrics`, {
        ...metric,
        value,
      });
      assert.equal(response.statusCode, 201, response.body);
    }
    // 第一个子测试建的 Exchange Co 也是 company,没有收入,排在最后。
    let list = await rows(path);
    assert.deepEqual(
      list.map((o) => o.id),
      [top, tied, lower, zero, missing, exchangeCo],
    );
    assert.deepEqual(
      list.map((o) => o.rank),
      [1, 1, 3, 4, null, null],
    );
    assert.equal(list[0]!.values.revenue?.value, metric.value);
    list = await rows(`${path}&direction=asc`);
    assert.deepEqual(
      list.map((o) => o.id),
      [zero, lower, top, tied, missing, exchangeCo],
    );
    // 名次在搜索与翻页之前计算。
    list = await rows('/api/organizations?tag=company&sort=revenue&year=2025&pageSize=2&page=2');
    assert.deepEqual(
      list.map((o) => o.rank),
      [3, 4],
    );
    assert.equal((await rows(`${path}&q=decimal`))[0]!.rank, 3);
    assert.equal((await get(`${path}&rankedOnly=true`)).json().total, 4);
    assert.equal((await get(`${path.replace('2025', '2024')}&rankedOnly=true`)).json().total, 0);
  });

  await t.test('rejects columns and units outside the selected tag', async () => {
    assert.equal((await get(`${path}&unit=BTC`)).statusCode, 422);
    assert.equal((await get(path.replace('revenue', 'gdp'))).statusCode, 422);
    assert.equal((await get('/api/organizations?sort=revenue')).statusCode, 422);
    // sort=rank 等同默认列。
    assert.equal(
      (await get('/api/organizations?tag=company&sort=rank')).json().ranking.sort,
      'revenue',
    );
  });

  await t.test('metric input rules and evidence of the original text', async () => {
    const endpoint = `/api/organizations/${top}/metrics`;
    assert.equal((await post(endpoint, metric, 'reader')).statusCode, 403);
    assert.equal((await post(endpoint, { ...metric, rawText: ' ' })).statusCode, 422);
    assert.equal((await post(endpoint, { ...metric, period: 'current' })).statusCode, 422);
    assert.equal((await post(endpoint, { ...metric, unit: 'BTC' })).statusCode, 422);
    assert.equal((await post(endpoint, { ...metric, columnId: 'gdp' })).statusCode, 422);
    assert.equal((await post(endpoint, { ...metric, value: '1e30' })).statusCode, 422);
    assert.equal((await post(endpoint, { ...metric, sourceUrl: 'javascript:x' })).statusCode, 422);
    let points = (await get(endpoint, 'reader')).json().points as MetricPoint[];
    const original = points[0]!.evidenceId;
    assert.equal((await get(`/api/evidence/${original}`, 'reader')).json().text, metric.rawText);
    // 新观测取代旧值显示;旧原文仍可打开;库里两条都在。
    h.tick();
    assert.equal(
      (await post(endpoint, { ...metric, value: '8000', rawText: 'Second original excerpt' }))
        .statusCode,
      201,
    );
    points = (await get(endpoint)).json().points;
    assert.equal(points.length, 1);
    assert.equal(points[0]!.value, '8000');
    assert.notEqual(points[0]!.evidenceId, original);
    assert.equal((await get(`/api/evidence/${original}`)).json().text, metric.rawText);
    const stored = await h.db.pool.query(
      'SELECT count(*)::int AS n FROM omniboard.metric_observations WHERE organization_id = $1',
      [top],
    );
    assert.equal(stored.rows[0].n, 2);
    // 不同来源名各自保留最新一条。
    h.tick();
    assert.equal(
      (
        await post(endpoint, {
          ...metric,
          sourceName: 'Alternative annual estimate',
          value: '8500',
        })
      ).statusCode,
      201,
    );
    points = (await get(endpoint)).json().points;
    assert.equal(points.length, 2);
    assert.equal(points[0]!.value, '8500');
    assert.equal(
      (await post(endpoint, { ...metric, period: '2024', value: '100000' })).statusCode,
      201,
    );
    assert.equal((await rows(path)).find((o) => o.id === top)!.values.revenue!.value, '8500');
    assert.equal(
      (await rows(`${path.replace('2025', '2024')}&rankedOnly=true`))[0]!.values.revenue!.value,
      '100000',
    );
    const history = await h.db.pool.query(
      "SELECT payload FROM omniboard.edit_history WHERE action = 'metric_recorded' LIMIT 1",
    );
    assert.equal('rawText' in history.rows[0].payload, false);
    assert.ok(history.rows[0].payload.evidenceId);
  });

  await t.test('government columns are ranked within their own tag', async () => {
    assert.equal(
      (
        await post(`/api/organizations/${government}/metrics`, {
          ...metric,
          columnId: 'gdp',
          value: '200000',
        })
      ).statusCode,
      201,
    );
    const gov = (await get('/api/organizations?tag=government&sort=gdp&year=2025')).json();
    assert.deepEqual(
      gov.columns.map((c: { id: string }) => c.id),
      ['gdp', 'population', 'record_count'],
    );
    assert.equal(gov.organizations[0].rank, 1);
    assert.equal(gov.organizations[0].values.gdp.value, '200000');
    assert.equal('revenue' in gov.organizations[0].values, false);
  });

  await t.test('collected values: latest run, preferred source, currencies never mix', async () => {
    const pool = h.db.pool;
    const exchange = await org('Binance', ['exchange']);
    const other = await org('Kraken', ['exchange']);
    let n = 0;
    async function evidence() {
      const evidenceId = `ev-${++n}`;
      await pool.query(
        `INSERT INTO omniboard.evidence (id, source, url, sha256, byte_length, content_type, parser_version, filename, visibility)
         VALUES ($1,'cmc_web','https://example.test',$2,1,'text/html','fixture','page.html','team')`,
        [evidenceId, createHash('sha256').update(evidenceId).digest('hex')],
      );
      return evidenceId;
    }
    async function run(source: string, startedAt: string, observations: [string, object[]][]) {
      const runId = `run-${++n}`;
      const evidenceId = await evidence();
      await pool.query(
        `INSERT INTO omniboard.collection_runs (id, source, status, started_at, evidence_id)
         VALUES ($1,$2,'success',$3,$4)`,
        [runId, source, startedAt, evidenceId],
      );
      for (const [organizationId, metrics] of observations) {
        const linkId = `${source}:${organizationId}`;
        await pool.query(
          `INSERT INTO omniboard.source_entity_links (id, source, slug, organization_id, name, url)
           VALUES ($1,$2,$3,$4,'x','https://example.test/x') ON CONFLICT DO NOTHING`,
          [linkId, source, organizationId, organizationId],
        );
        await pool.query(
          `INSERT INTO omniboard.source_observations (id, link_id, evidence_id, run_id, rank, metrics)
           VALUES ($1,$2,$3,$4,1,$5)`,
          [`obs-${++n}`, linkId, evidenceId, runId, JSON.stringify(metrics)],
        );
      }
    }
    const m = (key: string, value: string | null, unit: string) => ({
      key,
      label: key,
      value,
      unit,
      rawText: value ?? 'n/a',
      precision: 0,
    });
    // 旧的一次采集不参与。
    await run('cmc_web', '2026-09-27T00:00:00Z', [
      [exchange, [m('volume_24h', '999999999', 'USD')]],
    ]);
    await run('cmc_web', '2026-09-28T00:00:00Z', [
      [exchange, [m('volume_24h', '5000000', 'USD'), m('liquidity', '700', 'score')]],
      [other, [m('volume_24h', '4000000', 'USD'), m('liquidity', null, 'score')]],
    ]);
    await run('coingecko_web', '2026-09-28T00:00:00Z', [
      [
        exchange,
        [
          m('volume_24h', '80', 'BTC'),
          m('volume_24h', '6000000', 'USD'),
          m('trust_score', '10', '/10'),
        ],
      ],
    ]);
    const usd = await rows(
      '/api/organizations?tag=exchange&sort=volume_24h&unit=USD&rankedOnly=true',
    );
    assert.deepEqual(
      usd.map((o) => [o.name, o.rank, o.values.volume_24h?.value, o.values.volume_24h?.source]),
      [
        ['Binance', 1, '5000000', 'cmc_web'],
        ['Kraken', 2, '4000000', 'cmc_web'],
      ],
    );
    const btc = await rows(
      '/api/organizations?tag=exchange&sort=volume_24h&unit=BTC&rankedOnly=true',
    );
    assert.deepEqual(
      btc.map((o) => [o.id, o.values.volume_24h?.source]),
      [[exchange, 'coingecko_web']],
    );
    const onlyGecko = await get(
      '/api/organizations?tag=exchange&sort=volume_24h&unit=USD&basis=coingecko_web&rankedOnly=true',
    );
    assert.deepEqual(
      onlyGecko.json().organizations.map((o: DirectoryOrganization) => o.values.volume_24h?.value),
      ['6000000'],
    );
    // 没有值(value=null)的采集指标不算观测。
    const liquidity = await rows('/api/organizations?tag=exchange&sort=liquidity');
    assert.deepEqual(
      liquidity.filter((o) => o.name !== 'Exchange Co').map((o) => [o.name, o.rank]),
      [
        ['Binance', 1],
        ['Kraken', null],
      ],
    );
    const trust = await rows('/api/organizations?tag=exchange&sort=trust_score&rankedOnly=true');
    assert.equal(trust[0]!.values.trust_score!.source, 'coingecko_web');
    const points = (await get(`/api/organizations/${exchange}/metrics?column=volume_24h`)).json()
      .points as MetricPoint[];
    assert.deepEqual(new Set(points.map((p) => p.unit)), new Set(['USD', 'BTC']));
    assert.ok(points.every((p) => p.evidenceId && p.sourceName && p.assumptions));
  });

  await t.test('record counts respect visibility; aliases leave the directory', async () => {
    const pool = h.db.pool;
    const evidence = (await get(`/api/organizations/${top}/metrics`)).json().points[0].evidenceId;
    const ownerId = (await get('/api/session', 'admin')).json().user.id;
    for (const [recordId, visibility] of [
      ['r1', 'team'],
      ['r2', 'admin'],
    ])
      await pool.query(
        `INSERT INTO omniboard.module_records (id, organization_id, tab_id, title, body, scope, status, visibility, evidence_id, revision, author_id)
         VALUES ($1,$2,'overview','t','b','s','unverified',$3,$4,1,$5)`,
        [recordId, missing, visibility, evidence, ownerId],
      );
    const count = async (role: string) =>
      (await rows('/api/organizations?tag=company&sort=record_count', role))[0]!;
    assert.deepEqual([(await count('admin')).id, (await count('admin')).recordCount], [missing, 2]);
    assert.equal((await count('reader')).recordCount, 1);
    await assert.rejects(
      pool.query("UPDATE omniboard.module_records SET visibility = 'team' WHERE id = 'r2'"),
      /Visibility cannot change/,
    );

    const before = (await get('/api/summary')).json().organizations;
    await pool.query(
      `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
       VALUES ($1,$2,'duplicate','{}')`,
      [tied, top],
    );
    assert.equal((await get('/api/summary')).json().organizations, before - 1);
    assert.ok(!(await rows(path)).some((o) => o.id === tied));
    assert.equal((await get(`/api/organizations/${tied}`)).json().organization.id, top);
  });

  await t.test('evidence upload, visibility and logos', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const sha = createHash('sha256').update(png).digest('hex');
    const upload = (body: object, role = 'editor') => post('/api/evidence', body, role);
    const file = {
      source: 'official_website',
      url: 'https://example.test/logo.png',
      contentType: 'image/png',
      filename: 'logo.png',
      sha256: sha,
      contentBase64: png.toString('base64'),
    };
    assert.equal((await upload({ ...file, sha256: '0'.repeat(64) })).statusCode, 422);
    assert.equal((await upload({ ...file, visibility: 'admin' })).statusCode, 403);
    assert.equal((await upload(file, 'reader')).statusCode, 403);
    const logo = await upload({ ...file, id: 'logo-1' });
    assert.equal(logo.statusCode, 201, logo.body);
    // 导入重放同 id 同内容是幂等的;内容不同则冲突。
    assert.equal((await upload({ ...file, id: 'logo-1' })).statusCode, 201);
    const text = Buffer.from('other');
    assert.equal(
      (
        await upload({
          ...file,
          id: 'logo-1',
          sha256: createHash('sha256').update(text).digest('hex'),
          contentBase64: text.toString('base64'),
        })
      ).statusCode,
      409,
    );
    const secret = await upload(
      { ...file, contentType: 'text/plain', visibility: 'admin', filename: 'note.txt' },
      'admin',
    );
    assert.equal((await get(`/api/evidence/${secret.json().id}`)).statusCode, 403);
    assert.equal((await get(`/api/evidence/${secret.json().id}`, 'admin')).statusCode, 200);
    const setLogo = (evidenceId: string) =>
      request('PUT', `/api/organizations/${top}/logo`, as('editor'), {
        logoEvidenceId: evidenceId,
        sourceUrl: 'https://example.test',
      });
    assert.equal((await setLogo(secret.json().id)).statusCode, 422);
    assert.equal((await setLogo('logo-1')).statusCode, 200);
    const listed = (await rows(path)).find((o) => o.id === top)!;
    assert.equal(listed.logoUrl, `/api/organizations/${top}/logo?v=logo-1`);
    const image = await get(listed.logoUrl, 'reader');
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.match(String(image.headers['content-security-policy']), /sandbox/);
    assert.deepEqual(image.rawPayload, png);
    const download = await get('/api/evidence/logo-1/download');
    assert.equal(download.headers['content-type'], 'application/octet-stream');
    assert.match(String(download.headers['content-disposition']), /attachment/);
    assert.equal((await get('/api/evidence/missing')).statusCode, 404);
  });

  await t.test(
    'system timestamps are imported only by admin tokens in the import window',
    async () => {
      const created = await request('POST', '/api/tokens', as('admin'), {
        name: 'importer',
        role: 'admin',
        expiresInDays: 7,
      });
      const bearer = created.json().token as string;
      const body = {
        id: 'v1-org',
        name: 'Imported',
        tags: ['bank'],
        createdAt: '2025-01-02T03:04:05Z',
      };
      assert.equal((await post('/api/organizations', body, 'admin')).statusCode, 403);
      const imported = await request('POST', '/api/organizations', { bearer }, body);
      assert.equal(imported.statusCode, 201, imported.body);
      assert.equal(imported.json().createdAt, '2025-01-02T03:04:05.000Z');
      assert.equal((await request('POST', '/api/organizations', { bearer }, body)).statusCode, 409);
      const list = await rows('/api/organizations?tag=bank&sort=updated');
      assert.equal(list[0]!.id, 'v1-org');
      await h.db.pool.query(
        "UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'",
      );
      assert.equal(
        (await request('POST', '/api/organizations', { bearer }, { ...body, id: 'v1-other' }))
          .statusCode,
        403,
      );
    },
  );
});
