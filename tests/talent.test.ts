import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { contactHref, defaultsFor, validateKnowledge } from '../src/shared/knowledge';
import type { TalentDetail, TalentDirectory } from '../src/shared/talent';
import { harness, original, tokenOf } from './helpers';
// 人才目录(frontend-spec 6.9–6.11)。v1 tests/talent.test.ts 的前四个用例与 tests/wechat-contact.test.ts;
// 全局搜索、讨论、情报与新行业标签的用例属于其他章节,随各自批次移植(讨论已在 discussion.test.ts)。
// v1 直接写库造出「没有人员档案的旧记录」,这里同样直接插入;经 API 保存的记录会自动建档案(6.4)。

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const h = await harness();
  t.after(h.close);
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@talent.test' })).token,
  );
  const sessions: Record<string, string> = { admin: owner.cookie };
  h.tick();
  const invited = await h.request(
    'POST',
    '/api/members',
    { cookie: owner.cookie },
    { name: 'Reader', email: 'reader@talent.test', role: 'reader' },
  );
  sessions.reader = (await h.activate(tokenOf(invited.json().inviteLink))).cookie;
  const call = (method: 'GET' | 'POST', path: string, payload?: object, role = 'admin') =>
    h.request(method, '/api' + path, { cookie: sessions[role] }, payload);
  const pool = h.ctx.pool;
  const ownerId = (
    await pool.query<{ id: string }>('SELECT id FROM omniboard.member WHERE email = $1', [
      'owner@talent.test',
    ])
  ).rows[0]!.id;
  const org = async (name: string) =>
    (await call('POST', '/organizations', { name, tags: ['company'] })).json().id as string;
  const a = await org('Alpha');
  const b = await org('Beta');
  let serial = 0;
  async function record(
    orgId: string,
    name: string,
    options: {
      tab?: string;
      visibility?: 'team' | 'admin';
      rawVisibility?: 'team' | 'admin';
      email?: string;
      date?: string;
      type?: string;
      structured?: Record<string, string>;
    } = {},
  ) {
    const key = `fixture-${++serial}`;
    await pool.query(
      `INSERT INTO omniboard.evidence
         (id, source, url, sha256, byte_length, content_type, parser_version, filename, visibility)
       VALUES ($1,'manual','',$2,0,'text/plain','manual-v1','reference.txt',$3)`,
      ['evidence-' + key, await original(pool), options.rawVisibility ?? 'team'],
    );
    await pool.query(
      `INSERT INTO omniboard.module_records
         (id, organization_id, tab_id, title, body, scope, status, visibility, person_name,
          person_email, event_date, event_type, structured, evidence_id, revision, author_id)
       VALUES ($1,$2,$3,$4,'Fixture body','Fixture','unverified',$5,$6,$7,$8,$9,$10,$11,1,$12)`,
      [
        key,
        orgId,
        options.tab ?? 'org_chart',
        options.structured?.role ?? 'Researcher',
        options.visibility ?? 'team',
        name,
        options.email ?? '',
        options.date || null,
        options.type ?? '',
        options.structured ?? {},
        'evidence-' + key,
        ownerId,
      ],
    );
    return key;
  }
  async function object(orgId: string, recordId: string, name: string) {
    const response = await call('POST', `/organizations/${orgId}/knowledge/objects`, {
      kind: 'person',
      name,
      scope: 'Fixture identity',
      visibility: 'team',
      sourceRecordId: recordId,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const directory = async (query: Record<string, string | number> = {}, role = 'admin') => {
    const response = await call(
      'GET',
      '/talent?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])),
      undefined,
      role,
    );
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as TalentDirectory;
  };
  return { h, pool, call, a, b, record, object, directory };
}

test('talent directory reuses canonical identities but never merges names or creates identities during reads', async (t) => {
  const { pool, call, a, b, record, object, directory } = await setup(t);
  const ra = await record(a, 'Morgan', { email: 'morgan@example.test' });
  const rb = await record(b, 'M. Fixture', {
    tab: 'people_movements',
    type: 'role_change',
    date: '2026-08',
    structured: { fromRole: 'Analyst', toRole: 'Research lead' },
  });
  const oa = await object(a, ra, 'Morgan');
  const ob = await object(b, rb, 'M. Fixture');
  const merge = await call('POST', `/knowledge/identities/${oa}/merge`, {
    otherId: ob,
    revision: 1,
    otherRevision: 1,
    reason: 'The fixture explicitly identifies the same person across both organizations.',
  });
  assert.equal(merge.statusCode, 200, merge.body);
  const sameName = await record(a, 'Morgan');
  await record(b, 'Morgan');
  const objects = async () =>
    (await pool.query('SELECT * FROM omniboard.knowledge_objects ORDER BY id')).rows;
  const before = await objects();
  const list = await directory();
  assert.equal(list.total, 3);
  assert.deepEqual(list.counts, { identities: 1, unlinkedRecords: 2, possibleDuplicates: 0 });
  const merged = list.people.find((p) => p.identityId === oa)!;
  assert.equal(merged.recordCount, 2);
  assert.equal(merged.contactCount, 1);
  assert.deepEqual(merged.organizations.map((o) => o.name).sort(), ['Alpha', 'Beta']);
  assert.equal(merged.latestMovement!.type, 'role_change');
  assert.equal(merged.latestMovement!.date, '2026-08');
  assert.ok(!('records' in merged) && !JSON.stringify(list).includes('Fixture body'));
  assert.ok(list.people.some((p) => p.id === 'record:' + sameName));
  const detail = (
    await call('GET', '/talent/' + encodeURIComponent('identity:' + ob))
  ).json() as TalentDetail;
  assert.equal(detail.identityId, oa);
  assert.equal(detail.contacts[0]!.href, 'mailto:morgan@example.test');
  assert.equal(detail.records.length, 2);
  assert.deepEqual(await objects(), before);
  assert.equal((await call('GET', '/talent/record:missing')).statusCode, 404);
});

test('talent permissions protect raw evidence, contacts, counts and retired records', async (t) => {
  const { h, pool, call, a, b, record, object, directory } = await setup(t);
  const publicId = await record(a, 'Public person');
  const identity = await object(a, publicId, 'Public person');
  const restricted = await record(a, 'Private person', {
    visibility: 'admin',
    email: 'secret@example.test',
  });
  const privateRaw = await record(b, 'Private raw person', { rawVisibility: 'admin' });
  // 旧数据里不一致的关联不能让公开身份泄露 admin 来源。
  await pool.query('INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1,$2)', [
    identity,
    restricted,
  ]);
  await record(a, '', {
    tab: 'contacts',
    structured: { channel: 'email', value: 'office@example.test', role: 'Organization inbox' },
  });
  const retired = await record(a, 'Retired copy');
  await pool.query('INSERT INTO omniboard.record_aliases (alias_id, record_id) VALUES ($1,$2)', [
    retired,
    publicId,
  ]);
  const list = await directory({}, 'reader');
  assert.equal(list.total, 1);
  assert.deepEqual(list.counts, { identities: 1, unlinkedRecords: 0, possibleDuplicates: 0 });
  assert.equal(list.people[0]!.contactCount, 0);
  assert.equal(list.people[0]!.recordCount, 1);
  assert.equal(
    (await call('GET', '/talent/record:' + privateRaw, undefined, 'reader')).statusCode,
    404,
  );
  const detail = (
    await call('GET', '/talent/identity:' + identity, undefined, 'reader')
  ).json() as TalentDetail;
  assert.equal(detail.records.length, 1);
  assert.ok(!JSON.stringify(detail).includes('secret@'));
  assert.equal((await h.request('GET', '/api/talent')).statusCode, 401);
});

test('talent supports scoped search, contact filters and stable pagination without inferring employment', async (t) => {
  const { a, b, record, directory, call } = await setup(t);
  await record(a, '赵明', {
    tab: 'contacts',
    structured: {
      channel: 'telegram',
      value: 'https://t.me/test_fixture',
      role: 'Institutional sales',
    },
  });
  await record(a, 'Alex');
  await record(b, 'Bailey', { tab: 'people_movements', type: 'left', date: '2026-09-01' });
  assert.equal((await directory({ q: '赵明' })).total, 1);
  assert.equal((await directory({ q: 'INSTITUTIONAL' })).total, 1);
  assert.equal((await directory({ contact: 'available' })).total, 1);
  assert.equal((await directory({ organizationId: a })).total, 2);
  const page = await directory({ sort: 'name', pageSize: 1, page: 2 });
  assert.equal(page.people[0]!.name, 'Bailey');
  assert.equal(page.people[0]!.latestMovement!.type, 'left');
  assert.equal(page.pages, 3);
  assert.equal((await directory({ page: 99 })).page, 1);
  assert.equal((await call('GET', '/talent?pageSize=1000')).statusCode, 422);
  await record(a, 'Cross-context move', {
    tab: 'people_movements',
    type: 'joined',
    date: '2026-09-02',
    structured: { fromOrganization: 'Alpha', toOrganization: 'Beta', dateBasis: 'announcement' },
  });
  const joined = (await directory({ q: 'Cross-context move' })).people[0]!;
  assert.equal(joined.latestMovement!.organizationName, 'Beta');
  assert.equal(joined.organizations[0]!.name, 'Alpha');
  assert.equal(joined.latestMovement!.structured.dateBasis, 'announcement');
});

test('talent latest movement resolves one event before sorting sources, and shows the full transfer', async (t) => {
  const { pool, a, b, record, object, directory } = await setup(t);
  const fields = {
    fromOrganization: 'Alpha',
    toOrganization: 'Beta',
    fromRole: 'Business officer',
    toRole: 'Managing Director',
    movementGroupId: 'reviewed-july-transfer',
  };
  const departure = await record(a, 'Career Fixture', {
    tab: 'people_movements',
    type: 'left',
    date: '2024-07',
    structured: { ...fields, dateBasis: 'effective' },
  });
  const person = await object(a, departure, 'Career Fixture');
  const attach = (recordId: string) =>
    pool.query('INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1,$2)', [
      person,
      recordId,
    ]);
  await attach(
    await record(b, 'Career Fixture', {
      tab: 'people_movements',
      type: 'joined',
      date: '2024-07',
      structured: { ...fields, dateBasis: 'effective' },
    }),
  );
  await attach(
    await record(a, 'Career Fixture', {
      tab: 'people_movements',
      type: 'joined',
      date: '2024-10-28',
      structured: { ...fields, dateBasis: 'announcement' },
    }),
  );
  const read = async () => (await directory({ q: 'Career Fixture' })).people[0]!;
  let latest = await read();
  assert.equal(latest.latestMovement!.date, '2024-07');
  assert.equal(latest.latestMovement!.type, 'transferred');
  assert.equal(latest.latestMovement!.organizationName, 'Beta');
  assert.equal(latest.latestMovement!.title, 'Alpha → Beta');
  assert.equal(latest.latestMovement!.structured.toRole, 'Managing Director');
  assert.equal(
    latest.recordCount,
    3,
    'Source records are retained, not deleted by event selection',
  );
  const laterRole = await record(b, 'Career Fixture', {
    tab: 'people_movements',
    type: 'role_change',
    date: '2024-08',
    structured: {
      fromOrganization: 'Beta',
      toOrganization: 'Beta',
      fromRole: 'Managing Director',
      toRole: 'Partner',
      dateBasis: 'effective',
    },
  });
  await attach(laterRole);
  latest = await read();
  assert.equal(
    latest.latestMovement!.date,
    '2024-08',
    'A late announcement must not displace a later effective event',
  );
  assert.equal(
    (await directory({ q: 'Career Fixture' }, 'reader')).people[0]!.latestMovement!.id,
    laterRole,
  );
});

test('WeChat is retained in a person dossier without creating a false profile URL', async (t) => {
  const { a, call } = await setup(t);
  const data = validateKnowledge('contacts', {
    ...defaultsFor('contacts'),
    channel: 'wechat',
    value: 'Example_99',
    role: 'Institutional sales',
    owner: 'Test team',
    reviewedOn: '2026-09-21',
    verification: 'User supplied account; not contacted.',
  });
  assert.equal(contactHref(data), '');
  const response = await call('POST', `/organizations/${a}/tabs/contacts/records`, {
    title: 'Business contact',
    body: 'Synthetic contact evidence',
    scope: 'Test',
    status: 'unverified',
    visibility: 'team',
    personName: 'Example Contact',
    eventType: '',
    eventDate: '',
    rawText: 'Synthetic source supplied this WeChat ID',
    sourceUrl: '',
    structured: data,
  });
  assert.equal(response.statusCode, 201, response.body);
  const list = (await call('GET', '/talent?q=Example%20Contact')).json() as TalentDirectory;
  const person = (
    await call('GET', '/talent/' + encodeURIComponent(list.people[0]!.id))
  ).json() as TalentDetail;
  assert.equal(person.contacts.length, 1);
  assert.equal(person.contacts[0]!.channel, 'wechat');
  assert.equal(person.contacts[0]!.value, 'Example_99');
  assert.equal(person.contacts[0]!.href, '');
});
