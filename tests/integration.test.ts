import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapAdmin } from '../src/server/auth';
import { defaultsFor, validateKnowledge } from '../src/shared/knowledge';
import { requestFileSchema } from '../src/shared/verification-contract';
import { deriveRequestState } from '../src/server/connector-requests';
import {
  businessProgress,
  recordNeedsAttention,
  technicalProgress,
  trackOwner,
} from '../src/shared/work-progress';
import type { WorkFeed } from '../src/shared/operations';
import type {
  AttemptRow,
  OrganizationWork,
  RequestView,
  VenueBoard,
} from '../src/shared/integration';
import type { ModuleRecord } from '../src/shared/types';
import { harness, tokenOf } from './helpers';
import { fixtureVenues, quantFixture, runId } from './connector-fixture';
// 接入请求、Connector 看板与工作摘要(frontend-spec 4.8、10.4 第 11 项、11)。从 v1
// tests/integration-requests.test.ts 与 tests/work-summary.test.ts 迁移。v1 的导出目录、投影与拒收规则由
// proposal §6 取代:断言改为读 omniboard.v_connector_request 与 verification.v_*;资源获批后的重发
// 生成新的 request_id(旧快照不可变,data-model §3.6);v1 在投影时改写 validation 任务的下一步,
// v2 不再投影,改为详情面板直接列出可用的 run(断言相应去掉)。

const common = { owner: 'Test BD', reviewedOn: '2026-09-18', verification: 'Synthetic evidence.' };
const fields = (tab: string, extra: Record<string, string> = {}) => ({
  ...defaultsFor(tab),
  ...common,
  ...extra,
});
const base = {
  title: 'Synthetic record',
  body: 'Synthetic notes',
  scope: 'Test',
  status: 'unverified',
  visibility: 'team',
  rawText: 'Original synthetic evidence',
  sourceUrl: 'https://example.test/source',
};

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const h = await harness();
  const quant = await quantFixture(h.db.adminUrl);
  t.after(async () => {
    await quant.close();
    await h.close();
  });
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
  const call = (role: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) =>
    h.request(method, '/api' + url, { cookie: sessions[role]! }, body);
  const org = (
    await call('admin', 'POST', '/organizations', { name: 'Synthetic venue', tags: ['exchange'] })
  ).json().id as string;
  const requests = async (role = 'reader') =>
    (await call(role, 'GET', `/organizations/${org}/integrations`)).json()
      .requests as RequestView[];
  const feed = async (role = 'reader') =>
    (await call(role, 'GET', `/work?organizationId=${org}`)).json<WorkFeed>();
  return { h, quant, call, sessions, org, requests, feed };
}

test('constraint fields validate per kind, and structured constraints require a source id', () => {
  const api = (extra: Record<string, string>) =>
    validateKnowledge(
      'api_optimization',
      fields('api_optimization', { product: 'Spot', prerequisites: 'x', ...extra }),
    );
  assert.equal(api({}).constraintKind, 'none');
  assert.equal(api({ sourceId: 'SRC-bitget-ip-whitelist' }).sourceId, 'SRC-bitget-ip-whitelist');
  for (const bad of ['src-bitget', 'SRC-Bitget-x', 'SRC--x', 'REF-bitget-x'])
    assert.throws(() => api({ sourceId: bad }), /Source ID/, bad);
  const valid: [string, string][] = [
    [
      'whitelist',
      '{"required":true,"max_ips":4,"applies_to":["rest","ws_private"],"registration":"portal"}',
    ],
    ['rate_limit', '{"unit":"requests","limit":1200,"window_ms":60000,"scope":"ip","tier":"vip3"}'],
    ['protocol', '{"transport":"sbe","endpoint":"https://example.test/sbe","auth":"ed25519"}'],
    [
      'endpoint',
      '{"kind":"ws","url":"wss://example.test/stream","private":true,"purpose":"market"}',
    ],
    ['account_model', '{"model":"unified","products":["spot","linear_perpetual"]}'],
    ['network_route', '{"route":"colocation","region":"ap-northeast-1","zone_id":"apne1-az4"}'],
    [
      'entitlement',
      '{"feature_keys":["trading.unified.*"],"status":"requested","expires_on":"2026-12-31"}',
    ],
  ];
  for (const [kind, value] of valid)
    assert.equal(
      api({
        sourceId: 'SRC-bitget-' + kind.replaceAll('_', '-'),
        constraintKind: kind,
        constraintValue: value,
      }).constraintKind,
      kind,
    );
  const invalid: [string, string, RegExp][] = [
    ['whitelist', '{"required":"yes"}', /required/],
    ['rate_limit', '{"unit":"requests","limit":-1,"window_ms":60000,"scope":"ip"}', /limit/],
    ['protocol', '{"transport":"carrier_pigeon"}', /transport/],
    ['endpoint', '{"kind":"rest","url":"not a url","private":false}', /url/],
    ['account_model', '{"model":"unified","extra":"free text"}', /extra/],
    ['network_route', '{"route":"colocation","notes":"free text"}', /notes/],
    ['entitlement', '{"status":"granted","expires_on":"tomorrow"}', /expires_on/],
    ['whitelist', 'not json', /JSON object/],
  ];
  for (const [kind, value, pattern] of invalid)
    assert.throws(
      () => api({ sourceId: 'SRC-bitget-x', constraintKind: kind, constraintValue: value }),
      pattern,
      kind,
    );
  assert.throws(
    () => api({ constraintKind: 'whitelist', constraintValue: '{"required":true}' }),
    /Source ID/,
  );
  assert.throws(
    () => api({ sourceId: 'SRC-bitget-x', constraintValue: '{"required":true}' }),
    /clear the constraint/,
  );
  assert.throws(
    () => api({ sourceId: 'SRC-bitget-x', affectsFeatureKeys: 'Trading.*' }),
    /Affected feature keys/,
  );
  assert.throws(
    () =>
      api({
        sourceId: 'SRC-bitget-x',
        constraintKind: 'whitelist',
        constraintValue: '{"required":true}',
        sensitivity: 'NDA',
        evidenceLevel: 'CONTRACTED',
      }),
    /NDA/,
  );
  assert.equal(
    validateKnowledge(
      'tech_stack',
      fields('tech_stack', {
        constraints: 'x',
        sourceId: 'SRC-bitget-colo',
        constraintKind: 'network_route',
        constraintValue: '{"route":"colocation"}',
      }),
    ).constraintKind,
    'network_route',
  );
});

test('request state derives from attempts per contract section 2', () => {
  const attempt = (over: Partial<AttemptRow>): AttemptRow => ({
    runId: 'r',
    requestId: 'q',
    venueKey: 'bitget',
    suite: 'place-order',
    environment: 'dev-cred',
    accountName: 'a',
    accountKind: 'test',
    buildRevision: 'b',
    buildDirty: false,
    startedAt: '2026-09-19T10:00:00Z',
    finishedAt: '2026-09-19T11:00:00Z',
    status: 'passed',
    blockers: [],
    passedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    ...over,
  });
  assert.equal(deriveRequestState([]), 'queued');
  assert.equal(deriveRequestState([attempt({ buildDirty: true })]), 'queued');
  assert.equal(deriveRequestState([attempt({ finishedAt: null })]), 'running');
  assert.equal(deriveRequestState([attempt({})]), 'passed');
  assert.equal(deriveRequestState([attempt({ status: 'aborted' })]), 'failed');
  assert.equal(deriveRequestState([attempt({ failedCount: 1 })]), 'failed');
  assert.equal(
    deriveRequestState([
      attempt({ status: 'failed', startedAt: '2026-09-18T10:00:00Z', runId: 'old' }),
      attempt({ startedAt: '2026-09-19T10:00:00Z', runId: 'new' }),
    ]),
    'passed',
    'latest run per suite wins',
  );
  assert.equal(
    deriveRequestState([
      attempt({}),
      attempt({ suite: 'wallet-api', status: 'failed', runId: 'w' }),
    ]),
    'failed',
  );
});

test('business approvals, expiry and technical evidence remain independent', () => {
  const fixture = (structured: Record<string, string>) =>
    ({ id: 'fixture', structured }) as ModuleRecord;
  const codeOnly = fixture({
    integrationStage: 'implemented',
    resourceStage: 'unknown',
    owner: 'Importer',
  });
  assert.equal(businessProgress(codeOnly, '2026-09-19T00:00:00Z').value, 'unknown');
  assert.equal(technicalProgress(codeOnly).value, 'implemented');
  assert.equal(trackOwner(codeOnly, 'business'), '');
  assert.equal(trackOwner(codeOnly, 'technical'), '');
  const expired = fixture({
    resourceStage: 'granted',
    expiresOn: '2026-09-18',
    integrationStage: 'production_verified',
  });
  assert.equal(businessProgress(expired, '2026-09-19T00:00:00Z').value, 'expiry_review');
  assert.equal(technicalProgress(expired).value, 'production_verified');
  assert.ok(recordNeedsAttention(expired, [], '2026-09-19T00:00:00Z'));
  assert.equal(businessProgress(expired, '2026-09-18T20:00:00Z').value, 'granted');
  assert.equal(
    businessProgress(fixture({ resourceStage: 'rejected' }), '2026-09-19').value,
    'rejected',
  );
  assert.equal(technicalProgress(fixture({ integrationStage: 'not-a-stage' })).value, 'unknown');
  const pending = fixture({ resourceStage: 'requested' });
  assert.equal(
    recordNeedsAttention(pending, [{ recordId: 'fixture', state: 'queued', blockers: ['x'] }], ''),
    true,
    'a current request with blockers needs attention',
  );
});

test('legacy onboarding remains editable and separate owners and next steps are validated', () => {
  const values: Record<string, string> = {
    ...defaultsFor('onboarding'),
    venueKey: 'cex.fixture',
    capabilities: 'market',
    product: 'Synthetic spot scope',
    blockers: 'Fixture check',
    owner: 'Record owner',
    reviewedOn: '2026-09-19',
    verification: 'Fixture verification',
  };
  delete values.businessOwner;
  delete values.technicalOwner;
  delete values.nextStep;
  assert.equal(validateKnowledge('onboarding', values).businessOwner, '');
  const updated = validateKnowledge('onboarding', {
    ...values,
    businessOwner: 'Business fixture',
    technicalOwner: 'Engineering fixture',
    nextStep: 'Confirm the synthetic account scope.',
  });
  const fixture = { id: 'fixture', structured: updated } as ModuleRecord;
  assert.equal(trackOwner(fixture, 'business'), 'Business fixture');
  assert.equal(trackOwner(fixture, 'technical'), 'Engineering fixture');
  assert.throws(() => validateKnowledge('onboarding', { ...values, nextStep: 'x'.repeat(4001) }));
});

test('onboarding saves create immutable requests with expanded leaves, constraints and awaiting resources; granted resources reissue and unlock', async (t) => {
  const { h, quant, call, org, requests, feed } = await setup(t);
  for (const venue of fixtureVenues) await quant.declare(venue);
  const apiPath = `/organizations/${org}/tabs/api_optimization/records`;
  const vip = await call('editor', 'POST', apiPath, {
    ...base,
    title: 'Burst limits need VIP 3',
    structured: fields('api_optimization', {
      product: 'Linear perpetual',
      prerequisites: 'VIP 3',
      sourceId: 'SRC-bitget-vip-burst',
      constraintKind: 'entitlement',
      constraintValue: '{"feature_keys":["trading.unified.*"],"status":"requested"}',
      affectsFeatureKeys: 'trading.unified.linear_perpetual.advanced.request_limit.*',
      evidenceLevel: 'OFFICIAL',
    }),
  });
  assert.equal(vip.statusCode, 201, vip.body);
  const duplicate = await call('editor', 'POST', apiPath, {
    ...base,
    structured: fields('api_optimization', {
      product: 'Spot',
      prerequisites: 'x',
      sourceId: 'SRC-bitget-vip-burst',
    }),
  });
  assert.equal(duplicate.statusCode, 409, 'source ids are unique within the organization');
  const nda = await call('admin', 'POST', apiPath, {
    ...base,
    visibility: 'admin',
    structured: fields('api_optimization', {
      product: 'Spot',
      prerequisites: 'x',
      sourceId: 'SRC-bitget-nda-limits',
      constraintKind: 'rate_limit',
      constraintValue: '{"unit":"orders","limit":50,"window_ms":1000,"scope":"account"}',
      constraintExportable: 'no',
      sensitivity: 'NDA',
      evidenceLevel: 'CONTRACTED',
    }),
  });
  assert.equal(nda.statusCode, 201, nda.body);
  const onboardingPath = `/organizations/${org}/tabs/onboarding/records`;
  const onboarding = {
    ...base,
    structured: fields('onboarding', {
      venueKey: 'cex.bitget',
      resourceType: 'api_credentials',
      capabilities: 'market, trading',
      product: 'Linear perpetual test account',
      nextAction: 'validate_readonly',
      accountRef: 'bitget-test-01',
      blockers: 'Account pending',
      businessOwner: 'BD fixture',
    }),
  };
  const created = await call('editor', 'POST', onboardingPath, onboarding);
  assert.equal(created.statusCode, 201, created.body);
  const recordId = created.json().id as string;
  let current = await requests();
  assert.equal(current.length, 1);
  const first = current[0]!;
  assert.equal(first.state, 'queued');
  // quant 经视图按 request_id 读到的就是这份快照(proposal §6)。
  const view = await h.ctx.pool.query(
    'SELECT request FROM omniboard.v_connector_request WHERE request_id = $1',
    [first.id],
  );
  const file = view.rows[0].request;
  assert.deepEqual(requestFileSchema.parse(file), file);
  assert.deepEqual(file, first.request);
  assert.equal(file.request_id, first.id);
  assert.equal(file.venue_key, 'bitget');
  assert.equal(file.crate_path, 'connector/crates/conn-bitget');
  assert.equal(file.environment, 'dev-cred');
  assert.deepEqual(file.account, { name: 'bitget-test-01', kind: 'test' });
  assert.deepEqual(
    first.request.requested.map((l) => l.feature_key),
    [
      'market.linear_perpetual.order_book.ws',
      'market.spot.trade.ws',
      'trading.unified.linear_perpetual.advanced.place_order.gtc',
      'trading.unified.linear_perpetual.advanced.request_limit.burst',
    ],
    'face wildcards expand to the declared leaves',
  );
  const leaf = (key: string) => first.request.requested.find((l) => l.feature_key.endsWith(key))!;
  assert.deepEqual(leaf('order_book.ws').prerequisites, []);
  assert.deepEqual(leaf('place_order.gtc').prerequisites, ['api_credentials']);
  assert.deepEqual(leaf('place_order.gtc').awaiting, ['api_credentials']);
  assert.deepEqual(leaf('request_limit.burst').prerequisites, ['api_credentials', 'vip_tier']);
  assert.deepEqual(leaf('request_limit.burst').awaiting, ['api_credentials', 'vip_tier']);
  assert.equal(first.request.constraints.length, 2);
  const exported = first.request.constraints.find((c) => c.id === 'SRC-bitget-vip-burst')!;
  assert.ok('value' in exported && exported.exportable === true);
  assert.deepEqual('affects' in exported ? exported.affects.feature_keys : [], [
    'trading.unified.linear_perpetual.advanced.request_limit.*',
  ]);
  assert.equal('enforcement' in exported ? exported.enforcement : '', 'operational');
  const redacted = first.request.constraints.find((c) => c.id === 'SRC-bitget-nda-limits')!;
  assert.deepEqual(Object.keys(redacted).sort(), ['id', 'kind', 'origin']);
  assert.ok(!JSON.stringify(file).includes('orders'), 'NDA values never leave the workspace');
  assert.ok(first.blockers.includes('The resource has not been granted.'));
  assert.equal(
    first.leaves.find((l) => l.featureKey.endsWith('request_limit.burst'))!.awaiting[1]!.resource,
    'vip_tier',
  );
  const summary = (
    await call('reader', 'GET', `/organizations/${org}/work-summary`)
  ).json<OrganizationWork>();
  assert.deepEqual(summary.requests[0]!.awaiting, ['api_credentials', 'vip_tier']);
  // 快照不可变(data-model §6):应用角色没有 UPDATE 权限,owner 改也被触发器拒绝。
  await assert.rejects(
    h.ctx.pool.query(
      "UPDATE omniboard.connector_request SET action = 'prepare_config' WHERE request_id = $1",
      [first.id],
    ),
    /permission denied/,
  );
  const admin = new pg.Client({ connectionString: h.db.adminUrl });
  await admin.connect();
  try {
    await assert.rejects(
      admin.query("UPDATE omniboard.connector_request SET request = '{}' WHERE request_id = $1", [
        first.id,
      ]),
      /cannot be changed/,
    );
    await assert.rejects(
      admin.query('DELETE FROM omniboard.connector_request WHERE request_id = $1', [first.id]),
      /cannot be changed/,
    );
  } finally {
    await admin.end();
  }

  // 获批(新版本)产生当前请求;旧版本的请求不再显示,也不再算作阻塞项。
  const granted = await call('editor', 'PATCH', `${onboardingPath}/${recordId}`, {
    ...onboarding,
    revision: 1,
    structured: {
      ...onboarding.structured,
      resourceStage: 'granted',
      resourceRef: 'approval-1',
      credentialRef: 'secret://bitget/test-01',
      evidenceLevel: 'CONTRACTED',
    },
  });
  assert.equal(granted.statusCode, 200, granted.body);
  current = await requests();
  assert.equal(current.length, 1);
  const second = current[0]!;
  assert.notEqual(second.id, first.id);
  assert.equal(second.recordRevision, 2);
  assert.deepEqual(second.blockers, []);
  const burst = (r: RequestView) =>
    r.request.requested.find((l) => l.feature_key.endsWith('request_limit.burst'))!;
  assert.deepEqual(burst(second).awaiting, ['vip_tier']);
  // VIP 等级在自己的资源记录上获批:等待它的请求按新台账重发,并生成一条任务。
  const vipGranted = await call('editor', 'POST', onboardingPath, {
    ...base,
    title: 'VIP 3 granted',
    structured: fields('onboarding', {
      venueKey: 'cex.bitget',
      resourceType: 'vip_tier',
      resourceStage: 'granted',
      resourceRef: 'VIP-3-approval',
      capabilities: 'trading',
      product: 'Linear perpetual',
      blockers: 'None',
      businessOwner: 'BD fixture',
    }),
  });
  assert.equal(vipGranted.statusCode, 201, vipGranted.body);
  current = await requests();
  assert.equal(current.length, 1);
  const third = current[0]!;
  assert.notEqual(third.id, second.id);
  assert.equal(third.reissueOf, second.id);
  assert.equal(third.recordId, recordId);
  assert.deepEqual(burst(third).awaiting, []);
  const kept = await h.ctx.pool.query(
    'SELECT request FROM omniboard.v_connector_request WHERE request_id = $1',
    [second.id],
  );
  assert.deepEqual(kept.rows[0].request, second.request, 'the superseded snapshot stays intact');
  const unlock = (await feed()).tasks.find((task) => task.title.includes('vip tier granted'));
  assert.ok(unlock);
  assert.equal(unlock.title, 'bitget vip tier granted · 1 leaves can be verified');
  assert.equal(unlock.displayState, 'ready');
  assert.equal(unlock.lane, 'engineering');
  assert.match(unlock.description, new RegExp(third.id));
  // 已进过请求的约束出了新版本 → 漂移任务。
  const drift = await call('editor', 'PATCH', `${apiPath}/${vip.json().id}`, {
    ...base,
    revision: 1,
    reuseReference: true,
    rawText: '',
    structured: fields('api_optimization', {
      product: 'Linear perpetual',
      prerequisites: 'VIP 4',
      sourceId: 'SRC-bitget-vip-burst',
      constraintKind: 'entitlement',
      constraintValue: '{"feature_keys":["trading.unified.*"],"status":"granted"}',
      affectsFeatureKeys: 'trading.unified.linear_perpetual.advanced.request_limit.*',
      evidenceLevel: 'OFFICIAL',
    }),
  });
  assert.equal(drift.statusCode, 200, drift.body);
  const driftTask = (await feed()).tasks.find((task) =>
    task.title.startsWith('Constraint SRC-bitget-vip-burst changed'),
  );
  assert.ok(driftTask);
  assert.equal(driftTask.title, 'Constraint SRC-bitget-vip-burst changed · rev 1 → 2');
  assert.match(driftTask.description, /request_limit\.burst/);

  // quant 写的 run 直接决定请求状态,并供 validation 任务一键完成。
  assert.equal(
    (await call('editor', 'POST', `/organizations/${org}/work/start`, { visibility: 'team' }))
      .statusCode,
    201,
  );
  await quant.run(third.id, 'bitget', { finished_at: null, status: 'failed' });
  assert.equal((await requests())[0]!.state, 'running');
  await quant.run(third.id, 'bitget', {
    status: 'failed',
    blockers: [
      { key: 'place_order', reason: 'rejected', next_step: 'Enable trading on the test account.' },
    ],
  });
  await quant.result(
    runId(1),
    'trading.unified.linear_perpetual.advanced.place_order.gtc',
    'failed',
  );
  const failed = (await requests())[0]!;
  assert.equal(failed.state, 'failed');
  assert.equal(
    failed.leaves.find((l) => l.featureKey.endsWith('place_order.gtc'))!.status,
    'failed',
  );
  const alerts = (await feed()).alerts;
  assert.ok(
    alerts.some(
      (a) => a.kind === 'request' && a.detail.includes('Enable trading on the test account.'),
    ),
    JSON.stringify(alerts),
  );
  const passedRun = await quant.run(third.id, 'bitget', {
    run_id: runId(2),
    started_at: '2026-09-20T10:00:00Z',
    finished_at: '2026-09-20T10:30:00Z',
  });
  await quant.result(
    passedRun,
    'trading.unified.linear_perpetual.advanced.place_order.gtc',
    'passed',
    '2026-09-28T10:30:00Z',
  );
  const passed = (await requests())[0]!;
  assert.equal(passed.state, 'passed');
  assert.equal(
    passed.leaves.find((l) => l.featureKey.endsWith('place_order.gtc'))!.status,
    'passed',
  );
  const validation = (await feed('editor')).tasks.find(
    (task) => task.templateKey === 'validation',
  )!;
  const evidence = (
    await call('reader', 'GET', `/work/tasks/${validation.id}/verification`)
  ).json();
  assert.deepEqual(
    evidence.attempts.map((a: AttemptRow) => a.runId),
    [runId(2)],
  );
  const complete = (role: string, revision: number) =>
    call(role, 'POST', `/work/tasks/${validation.id}/verification-complete`, {
      revision,
      runId: runId(2),
    });
  assert.equal((await complete('reader', validation.revision)).statusCode, 403);
  assert.equal(
    (await complete('editor', validation.revision)).statusCode,
    409,
    'prerequisite tasks still open',
  );
  for (const key of ['scope', 'eligibility', 'account', 'resources', 'docs', 'implementation']) {
    const task = (await feed('editor')).tasks.find((x) => x.templateKey === key)!;
    const done = await call('editor', 'POST', `/work/tasks/${task.id}/actions`, {
      revision: task.revision,
      state: 'done',
      outcome: 'Fixture',
      rawText: 'Fixture evidence',
    });
    assert.equal(done.statusCode, 200, key + ' ' + done.body);
  }
  const ready = (await feed('editor')).tasks.find((x) => x.templateKey === 'validation')!;
  const completed = await complete('editor', ready.revision);
  assert.equal(completed.statusCode, 200, completed.body);
  const finished = (await feed('editor')).tasks.find((x) => x.templateKey === 'validation')!;
  assert.equal(finished.state, 'done');
  assert.equal(finished.ownerName, 'editor', 'completing with a run claims an unowned task');
  assert.match(finished.outcome, new RegExp(`run ${runId(2)}`));
  assert.match(finished.outcome, /Code revision: 43c9b23a/);
  assert.equal(
    (
      await call('editor', 'POST', `/work/tasks/${unlock.id}/verification-complete`, {
        revision: unlock.revision,
        runId: runId(2),
      })
    ).statusCode,
    422,
    'only the standard validation task completes with a run',
  );

  // 看板读的是同一组视图和台账。
  const board = (await call('reader', 'GET', '/connectors')).json();
  assert.equal(board.venues.length, fixtureVenues.length);
  assert.equal(board.declaredAt, '2026-09-19T10:00:00.000Z');
  assert.equal(board.verifiedAt, '2026-09-28T10:30:00.000Z');
  assert.equal(board.staleDays, 30);
  const bitget = board.venues.find((v: { venueKey: string }) => v.venueKey === 'bitget');
  assert.equal(bitget.faces.trading.color, 'amber', 'one passed, one without a result');
  assert.equal(bitget.faces.trading.passed, 1);
  assert.equal(bitget.faces.market.color, 'amber');
  assert.equal(bitget.organizations[0].id, org);
  const venue = (await call('reader', 'GET', '/connectors/bitget')).json<VenueBoard>();
  const header = venue.columns.find(
    (c) => c.environment === 'dev-cred' && c.accountKind === 'test',
  )!;
  assert.equal(header.credentials!.resourceStage, 'granted');
  assert.equal(header.credentials!.accountRefPresent, true);
  assert.equal(header.credentials!.owner, 'BD fixture');
  const trading = venue.faces.find((f) => f.face === 'trading')!;
  assert.equal(trading.ownerPath, 'src/actions/');
  const burstLeaf = trading.leaves.find((l) => l.featureKey.endsWith('request_limit.burst'))!;
  assert.equal(burstLeaf.state, 'no_result');
  assert.equal(burstLeaf.color, 'amber');
  const detail = (
    await call(
      'reader',
      'GET',
      '/connectors/bitget/leaves/trading.unified.linear_perpetual.advanced.place_order.gtc',
    )
  ).json();
  assert.equal(detail.rows.length, 1);
  assert.equal(detail.attempts.length, 2, 'each run id appears once');
  assert.equal(detail.ownerPath, 'src/actions/');
  assert.equal((await call('reader', 'GET', '/connectors/nope')).statusCode, 404);
  assert.equal((await call('reader', 'GET', '/connectors/Bad%20Venue')).statusCode, 404);
  assert.equal((await call('reader', 'GET', '/connectors/bitget/leaves/Nope')).statusCode, 404);
  assert.ok(board.alerts.every((a: { kind: string }) => ['request', 'connector'].includes(a.kind)));
});

test('stale verified leaves and dirty builds: alerts and request states follow contract section 2', async (t) => {
  const { quant, call, org, requests, feed } = await setup(t);
  await quant.declare('okx');
  const created = await call('editor', 'POST', `/organizations/${org}/tabs/onboarding/records`, {
    ...base,
    structured: fields('onboarding', {
      venueKey: 'cex.okx',
      resourceType: 'api_credentials',
      capabilities: 'market',
      product: 'Spot',
      nextAction: 'validate_readonly',
      accountRef: 'okx-test-01',
      blockers: 'None',
    }),
  });
  assert.equal(created.statusCode, 201, created.body);
  const request = (await requests())[0]!;
  const dirty = await quant.run(request.id, 'okx', { run_id: runId(7), build_dirty: true });
  await quant.result(dirty, 'market.spot.trade.ws', 'passed', '2026-08-01T00:00:00Z');
  const view = (await requests())[0]!;
  assert.equal(view.state, 'queued', 'dirty builds never move a request out of queued');
  assert.equal(
    view.leaves.find((l) => l.featureKey === 'market.spot.trade.ws')!.status,
    'no_result',
  );
  const clean = await quant.run(request.id, 'okx', { run_id: runId(8), suite: 'market-event' });
  await quant.result(clean, 'market.spot.trade.ws', 'passed', '2026-08-02T00:00:00Z');
  const stale = (await requests())[0]!.leaves.find((l) => l.featureKey === 'market.spot.trade.ws')!;
  assert.equal(stale.status, 'passed');
  assert.equal(stale.stale, true, 'older than 30 days at the 2026-09-29 test clock');
  const alerts = (await feed()).alerts.filter((a) => a.kind === 'connector');
  assert.deepEqual(
    alerts.map((a) => [a.title, a.detail]),
    [['okx · 1 verified leaves are stale', 'Re-test: evidence is older than 30 days.']],
  );
  // 选了机构却还没有任务时也检查它的请求;不选机构时只看有任务的机构(11.5)。
  assert.equal((await call('reader', 'GET', '/work')).json<WorkFeed>().alerts.length, 0);
});

test('work summary respects authentication, organization scope, visibility and current request revisions', async (t) => {
  const { h, call, org } = await setup(t);
  const company = (
    await call('admin', 'POST', '/organizations', { name: 'Synthetic company', tags: ['company'] })
  ).json().id as string;
  assert.equal((await h.request('GET', `/api/organizations/${org}/work-summary`)).statusCode, 401);
  const summaryOf = async (role: string, id = org) =>
    (await call(role, 'GET', `/organizations/${id}/work-summary`)).json<OrganizationWork>();
  const empty = await summaryOf('reader');
  assert.equal(empty.onboarding.status, 'empty');
  assert.deepEqual(empty.requests, []);
  assert.equal((await summaryOf('reader', company)).onboarding.status, 'not_applicable');
  const payload = (visibility: string, title: string) => ({
    ...base,
    title,
    body: 'Synthetic test record, not provider research.',
    scope: 'Fixture spot account',
    visibility,
    structured: fields('onboarding', {
      venueKey: 'cex.fixture',
      capabilities: 'market',
      product: 'Fixture spot scope',
      owner: 'Fixture record owner',
      reviewedOn: '2026-09-19',
      verification: 'Confirm fixture account scope.',
      blockers: 'Fixture approval pending',
      nextAction: 'validate_readonly',
      nextStep: 'Assign a fixture business owner.',
    }),
  });
  const hidden = await call(
    'admin',
    'POST',
    `/organizations/${org}/tabs/onboarding/records`,
    payload('admin', 'Private fixture access'),
  );
  assert.equal(hidden.statusCode, 201, hidden.body);
  const restricted = await summaryOf('reader');
  assert.equal(restricted.onboarding.status, 'restricted');
  assert.equal(restricted.onboarding.records, undefined);
  assert.deepEqual(restricted.requests, []);
  const added = await call(
    'admin',
    'POST',
    `/organizations/${org}/tabs/onboarding/records`,
    payload('team', 'Public fixture access'),
  );
  assert.equal(added.statusCode, 201, added.body);
  const summary = await summaryOf('reader');
  assert.equal(summary.onboarding.records!.length, 1);
  assert.equal(summary.requests.length, 1);
  assert.ok(!JSON.stringify(summary).includes('Private fixture access'));
  const record = summary.onboarding.records![0]!;
  assert.equal(summary.requests[0]!.recordId, record.id);
  assert.ok(
    summary.requests[0]!.blockers.includes('No imported connector implementation for this venue.'),
  );
  const edit = await call(
    'admin',
    'PATCH',
    `/organizations/${org}/tabs/onboarding/records/${record.id}`,
    {
      ...payload('team', 'Public fixture access'),
      revision: record.revision,
      structured: {
        ...record.structured,
        nextAction: 'none',
        nextStep: 'No engineering request; confirm business scope first.',
        businessOwner: 'Fixture business team',
        technicalOwner: 'Fixture engineering team',
      },
    },
  );
  assert.equal(edit.statusCode, 200, edit.body);
  const revised = await summaryOf('reader');
  assert.equal(
    revised.requests.length,
    0,
    'Previous revision requests must not become current blockers',
  );
  assert.equal(revised.onboarding.records![0]!.structured.businessOwner, 'Fixture business team');
  const admin = await summaryOf('admin');
  assert.equal(admin.onboarding.records!.length, 2);
  assert.equal(admin.requests.length, 1);
  assert.equal(
    (await call('reader', 'GET', '/organizations/missing/work-summary')).statusCode,
    404,
  );
  assert.equal(
    (await call('reader', 'GET', `/organizations/${org}/integrations`)).json().requests.length,
    0,
    'requests of administrator-only records stay hidden',
  );
});

test('request import keeps v1 request ids and follows the import window', async (t) => {
  const { h, call, sessions, org, requests } = await setup(t);
  const bearer = (
    await h.request(
      'POST',
      '/api/tokens',
      { cookie: sessions.admin! },
      { name: 'importer', role: 'admin', expiresInDays: 7 },
    )
  ).json().token as string;
  const post = (body: object) =>
    h.request('POST', '/api/import/connector-requests', { bearer }, body);
  const created = await call('editor', 'POST', `/organizations/${org}/tabs/onboarding/records`, {
    ...base,
    structured: fields('onboarding', {
      venueKey: 'cex.bitget',
      capabilities: 'market',
      product: 'Spot',
      blockers: 'None',
    }),
  });
  const recordId = created.json().id as string;
  const requestId = '2dc2e953-2e51-4dcd-8f89-6d1590f3dfca';
  const request = {
    schema_version: 1,
    request_id: requestId,
    venue_key: 'bitget',
    crate_path: 'connector/crates/conn-bitget',
    environment: 'dev-cred',
    account: { name: 'bitget-test-01', kind: 'test' },
    requested: [{ feature_key: 'market.*', prerequisites: [], awaiting: [] }],
    constraints: [],
  };
  const body = {
    requestId,
    organizationId: org,
    recordId,
    recordRevision: 1,
    action: 'validate_readonly',
    declaredRevision: '',
    request,
    createdAt: '2026-09-01T00:00:00Z',
  };
  assert.equal(
    (await h.request('POST', '/api/import/connector-requests', { cookie: sessions.admin! }, body))
      .statusCode,
    403,
  );
  assert.equal(
    (await post({ ...body, request: { ...request, account: { name: 'x', kind: 'production' } } }))
      .statusCode,
    422,
    'production accounts are not valid requests',
  );
  assert.equal(
    (
      await post({
        ...body,
        request: { ...request, request_id: '2dc2e953-0000-4dcd-8f89-6d1590f3dfca' },
      })
    ).statusCode,
    422,
  );
  assert.equal((await post({ ...body, recordId: 'missing' })).statusCode, 422);
  assert.equal((await post(body)).statusCode, 201);
  assert.equal((await post(body)).statusCode, 409);
  const imported = (await requests())[0]!;
  assert.equal(imported.id, requestId);
  assert.equal(imported.createdAt, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(imported.request, request);
  await h.ctx.pool.query(
    "UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'",
  );
  assert.equal(
    (await post({ ...body, requestId: '2dc2e953-2e51-4dcd-8f89-000000000000' })).statusCode,
    403,
  );
});
