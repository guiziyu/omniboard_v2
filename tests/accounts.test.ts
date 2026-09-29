import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { bootstrapAdmin } from '../src/server/auth';
import { defaultsFor } from '../src/shared/knowledge';
import {
  accountStatus,
  isIp,
  parseTags,
  settingsOf,
  tagsOf,
  tagsText,
  whitelistProblems,
  type Account,
  type AccountDetail,
  type AccountOptions,
  type AccountSettings,
} from '../src/shared/accounts';
import { harness, tokenOf } from './helpers';
// 交易账户(frontend-spec 12.7、data-model 5.1、proposal §4–§5):v2 新增,没有 v1 来源。

const settings = (extra: Partial<AccountSettings> = {}): AccountSettings => ({
  type: 'live',
  portfolioGroup: 'lp-test',
  initializing: false,
  unified: false,
  lowLatency: false,
  arbitrage: false,
  additionalLeverage: false,
  vipLevel: null,
  marketMakerLevel: null,
  clientName: '',
  ...extra,
});

test('account tags: quant serde form, status priority, preserved tags, IP rules', () => {
  // 生产里的写法(带空格)与 WalletBlocked 都能解析;表单改动时保留表单之外的标签。
  const prod = parseTags(
    '["Unified", {"PortfolioGroup": "lp-gavin-gate"}, {"WalletBlocked": {"Spot": null}}, {"MarketMakerLevel": 2}]',
  );
  const form = settingsOf(prod);
  assert.deepEqual(
    form,
    settings({ portfolioGroup: 'lp-gavin-gate', unified: true, marketMakerLevel: 2 }),
  );
  assert.equal(
    tagsText(tagsOf({ ...form, type: 'test', lowLatency: true }, prod)),
    '["Unified","Test","LowLatencyAccount",{"PortfolioGroup":"lp-gavin-gate"},{"WalletBlocked":{"Spot":null}},{"MarketMakerLevel":2}]',
  );
  assert.equal(
    tagsText(tagsOf(settings({ type: 'read-only', vipLevel: 3, clientName: 'Acme' }))),
    '["ReadOnly",{"PortfolioGroup":"lp-test"},{"VipLevel":3},{"Client":{"client_name":"Acme"}}]',
  );
  assert.equal(accountStatus(parseTags('["Test","Terminated","ReadOnly"]')), 'terminated');
  assert.equal(accountStatus(parseTags('["Initializing","Test"]')), 'test');
  assert.equal(accountStatus(parseTags('["Initializing"]')), 'initializing');
  assert.equal(accountStatus([]), 'live');
  for (const bad of [
    null,
    'nope',
    '{}',
    '["TradingSystem"]',
    '[{"TradingSystem":"Hft"}]',
    '[{"VipLevel":256}]',
    '[{"VipLevel":1.5}]',
    '[{"Client":{}}]',
    '[{"PortfolioGroup":"a","VipLevel":1}]',
  ])
    assert.throws(() => parseTags(bad), String(bad));
  for (const ip of ['52.1.2.3', '0.0.0.0', '2001:db8::1', '::ffff:10.0.0.1', '2001:DB8::A'])
    assert.ok(isIp(ip), ip);
  for (const ip of ['52.1.2', '052.1.2.3', '1.2.3.4/32', '256.1.1.1', 'fe80::1%eth0', 'host', ''])
    assert.ok(!isIp(ip), ip);
  assert.equal(whitelistProblems([], 'live').empty !== '', true);
  assert.equal(whitelistProblems([], 'test').empty, '');
  assert.deepEqual([...whitelistProblems(['1.2.3.4', 'x'], 'live').lines.keys()], [1]);
});

test('trading accounts: roles, create with onboarding link, edit, rotate, terminate', async (t) => {
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
  const members: Record<string, { cookie: string; secret: Buffer }> = {};
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
  const trader = members.trader!;
  const as = (who: { cookie: string }) => ({ cookie: who.cookie });
  const newAccount = (extra: Record<string, unknown> = {}) => ({
    exchange: 'Bitget',
    accountName: 'bitget-lp-01',
    settings: settings(),
    ipWhitelist: ['52.1.2.3', '52.1.2.3', '2001:db8::1'],
    owner: 'Gavin',
    apiKey: '  key-one ',
    apiSecret: 'secret-one',
    apiPass: 'pass-one',
    ...extra,
  });

  // 其他角色看不到这一页(404),写操作要 trader(403)。
  assert.equal((await request('GET', '/api/accounts', as(members.editor!))).statusCode, 404);
  const editorCreate = await request('POST', '/api/accounts', as(members.editor!), {
    ...newAccount(),
  });
  assert.equal(editorCreate.statusCode, 403);
  assert.equal(editorCreate.json().message, 'This action requires the trader role.');
  // 令牌不能做影响实盘的操作,即使是 admin 令牌。
  const token = (
    await request('POST', '/api/tokens', as(owner), { name: 'agent', role: 'admin' })
  ).json().token as string;
  assert.equal((await request('GET', '/api/accounts', { bearer: token })).statusCode, 200);
  const byToken = await request(
    'POST',
    '/api/accounts',
    { bearer: token },
    {
      ...newAccount(),
    },
  );
  assert.equal(byToken.statusCode, 403);
  assert.equal(byToken.json().message, 'This action requires an interactive session.');

  // 与前端相同的校验。
  const badIp = await request('POST', '/api/accounts', as(trader), {
    ...newAccount({ ipWhitelist: ['52.1.2.3', '52.1.2.0/24'] }),
  });
  assert.equal(badIp.statusCode, 422);
  assert.match(badIp.json().message, /line 2: Not a valid IP address/);
  const noIp = await request('POST', '/api/accounts', as(trader), {
    ...newAccount({ ipWhitelist: [] }),
  });
  assert.equal(noIp.statusCode, 422);
  const retired = await request('POST', '/api/accounts', as(trader), {
    ...newAccount({ exchange: 'CoinEx' }),
  });
  assert.equal(retired.statusCode, 422);

  // Onboarding 记录:venue 与交易所匹配、未 granted 的 api_credentials 才可选。
  const org = (
    await request('POST', '/api/organizations', as(owner), { name: 'Bitget', tags: ['exchange'] })
  ).json().id as string;
  const onboarding = (venueKey: string, resourceType = 'api_credentials') =>
    request('POST', `/api/organizations/${org}/tabs/onboarding/records`, as(owner), {
      title: `${venueKey} ${resourceType}`,
      body: 'Test account request',
      scope: 'Test',
      status: 'in_progress',
      visibility: 'team',
      rawText: 'Provider email',
      structured: {
        ...defaultsFor('onboarding'),
        owner: 'BD',
        reviewedOn: '2026-09-18',
        verification: 'Email',
        venueKey,
        resourceType,
        resourceStage: 'requested',
        product: 'Linear perpetual',
        capabilities: 'market, trading',
        blockers: 'API key pending',
      },
    });
  const linked = await onboarding('cex.bitget');
  assert.equal(linked.statusCode, 201, linked.body);
  const recordId = linked.json().id as string;
  await onboarding('cex.gate');
  await onboarding('cex.bitget', 'whitelist');
  const options = (
    await request('GET', '/api/accounts/options?exchange=Bitget', as(trader))
  ).json() as AccountOptions;
  assert.deepEqual(
    options.onboarding.map((o) => o.recordId),
    [recordId],
  );

  const created = await request('POST', '/api/accounts', as(trader), {
    ...newAccount(),
    onboardingRecordId: recordId,
  });
  assert.equal(created.statusCode, 200, created.body);
  const authId = created.json().authId as string;
  assert.equal(authId, 'Bitget_bitget-lp-01');
  const stored = (
    await admin.query('SELECT * FROM management.authentication WHERE auth_id = $1', [authId])
  ).rows[0];
  assert.equal(stored.account_tags, '[{"PortfolioGroup":"lp-test"}]');
  assert.deepEqual(stored.ip_whitelist, ['52.1.2.3', '2001:db8::1']);
  assert.deepEqual(
    [stored.api_key, stored.api_secret, stored.api_pass],
    ['key-one', 'secret-one', 'pass-one'],
  );
  const record = (
    await admin.query('SELECT revision, structured FROM omniboard.module_records WHERE id = $1', [
      recordId,
    ])
  ).rows[0];
  assert.equal(record.revision, 2);
  assert.equal(record.structured.resourceStage, 'granted');
  assert.equal(record.structured.accountRef, 'bitget-lp-01');
  const duplicate = await request('POST', '/api/accounts', as(trader), {
    ...newAccount(),
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().message, 'This account already exists.');

  const fp = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 12);
  const list = (await request('GET', '/api/accounts', as(trader))).json() as Account[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.keyFingerprint, fp('key-one'));
  assert.equal(list[0]!.status, 'live');
  assert.ok(list[0]!.lastChange);
  // 没有任何密钥出现在接口与审计里。
  const detailOf = async () =>
    (await request('GET', `/api/accounts/${authId}`, as(trader))).json() as AccountDetail;
  let detail = await detailOf();
  const everything = JSON.stringify([list, detail]);
  for (const secret of ['key-one', 'secret-one', 'pass-one'])
    assert.ok(!everything.includes(secret));
  assert.deepEqual(
    detail.onboarding.map((o) => o.recordId),
    [recordId],
  );
  assert.deepEqual(
    detail.audit.map((e) => e.action),
    ['auth.create'],
  );
  const event = (
    await admin.query(
      "SELECT step_up, notify_required, actor_id FROM omniboard.audit_event WHERE action = 'auth.create'",
    )
  ).rows[0];
  // 当场确认暂缓(frontend-spec 12.4 TODO):step_up 记为 false,仍标记需通知 owner。
  assert.deepEqual([event.step_up, event.notify_required], [false, true]);

  // 编辑:只写有变化的字段,每类变化一条审计;打开后被别人改过就拒绝。
  const base = {
    accountTags: stored.account_tags,
    ipWhitelist: stored.ip_whitelist,
    owner: 'Gavin',
  };
  const edited = await request('PATCH', `/api/accounts/${authId}`, as(trader), {
    base,
    settings: settings({ type: 'test', vipLevel: 2 }),
    ipWhitelist: ['52.1.2.3', '2001:db8::1'],
    owner: 'Lv',
  });
  assert.equal(edited.statusCode, 200, edited.body);
  detail = await detailOf();
  assert.equal(detail.status, 'test');
  assert.deepEqual(
    detail.audit.map((e) => e.action),
    ['auth.update_owner', 'auth.update_tags', 'auth.create'],
  );
  const stale = await request('PATCH', `/api/accounts/${authId}`, as(trader), {
    base,
    settings: settings(),
    ipWhitelist: ['52.1.2.3'],
    owner: 'Lv',
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().message, 'This account has changed. Reopen it and try again.');

  // 标签没变时保留原文(别人录入的 JSON 空白不被改写)。
  await admin.query(
    `UPDATE management.authentication SET account_tags = '["Test", {"PortfolioGroup": "lp-test"}, {"VipLevel": 2}]' WHERE auth_id = $1`,
    [authId],
  );
  const whitelistOnly = await request('PATCH', `/api/accounts/${authId}`, as(trader), {
    base: {
      accountTags: '["Test", {"PortfolioGroup": "lp-test"}, {"VipLevel": 2}]',
      ipWhitelist: ['52.1.2.3', '2001:db8::1'],
      owner: 'Lv',
    },
    settings: settings({ type: 'test', vipLevel: 2 }),
    ipWhitelist: [],
    owner: 'Lv',
  });
  assert.equal(whitelistOnly.statusCode, 200, whitelistOnly.body);
  const afterWhitelist = (
    await admin.query(
      'SELECT account_tags, ip_whitelist FROM management.authentication WHERE auth_id = $1',
      [authId],
    )
  ).rows[0];
  assert.equal(
    afterWhitelist.account_tags,
    '["Test", {"PortfolioGroup": "lp-test"}, {"VipLevel": 2}]',
  );
  assert.deepEqual(afterWhitelist.ip_whitelist, []);

  // DB 约束拒绝时带上约束名(这里临时加一条比界面更严的约束来触发)。
  await admin.query(
    "ALTER TABLE management.authentication ADD CONSTRAINT authentication_owner_probe_chk CHECK (owner IS DISTINCT FROM 'blocked')",
  );
  const rejected = await request('PATCH', `/api/accounts/${authId}`, as(trader), {
    base: { accountTags: afterWhitelist.account_tags, ipWhitelist: [], owner: 'Lv' },
    settings: settings({ type: 'test', vipLevel: 2 }),
    ipWhitelist: [],
    owner: 'blocked',
  });
  assert.equal(rejected.statusCode, 422);
  assert.equal(
    rejected.json().message,
    'The database rejected this change: authentication_owner_probe_chk',
  );

  // 轮换:三列一起写,指纹更新,审计只记指纹。
  const rotated = await request('POST', `/api/accounts/${authId}/rotate`, as(trader), {
    apiKey: 'key-two',
    apiSecret: 'secret-two',
    apiPass: '',
  });
  assert.equal(rotated.statusCode, 200, rotated.body);
  const keys = (
    await admin.query(
      'SELECT api_key, api_secret, api_pass FROM management.authentication WHERE auth_id = $1',
      [authId],
    )
  ).rows[0];
  assert.deepEqual(keys, { api_key: 'key-two', api_secret: 'secret-two', api_pass: '' });
  detail = await detailOf();
  assert.equal(detail.keyFingerprint, fp('key-two'));
  assert.deepEqual(detail.audit[0]!.before, { apiKeyFingerprint: fp('key-one') });
  const audits = await admin.query('SELECT before, after FROM omniboard.audit_event');
  for (const secret of ['key-one', 'secret-one', 'pass-one', 'key-two', 'secret-two'])
    assert.ok(!JSON.stringify(audits.rows).includes(secret), secret);

  // 停用:必须输入账户名;之后只能查看。
  const mistyped = await request('POST', `/api/accounts/${authId}/terminate`, as(trader), {
    accountName: 'bitget-lp',
  });
  assert.equal(mistyped.statusCode, 422);
  const terminated = await request('POST', `/api/accounts/${authId}/terminate`, as(trader), {
    accountName: 'bitget-lp-01',
  });
  assert.equal(terminated.statusCode, 200, terminated.body);
  detail = await detailOf();
  assert.equal(detail.status, 'terminated');
  assert.equal(
    (await admin.query('SELECT account_tags FROM management.authentication')).rows[0].account_tags,
    '["Terminated","Test",{"PortfolioGroup":"lp-test"},{"VipLevel":2}]',
  );
  const afterTerminate = await request('POST', `/api/accounts/${authId}/rotate`, as(trader), {
    apiKey: 'k',
    apiSecret: 's',
    apiPass: '',
  });
  assert.equal(afterTerminate.statusCode, 409);

  const second = await request(
    'POST',
    '/api/accounts',
    as(trader),
    newAccount({ accountName: 'bitget-lp-02' }),
  );
  assert.equal(second.statusCode, 200, second.body);

  // 已知出口 IP:admin 维护,trader 读取。
  assert.equal(
    (await request('PUT', '/api/accounts/egress-ips', as(trader), { egressIps: [] })).statusCode,
    403,
  );
  const saved = await request('PUT', '/api/accounts/egress-ips', as(owner), {
    egressIps: [{ ip: '52.1.2.3', label: 'Neo EIP' }],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(
    (
      await request('PUT', '/api/accounts/egress-ips', as(owner), {
        egressIps: [{ ip: 'x', label: '' }],
      })
    ).statusCode,
    422,
  );
  const withIps = (
    await request('GET', '/api/accounts/options', as(trader))
  ).json() as AccountOptions;
  assert.deepEqual(withIps.egressIps, [{ ip: '52.1.2.3', label: 'Neo EIP' }]);
  assert.deepEqual(withIps.portfolioGroups, ['lp-test']);
});
