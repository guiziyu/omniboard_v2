import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bootstrapAdmin } from '../src/server/auth';
import { contactHref, defaultsFor, validateKnowledge } from '../src/shared/knowledge';
import { recordBusinessState, reviewDue } from '../src/shared/record-summary';
import { tabsFor, unionTabs } from '../src/shared/registry';
import { organizationProfileInput } from '../src/server/profiles';
import type { Tag } from '../src/shared/types';
import { harness, tokenOf } from './helpers';
// 模块注册、字段契约、记录读写与档案(frontend-spec 4.2、4.3、4.7、5.5–5.7)。
// v1 tests/domain、tag-module-scope、record-summary、knowledge、organization-profile 的相关断言逐条保留。

const ids = (...tags: Tag[]) => tabsFor(tags).map((t) => t.id);
test('module bundles: deduplicated, order-independent, union for comparison', () => {
  assert.equal(tabsFor(['company']).length, 8);
  assert.equal(tabsFor(['government']).length, 8);
  assert.equal(tabsFor(['exchange']).length, 13);
  assert.deepEqual(tabsFor(['company', 'exchange']), tabsFor(['exchange', 'company']));
  assert.deepEqual(unionTabs(['company'], ['exchange']), tabsFor(['exchange']));
  for (const tag of ['market_maker', 'hedge_fund', 'trading_company', 'think_tank'] as Tag[]) {
    const modules = ids(tag, 'company');
    for (const unwanted of ['onboarding', 'api_optimization', 'capital_optimization', 'compliance'])
      assert(!modules.includes(unwanted), `${tag}: ${unwanted}`);
  }
  for (const tag of ['bank', 'custodian', 'data_provider', 'infrastructure_provider'] as Tag[]) {
    assert(ids(tag).includes('onboarding'));
    assert(!ids(tag).includes('api_optimization'));
  }
  assert(ids('market_maker', 'exchange').includes('api_optimization'));
  assert(ids('bank').includes('payments') && !ids('broker').includes('payments'));
});

const common = {
  owner: 'Test BD',
  reviewedOn: '2026-09-18',
  verification: 'Synthetic evidence for contract tests.',
};
const fields = (tab: string, extra: Record<string, string> = {}) => ({
  ...defaultsFor(tab),
  ...common,
  ...extra,
});
test('field contracts reject unknown fields, bad dates, negatives and unsafe addresses', () => {
  assert.throws(() => validateKnowledge('api_optimization', {}));
  const api = fields('api_optimization', { product: 'Spot', prerequisites: 'Provider grant' });
  assert.equal(validateKnowledge('api_optimization', api).entitlement, 'unknown');
  for (const patch of [
    { invented: 'AI field' },
    { intervalMs: '-1' },
    { p99Us: '1e9' },
    { reviewedOn: '2026-02-31' },
  ])
    assert.throws(() => validateKnowledge('api_optimization', { ...api, ...patch }));
  const contact = fields('contacts', {
    channel: 'email',
    value: 'sales@example.test',
    role: 'Sales',
  });
  assert.equal(validateKnowledge('contacts', contact).value, 'sales@example.test');
  assert.throws(() => validateKnowledge('contacts', { ...contact, value: 'guessed' }));
  assert.throws(() =>
    validateKnowledge('contacts', {
      ...contact,
      channel: 'telegram',
      value: 'javascript:alert(1)',
    }),
  );
  assert.throws(() =>
    validateKnowledge('contacts', { ...contact, evidenceLevel: 'OFFICIAL', sensitivity: 'NDA' }),
  );
  const wechat = validateKnowledge('contacts', {
    ...contact,
    channel: 'wechat',
    value: 'Example_99',
  });
  assert.equal(contactHref(wechat), '', 'a WeChat ID is not a link');
  assert.equal(
    validateKnowledge(
      'capital_optimization',
      fields('capital_optimization', {
        product: 'Spot',
        conditions: 'Contract',
        economics: 'Test',
        makerFeeBps: '-0.25',
      }),
    ).makerFeeBps,
    '-0.25',
  );
  // 业务状态只来自结构化字段。
  assert.deepEqual(
    recordBusinessState({
      tabId: 'api_optimization',
      structured: { evidenceLevel: 'OFFICIAL', sourceKind: 'official_website' },
    }),
    { field: 'entitlement', value: 'unknown' },
  );
  assert.equal(reviewDue({ structured: { expiresOn: '2026-09-18' } }, '2026-09-19'), true);
});

test('records: states, revisions, references, visibility, history, profile', async (t) => {
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
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    body?: unknown,
    role = 'editor',
  ) => request(method, url, as(role), body);
  const org = (
    await call('POST', '/api/organizations', { name: 'Test company', tags: ['company'] })
  ).json().id as string;
  const exchange = (
    await call('POST', '/api/organizations', { name: 'Test exchange', tags: ['exchange'] })
  ).json().id as string;
  const base = {
    title: 'Test record',
    body: 'Test notes',
    scope: 'Test',
    status: 'unverified',
    visibility: 'team',
    rawText: '  Original evidence\nunchanged  ',
    sourceUrl: 'https://example.test/source',
  };
  const contact = {
    ...base,
    personName: 'Public person',
    personEmail: 'person@example.test',
    structured: fields('contacts', { channel: 'email', value: 'team@example.test', role: 'Sales' }),
  };
  const contacts = `/api/organizations/${org}/tabs/contacts`;

  await t.test('module states: empty, not applicable, detail lists tabs', async () => {
    const detail = (await call('GET', `/api/organizations/${org}`)).json();
    assert.equal(detail.tabs.length, 8);
    assert.deepEqual(detail.organization.sources, []);
    assert.equal((await call('GET', contacts)).json().status, 'empty');
    const na = (await call('GET', `/api/organizations/${org}/tabs/onboarding`)).json();
    assert.equal(na.status, 'not_applicable');
    assert.equal('records' in na, false);
    assert.equal((await call('GET', `/api/organizations/${org}/tabs/nope`)).statusCode, 404);
  });

  let saved: { id: string; evidenceId: string; revision: number };
  await t.test('create, read, keep reference, revision conflict', async () => {
    const created = await call('POST', `${contacts}/records`, contact);
    assert.equal(created.statusCode, 201, created.body);
    const data = (await call('GET', contacts, undefined, 'reader')).json();
    assert.equal(data.status, 'ready');
    saved = data.records[0];
    assert.equal(data.records[0].personEmail, 'person@example.test');
    assert.equal(data.records[0].structured.value, 'team@example.test');
    assert.equal(data.records[0].author, 'editor');
    // 原文按字节原样保存,前后空白也保留。
    assert.equal(
      (await call('GET', `/api/evidence/${saved.evidenceId}`)).json().text,
      base.rawText,
    );
    const kept = await call('PATCH', `${contacts}/records/${saved.id}`, {
      ...contact,
      rawText: '',
      reuseReference: true,
      revision: 1,
      body: 'Edited contact notes',
    });
    assert.equal(kept.statusCode, 200, kept.body);
    assert.equal(kept.json().revision, 2);
    const after = (await call('GET', contacts)).json().records[0];
    assert.equal(after.evidenceId, saved.evidenceId);
    assert.equal(after.body, 'Edited contact notes');
    const stale = await call('PATCH', `${contacts}/records/${saved.id}`, {
      ...contact,
      reuseReference: true,
      revision: 1,
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().message, 'This record has changed. Reopen the latest version.');
    const history = (
      await call('GET', `/api/records/${saved.id}/history`, undefined, 'reader')
    ).json().history;
    assert.deepEqual(
      history.map((v: { revision: number; action: string }) => [v.revision, v.action]),
      [
        [2, 'record_updated'],
        [1, 'record_created'],
      ],
    );
    assert.equal(history[1].payload.body, 'Test notes');
    assert.equal(history[1].payload.evidenceId, saved.evidenceId);
  });

  await t.test('input rules', async () => {
    const post = (body: unknown, role = 'editor', url = `${contacts}/records`) =>
      call('POST', url, body, role);
    assert.equal((await post(contact, 'reader')).statusCode, 403);
    assert.equal((await post({ ...contact, reuseReference: true })).statusCode, 422);
    assert.equal((await post({ ...contact, rawText: '   ' })).statusCode, 422);
    assert.equal((await post({ ...contact, personEmail: 'wrong' })).statusCode, 422);
    assert.equal((await post({ ...contact, reportsTo: 'someone' })).statusCode, 422);
    assert.equal((await post({ ...contact, structured: { invented: 'x' } })).statusCode, 422);
    assert.equal(
      (await post(base, 'editor', `/api/organizations/${org}/tabs/stats/records`)).statusCode,
      422,
    );
    assert.equal(
      (await post(base, 'editor', `/api/organizations/${org}/tabs/onboarding/records`)).statusCode,
      422,
      'module not configured for the tag',
    );
    const nda = { ...contact, structured: { ...contact.structured, sensitivity: 'NDA' } };
    assert.equal((await post(nda, 'admin')).statusCode, 422);
    assert.equal((await post({ ...nda, visibility: 'admin' })).statusCode, 403);
    const restricted = await post({ ...nda, visibility: 'admin' }, 'admin');
    assert.equal(restricted.statusCode, 201, restricted.body);
    const adminRecord = (await call('GET', contacts, undefined, 'admin'))
      .json()
      .records.find((r: { id: string }) => r.id === restricted.json().id);
    assert.equal(
      (await call('GET', `/api/evidence/${adminRecord.evidenceId}`, undefined, 'reader'))
        .statusCode,
      403,
    );
    assert.equal(
      (await call('GET', `/api/records/${adminRecord.id}/history`, undefined, 'reader')).statusCode,
      403,
    );
    assert.equal((await call('GET', contacts, undefined, 'reader')).json().records.length, 1);
    const edit = await call(
      'PATCH',
      `${contacts}/records/${adminRecord.id}`,
      {
        ...nda,
        visibility: 'team',
        reuseReference: true,
        revision: 1,
      },
      'admin',
    );
    assert.equal(edit.statusCode, 422, 'visibility cannot change');
    // 模块里只有 admin 记录时,非 admin 看到 restricted,不是 empty。
    const other = `/api/organizations/${exchange}/tabs/compliance`;
    const rule = {
      ...base,
      visibility: 'admin',
      structured: fields('compliance', {
        jurisdiction: 'SG',
        legalEntity: 'Test Pte',
        product: 'Spot',
        control: 'KYC',
      }),
    };
    assert.equal((await call('POST', `${other}/records`, rule, 'admin')).statusCode, 201);
    assert.equal((await call('GET', other, undefined, 'reader')).json().status, 'restricted');
    assert.equal('records' in (await call('GET', other, undefined, 'reader')).json(), false);
    assert.equal((await call('GET', other, undefined, 'admin')).json().status, 'ready');
  });

  // 机构对比(frontend-spec 4.5),v1 tests/integration.test.ts 的 /compare 断言。
  await t.test('comparison: union of tabs, per-side status, aliases resolve', async () => {
    const compare = (left: string, right: string, tab: string, role = 'editor') =>
      call('GET', `/api/compare?left=${left}&right=${right}&tab=${tab}`, undefined, role);
    const res = await compare(org, exchange, 'compliance', 'reader');
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(
      res.json().tabs.map((tab: { id: string }) => tab.id),
      unionTabs(['company'], ['exchange']).map((tab) => tab.id),
    );
    assert.equal(res.json().left.module.status, 'not_applicable');
    assert.equal('records' in res.json().left.module, false);
    assert.equal(res.json().right.module.status, 'restricted');
    assert.equal('records' in res.json().right.module, false);
    const admin = (await compare(org, exchange, 'compliance', 'admin')).json();
    assert.equal(admin.right.module.status, 'ready');
    assert.equal(admin.right.module.records[0].structured.legalEntity, 'Test Pte');
    assert.equal(admin.right.organization.name, 'Test exchange');
    assert.ok(Array.isArray(admin.right.organization.sources));
    assert.equal((await compare(org, exchange, 'payments')).statusCode, 404);
    assert.equal((await compare(org, 'missing', 'overview')).statusCode, 404);
    const merged = (
      await call('POST', '/api/organizations', { name: 'Merged exchange', tags: ['exchange'] })
    ).json().id as string;
    await h.ctx.pool.query(
      `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
       VALUES ($1, $2, 'Reviewed duplicate', '{}')`,
      [merged, exchange],
    );
    assert.equal((await compare(org, merged, 'overview')).json().right.organization.id, exchange);
  });

  await t.test('structured constraints: source id unique per organization', async () => {
    const api = {
      ...base,
      structured: fields('api_optimization', {
        product: 'Spot',
        prerequisites: 'Provider grant',
        sourceId: 'SRC-test-ip-whitelist',
      }),
    };
    const url = `/api/organizations/${exchange}/tabs/api_optimization/records`;
    assert.equal((await call('POST', url, api)).statusCode, 201);
    const clash = await call(
      'POST',
      url,
      {
        ...api,
        structured: fields('tech_stack', { constraints: 'x', sourceId: 'SRC-test-ip-whitelist' }),
      },
      'editor',
    );
    assert.equal(clash.statusCode, 422, 'tech stack fields do not fit this tab');
    const dup = await call('POST', url, api);
    assert.equal(dup.statusCode, 409);
    assert.match(dup.json().message, /SRC-test-ip-whitelist is already used/);
  });

  await t.test('import: ids, authors, revisions and timestamps need an admin token', async () => {
    const bearer = (
      await request('POST', '/api/tokens', as('admin'), {
        name: 'importer',
        role: 'admin',
        expiresInDays: 7,
      })
    ).json().token as string;
    const editorId = (await call('GET', '/api/session')).json().user.id;
    const imported = {
      ...contact,
      id: 'v1-record',
      evidenceId: saved.evidenceId,
      rawText: '',
      authorId: editorId,
      importedRevision: 4,
      updatedAt: '2025-06-01T00:00:00Z',
    };
    assert.equal((await call('POST', `${contacts}/records`, imported, 'admin')).statusCode, 403);
    const res = await request('POST', `${contacts}/records`, { bearer }, imported);
    assert.equal(res.statusCode, 201, res.body);
    assert.deepEqual(res.json(), { id: 'v1-record', revision: 4 });
    const row = (await call('GET', contacts))
      .json()
      .records.find((r: { id: string }) => r.id === 'v1-record');
    assert.equal(row.updatedAt, '2025-06-01T00:00:00.000Z');
    assert.equal(row.author, 'editor');
    assert.equal(row.evidenceId, saved.evidenceId);
    assert.equal(
      (await request('POST', `${contacts}/records`, { bearer }, imported)).statusCode,
      409,
    );
    const secret = (await call('GET', contacts, undefined, 'admin'))
      .json()
      .records.find((r: { visibility: string }) => r.visibility === 'admin').evidenceId;
    const leak = await request(
      'POST',
      `${contacts}/records`,
      { bearer },
      {
        ...imported,
        id: 'v1-leak',
        evidenceId: secret,
      },
    );
    assert.equal(leak.statusCode, 422);
    assert.equal(leak.json().message, 'Restricted evidence requires an administrator-only item.');
  });

  await t.test(
    'profile: evidence per claim, idempotent revision, visibility filtering',
    async () => {
      const upload = async (text: string, visibility = 'team') => {
        const bytes = Buffer.from(text);
        const res = await call(
          'POST',
          '/api/evidence',
          {
            source: 'cmc_web',
            url: 'https://coinmarketcap.com/exchanges/example/',
            contentType: 'text/plain',
            visibility,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            contentBase64: bytes.toString('base64'),
          },
          visibility === 'admin' ? 'admin' : 'editor',
        );
        return res.json().id as string;
      };
      const ev = await upload('profile capture');
      const profile = {
        about: { text: 'A test exchange.', evidenceId: ev },
        facts: [{ key: 'founded', label: 'Founded', value: '2018', evidenceId: ev }],
        links: [{ key: 'site', label: 'Website', url: 'https://example.test', evidenceId: ev }],
      };
      const put = (body: unknown, role = 'editor') =>
        call('PUT', `/api/organizations/${exchange}/profile`, body, role);
      assert.equal((await put({ profile, revision: 0 }, 'reader')).statusCode, 403);
      const first = await put({ profile, revision: 0 });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().profile.revision, 1);
      assert.equal(first.json().profile.facts[0].sourceName, 'CoinMarketCap');
      assert.equal(
        (await put({ profile, revision: 1 })).json().profile.revision,
        1,
        'same content',
      );
      assert.equal(
        (await put({ profile: { ...profile, facts: [] }, revision: 0 })).statusCode,
        409,
      );
      const detail = (await call('GET', `/api/organizations/${exchange}`)).json().organization;
      assert.equal(detail.profile.about.text, 'A test exchange.');
      assert.deepEqual(detail.sources, [], 'a profile does not create ranking observations');
      assert.equal(
        (await call('GET', `/api/organizations/${org}/tabs/overview`)).json().status,
        'empty',
      );
      assert.equal(
        (await call('GET', `/api/organizations/${exchange}/tabs/overview`)).json().status,
        'ready',
      );
      // 受限证据:编辑者不能引用,也不能覆盖含受限条目的档案;读者看不到那一条。
      const secret = await upload('private capture', 'admin');
      const restricted = {
        ...profile,
        facts: [
          ...profile.facts,
          { key: 'secret', label: 'Secret', value: 'x', evidenceId: secret },
        ],
      };
      assert.equal((await put({ profile: restricted, revision: 1 })).statusCode, 403);
      assert.equal((await put({ profile: restricted, revision: 1 }, 'admin')).statusCode, 200);
      const facts = async (role: string) =>
        (await call('GET', `/api/organizations/${exchange}`, undefined, role)).json().organization
          .profile.facts.length;
      assert.equal(await facts('admin'), 2);
      assert.equal(await facts('reader'), 1);
      assert.equal((await put({ profile, revision: 2 })).statusCode, 403);
      assert.equal(
        organizationProfileInput.safeParse({
          links: [{ key: 's', label: 'x', url: 'https://u:p@x.test', evidenceId: ev }],
        }).success,
        false,
      );
      assert.equal(
        organizationProfileInput.safeParse({ facts: [profile.facts[0], profile.facts[0]] }).success,
        false,
      );
    },
  );
});
