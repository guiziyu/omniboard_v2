import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapAdmin } from '../src/server/auth';
import {
  hftChanges,
  parseDecimal,
  predictionGroupProblem,
  settingsProblem,
  type HftChannel,
  type HftChannelDetail,
  type HftSettings,
} from '../src/shared/hft';
import { harness, tokenOf } from './helpers';
// HFT 配置(frontend-spec 12.8、data-model 5.2、proposal §5):v2 新增,没有 v1 来源。

const settings = (extra: Partial<HftSettings> = {}): HftSettings => ({
  portfolioGroup: 'lp-gavin-cross',
  maxActiveGroups: 30,
  maxPortfolioGrossExposureUsd: 500,
  maxPortfolioAbsNetExposureUsd: 200,
  maxWalletGrossToAssetsRatio: 0.8,
  groupLimits: [],
  ...extra,
});
const btc = {
  predictionGroup: 'BaseAsset_BTC',
  maxGrossExposureUsd: 3000,
  maxAbsNetExposureUsd: 200,
};

test('HFT config rules match quant validation and PredictionGroup parsing', () => {
  assert.equal(settingsProblem(settings({ groupLimits: [btc] })), null);
  const bad: [Partial<HftSettings>, RegExp][] = [
    [{ portfolioGroup: ' lp' }, /^Portfolio group: Remove the spaces/],
    [{ portfolioGroup: '' }, /^Portfolio group: Required/],
    [{ maxActiveGroups: 0 }, /^Max active groups/],
    [{ maxActiveGroups: 1.5 }, /^Max active groups/],
    [{ maxActiveGroups: 2 ** 31 }, /^Max active groups/],
    [{ maxPortfolioGrossExposureUsd: Infinity }, /^Max gross exposure per group/],
    [{ maxPortfolioAbsNetExposureUsd: 501 }, /not above the gross limit/],
    [{ maxWalletGrossToAssetsRatio: 1 }, /between 0 and 1/],
    [{ maxWalletGrossToAssetsRatio: 0 }, /between 0 and 1/],
    [{ groupLimits: [btc, btc] }, /listed twice/],
    [{ groupLimits: [{ ...btc, maxAbsNetExposureUsd: 3001 }] }, /not above the gross limit/],
    [{ groupLimits: [{ ...btc, predictionGroup: 'BTC' }] }, /BaseAsset_<asset> or Beta_<name>/],
  ];
  for (const [extra, message] of bad)
    assert.match(settingsProblem(settings(extra)) ?? '', message, JSON.stringify(extra));
  assert.equal(predictionGroupProblem('Beta_BTC_ETH_basket'), null);
  assert.ok(predictionGroupProblem('BaseAsset_'));
  assert.ok(predictionGroupProblem('Bogus_X'));
  // 完整精度;空、Infinity、十六进制都不是数。
  assert.equal(parseDecimal(' 0.1234567890123 '), 0.1234567890123);
  assert.equal(parseDecimal('1e3'), 1000);
  for (const text of ['', 'Infinity', '0x10', '1,000', '1e999'])
    assert.equal(parseDecimal(text), null);
  assert.deepEqual(
    hftChanges(settings({ groupLimits: [btc] }), settings({ maxActiveGroups: 20 })),
    [
      { field: 'Max active groups', before: '30', after: '20' },
      { field: 'Group BaseAsset_BTC', before: 'gross 3000 · |net| 200', after: '—' },
    ],
  );
});

test('HFT config: roles, create, review semantics, stale saves, audit', async (t) => {
  const h = await harness();
  const admin = new pg.Client({ connectionString: h.db.adminUrl });
  await admin.connect();
  t.after(async () => {
    await admin.end();
    await h.close();
  });
  const { request } = h;
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const members: Record<string, { cookie: string }> = {};
  for (const role of ['trader', 'editor']) {
    h.tick();
    const invited = await request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name: `Tia ${role}`, email: `${role}@example.test`, role },
    );
    members[role] = await h.activate(tokenOf(invited.json().inviteLink));
  }
  const trader = { cookie: members.trader!.cookie };
  const editor = { cookie: members.editor!.cookie };

  // quant 的 sync_hft_config 写入的行:update_at 带微秒。
  await admin.query(
    `INSERT INTO management.hft_config VALUES
       ('prod', 'lp-gavin-cross', 30, 500, 200, 0.8, '2026-09-27 15:44:48.168123+00')`,
  );
  await admin.query(
    `INSERT INTO management.hft_group_limit VALUES
       ('prod', 'BaseAsset_BTC', 3000, 200, '2026-09-27 15:44:48.168123+00')`,
  );

  // 其他角色看不到这一页(404);写操作要 trader 的登录会话,令牌不行。
  assert.equal((await request('GET', '/api/hft', editor)).statusCode, 404);
  assert.equal((await request('GET', '/api/hft/prod', editor)).statusCode, 404);
  const editorSave = await request('POST', '/api/hft', editor, {
    channel: 'x',
    settings: settings(),
  });
  assert.equal(editorSave.statusCode, 403);
  const token = (
    await request('POST', '/api/tokens', { cookie: owner.cookie }, { name: 'agent', role: 'admin' })
  ).json().token as string;
  assert.equal((await request('GET', '/api/hft', { bearer: token })).statusCode, 200);
  const byToken = await request(
    'POST',
    '/api/hft',
    { bearer: token },
    {
      channel: 'x',
      settings: settings(),
    },
  );
  assert.equal(byToken.statusCode, 403);
  assert.equal(byToken.json().message, 'This action requires an interactive session.');

  const list = (await request('GET', '/api/hft', trader)).json() as HftChannel[];
  assert.deepEqual(list, [
    {
      channel: 'prod',
      ...settings({ groupLimits: [btc] }),
      updateAt: '2026-09-27T15:44:48.168123Z',
    },
  ]);

  // 新建:与前端相同的校验;重名 409。
  const invalid = [
    { channel: ' dev', settings: settings() },
    { channel: 'dev', settings: settings({ maxWalletGrossToAssetsRatio: 1 }) },
    { channel: 'dev', settings: settings({ groupLimits: [{ ...btc, predictionGroup: 'BTC' }] }) },
  ];
  for (const body of invalid)
    assert.equal(
      (await request('POST', '/api/hft', trader, body)).statusCode,
      422,
      JSON.stringify(body),
    );
  const created = await request('POST', '/api/hft', trader, {
    channel: 'dev',
    settings: settings({
      maxPortfolioAbsNetExposureUsd: 0.1234567890123,
      groupLimits: [{ ...btc, predictionGroup: 'Beta_x' }, btc],
    }),
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(
    (await request('POST', '/api/hft', trader, { channel: 'dev', settings: settings() })).json()
      .message,
    'This channel already exists.',
  );
  const dev = (await request('GET', '/api/hft/dev', trader)).json() as HftChannelDetail;
  assert.equal(dev.maxPortfolioAbsNetExposureUsd, 0.1234567890123);
  assert.deepEqual(
    dev.groupLimits.map((l) => l.predictionGroup),
    ['BaseAsset_BTC', 'Beta_x'],
  );
  assert.deepEqual(dev.knownGroups, ['BaseAsset_BTC', 'Beta_x']);
  assert.equal(dev.audit[0]!.action, 'hft_config.create');

  // 保存:微秒精度的 update_at 作为 base;没有改动不写(update_at 不动,不记审计)。
  const prod = (await request('GET', '/api/hft/prod', trader)).json() as HftChannelDetail;
  const same = await request('PUT', '/api/hft/prod', trader, {
    base: prod.updateAt,
    settings: settings({ groupLimits: [btc] }),
  });
  assert.deepEqual(same.json(), { changed: false });
  const saved = await request('PUT', '/api/hft/prod', trader, {
    base: prod.updateAt,
    settings: settings({ maxActiveGroups: 20, groupLimits: [] }),
  });
  assert.deepEqual(saved.json(), { changed: true });
  const after = (await request('GET', '/api/hft/prod', trader)).json() as HftChannelDetail;
  assert.equal(after.maxActiveGroups, 20);
  assert.deepEqual(after.groupLimits, []);
  assert.notEqual(after.updateAt, prod.updateAt);
  // 用旧的 update_at 再保存:别人改过,拒绝覆盖。
  const stale = await request('PUT', '/api/hft/prod', trader, {
    base: prod.updateAt,
    settings: settings(),
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(
    stale.json().message,
    'This channel changed since you opened it. Reload to see the latest values.',
  );
  assert.equal(
    (await request('PUT', '/api/hft/nope', trader, { base: '', settings: settings() })).statusCode,
    404,
  );

  const events = await admin.query(
    `SELECT action, target_key, before, after, step_up, notify_required, via
       FROM omniboard.audit_event WHERE target_table = 'management.hft_config' ORDER BY id`,
  );
  assert.deepEqual(
    events.rows.map((e) => [e.action, e.target_key, e.step_up, e.notify_required, e.via]),
    [
      ['hft_config.create', 'dev', false, true, 'session'],
      ['hft_config.update', 'prod', false, true, 'session'],
    ],
  );
  assert.deepEqual(events.rows[1].before, settings({ groupLimits: [btc] }));
  assert.deepEqual(events.rows[1].after, settings({ maxActiveGroups: 20 }));

  // 组覆盖整批替换(与 sync_hft_config --apply 相同)。
  const limits = await admin.query(
    "SELECT count(*)::int AS n FROM management.hft_group_limit WHERE channel = 'prod'",
  );
  assert.equal(limits.rows[0].n, 0);
});
