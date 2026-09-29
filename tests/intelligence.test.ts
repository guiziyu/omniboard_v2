import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { defaultsFor } from '../src/shared/knowledge';
import type { IntelligenceDetail, IntelligenceFeed, WorkFeed } from '../src/shared/operations';
import { harness, tokenOf } from './helpers';
// 情报收件箱、已读与关注(frontend-spec 8.1–8.3)。v1 tests/operations.test.ts 的两条 intelligence 用例与
// tests/talent.test.ts 的 queue 用例逐条保留;v1 直接改库升 revision,这里走记录编辑接口,
// 所以 What changed 比较的是真实写入的历史。另加别名、导入与关注规范机构的断言。

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const h = await harness();
  t.after(h.close);
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
  const sql = (text: string, values: unknown[] = []) => h.ctx.pool.query(text, values);
  const newOrg = async (name: string) =>
    (await call('admin', 'POST', '/organizations', { name, tags: ['exchange'] })).json()
      .id as string;
  const org = await newOrg('Synthetic exchange');
  const other = await newOrg('Other synthetic exchange');
  const contact = {
    ...defaultsFor('contacts'),
    channel: 'email',
    value: 'sales@example.test',
    role: 'Sales',
    owner: 'Test BD',
    reviewedOn: '2026-09-18',
    verification: 'Synthetic evidence for contract tests.',
  };
  const fixture = (access: 'team' | 'admin', title: string, tab = 'comments') => ({
    ...(tab === 'contacts' ? { structured: contact } : {}),
    title,
    body: 'Fixture text',
    scope: 'Fixture scope',
    status: 'unverified',
    visibility: access,
    rawText: 'Synthetic evidence, never real provider facts.',
    sourceUrl: 'https://example.test/evidence',
  });
  async function record(access: 'team' | 'admin', orgId = org, tab = 'comments', title = '') {
    const response = await call(
      'admin',
      'POST',
      `/organizations/${orgId}/tabs/${tab}/records`,
      fixture(access, title || access + ' fixture record', tab),
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  /** 经记录编辑接口改正文,revision + 1 并写入历史。 */
  async function revise(recordId: string, body: string, orgId = org) {
    const response = await call(
      'admin',
      'PATCH',
      `/organizations/${orgId}/tabs/comments/records/${recordId}`,
      {
        ...fixture('team', 'team fixture record'),
        body,
        rawText: '',
        reuseReference: true,
        revision: 1,
      },
    );
    assert.equal(response.statusCode, 200, response.body);
  }
  const inbox = async (role: string, query = '') =>
    (await call(role, 'GET', '/intelligence' + query)).json<IntelligenceFeed>();
  const feed = async (role = 'admin') => (await call(role, 'GET', '/work')).json<WorkFeed>();
  return { h, call, sql, sessions, org, other, newOrg, record, revise, inbox, feed };
}

test('intelligence read and follow state are personal, revision-specific and never verify information', async (t) => {
  const { call, sql, org, other, record, revise, inbox, feed } = await setup(t);
  const team = await record('team');
  const restricted = await record('admin');
  await record('team', other);
  let r = await call('reader', 'GET', '/intelligence');
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().total, 0);
  assert.equal(
    (await call('reader', 'POST', `/organizations/${org}/follow`, { follow: true })).statusCode,
    200,
  );
  assert.equal(
    (await call('reader', 'POST', '/organizations/missing/follow', { follow: true })).statusCode,
    404,
  );
  assert.deepEqual((await feed('reader')).followedOrganizationIds, [org]);
  assert.equal((await feed('editor')).followedOrganizationIds.length, 0);
  let list = await inbox('reader');
  assert.equal(list.total, 1);
  assert.equal(list.items[0]!.id, team);
  assert.deepEqual(list.items[0]!.reasons, ['You follow this organization']);
  assert.equal((await call('reader', 'GET', `/intelligence/${restricted}`)).statusCode, 404);
  assert.equal(
    (await call('reader', 'POST', `/intelligence/${restricted}/read`, { revision: 1, read: true }))
      .statusCode,
    404,
  );
  assert.equal(
    (await call('reader', 'POST', `/intelligence/${team}/read`, { revision: 1, read: true }))
      .statusCode,
    200,
  );
  assert.equal((await inbox('reader')).total, 0);
  assert.equal((await inbox('editor', `?organizationId=${org}`)).items[0]!.read, false);
  // 已读不改变评审状态。
  assert.equal(
    (await sql('SELECT status FROM omniboard.module_records WHERE id = $1', [team])).rows[0].status,
    'unverified',
  );
  await revise(team, 'Updated original information');
  assert.equal((await inbox('reader')).total, 1);
  assert.equal(
    (await call('reader', 'POST', `/intelligence/${team}/read`, { revision: 1, read: true }))
      .statusCode,
    409,
  );
  assert.equal(
    (await call('reader', 'POST', `/intelligence/${team}/read`, { revision: 2, read: true }))
      .statusCode,
    200,
  );
  const all = await inbox('reader', '?scope=all&view=all&limit=1');
  assert.equal(all.total, 2);
  assert.equal(all.hasMore, true);
  const next = await inbox('reader', '?scope=all&view=all&limit=1&offset=1');
  assert.notEqual(all.items[0]!.id, next.items[0]!.id);
  assert.equal(next.hasMore, false);
  assert.equal(
    (await call('reader', 'POST', `/intelligence/${team}/read`, { revision: 2, read: false }))
      .statusCode,
    200,
  );
  assert.equal((await inbox('reader')).items[0]!.read, false);
  await call('reader', 'POST', `/organizations/${org}/follow`, { follow: false });
  assert.equal((await inbox('reader')).total, 0);
  await call('editor', 'POST', `/organizations/${org}/work/start`, { visibility: 'team' });
  list = await inbox('reader');
  assert.equal(list.total, 1);
  assert.deepEqual(list.items[0]!.reasons, ['Open team work at this organization']);
});

test('intelligence detail distinguishes linked work from organization context and compares saved revisions', async (t) => {
  const { call, org, record, revise } = await setup(t);
  const source = await record('team');
  const create = async (title: string, visibility = 'team', extra: object = {}) => {
    const r = await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
      title,
      lane: 'business',
      visibility,
      sourceRecordId: source,
      ...extra,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  };
  const direct = await create('Direct source follow-up');
  await create('Restricted follow-up', 'admin');
  const unrelated = await create('Same organization only', 'team', {
    sourceRecordId: await record('team'),
  });
  // 经共享对象关联的任务也算直接关联。
  const object = await call('editor', 'POST', `/organizations/${org}/knowledge/objects`, {
    kind: 'account',
    name: 'Fixture account',
    scope: 'Spot',
    visibility: 'team',
    sourceRecordId: source,
  });
  assert.equal(object.statusCode, 201, object.body);
  const viaObject = await create('Linked through the account', 'team', {
    sourceRecordId: await record('team'),
    objectIds: [object.json().id],
  });
  let detail = (await call('editor', 'GET', `/intelligence/${source}`)).json<IntelligenceDetail>();
  assert.equal(detail.hasPrevious, false);
  assert.deepEqual(detail.changes, []);
  await revise(source, 'A new scoped update');
  const r = await call('editor', 'GET', `/intelligence/${source}`);
  assert.equal(r.statusCode, 200, r.body);
  detail = r.json<IntelligenceDetail>();
  assert.equal(detail.tasks.length, 3);
  assert.equal(detail.tasks.find((x) => x.id === direct)!.link, 'direct');
  assert.equal(detail.tasks.find((x) => x.id === viaObject)!.link, 'direct');
  assert.equal(detail.tasks.find((x) => x.id === unrelated)!.link, 'organization');
  assert.deepEqual(
    detail.tasks.map((x) => x.link),
    ['direct', 'direct', 'organization'],
  );
  assert.equal(detail.hasPrevious, true);
  assert.deepEqual(detail.changes, [
    { field: 'body', before: 'Fixture text', after: 'A new scoped update' },
  ]);
  assert.equal(detail.source.url, 'https://example.test/evidence');
  assert.deepEqual(
    detail.objects.map((o) => o.name),
    ['Fixture account'],
  );
  assert.equal(detail.item.revision, 2);
  assert.equal(detail.item.read, false);
});

test('intelligence queues separate review from expiry and protect linked contact evidence', async (t) => {
  const { sql, call, org, record, inbox } = await setup(t);
  const expired = await record('team', org, 'comments', 'Expired rule');
  const current = await record('team', org, 'comments', 'Current rule');
  const privateContact = await record('admin', org, 'contacts', 'Private contact source');
  const teamContact = await record('team', org, 'contacts', 'Team contact source');
  await sql(
    `UPDATE omniboard.module_records SET structured = $2, status = 'confirmed' WHERE id = $1`,
    [expired, { expiresOn: '2000-01-01' }],
  );
  await sql('UPDATE omniboard.module_records SET structured = $2 WHERE id = $1', [
    current,
    { expiresOn: '2099-01-01' },
  ]);
  const expiredQueue = await inbox('reader', '?scope=all&view=all&queue=expired');
  assert.deepEqual(
    expiredQueue.items.map((r) => r.id),
    [expired],
  );
  const review = await call('reader', 'GET', '/intelligence?scope=all&view=all&queue=review');
  assert.ok(review.json<IntelligenceFeed>().items.some((r) => r.id === current));
  assert.ok(!review.body.includes(expired));
  assert.ok(!review.body.includes(privateContact));
  const detail = await call('reader', 'GET', '/intelligence/' + current);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.ok(!detail.body.includes('Private contact source'));
  assert.deepEqual(
    detail.json<IntelligenceDetail>().contacts.map((c) => c.id),
    [teamContact],
  );
  const adminDetail = (await call('admin', 'GET', '/intelligence/' + current)).json();
  assert.equal(adminDetail.contacts.length, 2);
});

test('merged records and organizations stay out of the inbox; follows resolve to the canonical organization', async (t) => {
  const { sql, call, org, newOrg, record, inbox, feed } = await setup(t);
  const kept = await record('team');
  const duplicate = await record('team');
  await sql('INSERT INTO omniboard.record_aliases (alias_id, record_id) VALUES ($1, $2)', [
    duplicate,
    kept,
  ]);
  const merged = await newOrg('Merged synthetic exchange');
  const mergedRecord = await record('team', merged);
  await sql(
    `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
     VALUES ($1, $2, 'Duplicate listing', '{}')`,
    [merged, org],
  );
  const all = await inbox('editor', '?scope=all&view=all');
  assert.deepEqual(
    all.items.map((i) => i.id),
    [kept],
  );
  assert.equal((await call('editor', 'GET', `/intelligence/${duplicate}`)).statusCode, 404);
  assert.equal((await call('editor', 'GET', `/intelligence/${mergedRecord}`)).statusCode, 404);
  // 以旧机构 ID 关注、筛选,都读作规范机构。
  assert.equal(
    (await call('editor', 'POST', `/organizations/${merged}/follow`, { follow: true })).statusCode,
    200,
  );
  assert.deepEqual((await feed('editor')).followedOrganizationIds, [org]);
  assert.deepEqual(
    (await inbox('editor', `?organizationId=${merged}`)).items.map((i) => i.id),
    [kept],
  );
});

test('read and follow imports keep v1 times, are idempotent and follow the import window', async (t) => {
  const { h, call, sql, sessions, org, newOrg, record, inbox, feed } = await setup(t);
  const bearer = (
    await h.request(
      'POST',
      '/api/tokens',
      { cookie: sessions.admin! },
      { name: 'importer', role: 'admin', expiresInDays: 7 },
    )
  ).json().token as string;
  const post = (path: string, body: object) => h.request('POST', path, { bearer }, body);
  const readerId = (await call('reader', 'GET', '/session')).json().user.id as string;
  const recordId = await record('team');
  const read = { ownerId: readerId, recordId, revision: 1, readAt: '2025-03-01T08:00:00Z' };
  assert.equal(
    (await h.request('POST', '/api/import/intelligence-reads', { cookie: sessions.admin! }, read))
      .statusCode,
    403,
  );
  assert.equal(
    (await post('/api/import/intelligence-reads', { ...read, recordId: 'missing' })).statusCode,
    422,
  );
  assert.equal((await post('/api/import/intelligence-reads', read)).statusCode, 201);
  assert.equal((await post('/api/import/intelligence-reads', read)).statusCode, 200);
  assert.equal(
    (await post('/api/import/intelligence-reads', { ...read, revision: 2 })).statusCode,
    409,
  );
  assert.equal(
    (
      await sql('SELECT read_at FROM omniboard.intelligence_reads WHERE record_id = $1', [recordId])
    ).rows[0].read_at.toISOString(),
    '2025-03-01T08:00:00.000Z',
  );
  assert.equal((await inbox('reader', `?organizationId=${org}&view=all`)).items[0]!.read, true);
  const merged = await newOrg('Merged synthetic exchange');
  await sql(
    `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
     VALUES ($1, $2, 'Duplicate listing', '{}')`,
    [merged, org],
  );
  const follow = { ownerId: readerId, organizationId: merged, createdAt: '2025-03-02T00:00:00Z' };
  assert.equal((await post('/api/import/organization-follows', follow)).statusCode, 201);
  assert.equal((await post('/api/import/organization-follows', follow)).statusCode, 200);
  assert.deepEqual((await feed('reader')).followedOrganizationIds, [org]);
  assert.equal(
    (await post('/api/import/organization-follows', { ...follow, ownerId: 'missing' })).statusCode,
    422,
  );
  await sql("UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'");
  assert.equal(
    (await post('/api/import/organization-follows', { ...follow, organizationId: org })).statusCode,
    403,
  );
});
