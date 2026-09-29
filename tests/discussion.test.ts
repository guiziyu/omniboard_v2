import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { defaultsFor } from '../src/shared/knowledge';
import type { ModuleRecord } from '../src/shared/types';
import { harness, tokenOf } from './helpers';
// 讨论与联系人对话记录(frontend-spec 5.9)。v1 tests/talent.test.ts「discussion and contact history」
// 的断言逐条保留,另加回复层级、可见性继承、编辑与别名记录的断言。

test('discussion and contact history retain original text without leaking restricted links', async (t) => {
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
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, role = 'editor') =>
    request(method, url, { cookie: sessions[role]! }, body);
  const organization = async (name: string) =>
    (await call('POST', '/api/organizations', { name, tags: ['company'] })).json().id as string;
  const a = await organization('Discussion organization');
  const b = await organization('Other organization');
  async function contactRecord(org: string, title: string, visibility = 'team') {
    const response = await call(
      'POST',
      `/api/organizations/${org}/tabs/contacts/records`,
      {
        title,
        body: 'Contact notes',
        scope: 'Test',
        status: 'unverified',
        visibility,
        rawText: 'Contact evidence',
        structured: {
          ...defaultsFor('contacts'),
          owner: 'Test BD',
          reviewedOn: '2026-09-18',
          verification: 'Synthetic.',
          channel: 'email',
          value: 'desk@example.test',
          role: 'Sales',
        },
      },
      visibility === 'admin' ? 'admin' : 'editor',
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const contact = await contactRecord(a, 'Public contact');
  const privateContact = await contactRecord(a, 'Private contact', 'admin');
  const otherContact = await contactRecord(b, 'Other organization contact');
  const comments = `/api/organizations/${a}/tabs/comments`;
  const payload = {
    title: 'Call notes',
    body: 'Discussed a follow-up.',
    rawText: 'Original call notes, unmodified.',
    scope: 'Organization-wide',
    visibility: 'team',
    status: 'unverified',
    eventType: '',
    eventDate: '',
    sourceUrl: '',
    structured: { relatedRecord: contact },
  };
  const list = async (role = 'editor') =>
    (await call('GET', comments, undefined, role)).json().records as ModuleRecord[];

  const saved = await call('POST', `${comments}/records`, payload);
  assert.equal(saved.statusCode, 201, saved.body);
  const root = (await list())[0]!;
  assert.equal(root.structured.relatedRecord, contact);
  const raw = await call('GET', `/api/evidence/${root.evidenceId}`);
  assert.ok(raw.body.includes('Original call notes, unmodified.'), raw.body);
  const reply = await call('POST', `${comments}/records`, {
    ...payload,
    structured: { replyTo: root.id },
  });
  assert.equal(reply.statusCode, 201, reply.body);
  assert.equal(
    (await list()).find((r) => r.structured.replyTo)?.structured.relatedRecord,
    contact,
    'a reply inherits the conversation contact',
  );
  assert.equal(
    (
      await call('POST', `${comments}/records`, {
        ...payload,
        structured: { relatedRecord: contact, occurredOn: '2026-99-01' },
      })
    ).statusCode,
    422,
  );
  for (const relatedRecord of [privateContact, otherContact, 'missing', root.id]) {
    const response = await call('POST', `${comments}/records`, {
      ...payload,
      structured: { relatedRecord },
    });
    assert.equal(response.statusCode, 422, response.body);
  }
  assert.equal((await call('POST', `${comments}/records`, payload, 'reader')).statusCode, 403);

  // 回复只有一层;回复不能改关联的联系人;team 回复不能挂到 admin 讨论下。
  const nested = await call('POST', `${comments}/records`, {
    ...payload,
    structured: { replyTo: reply.json().id },
  });
  assert.equal(nested.statusCode, 422, 'replies are one level deep');
  const contact2 = await contactRecord(a, 'Second contact');
  assert.equal(
    (
      await call('POST', `${comments}/records`, {
        ...payload,
        structured: { replyTo: root.id, relatedRecord: contact2 },
      })
    ).statusCode,
    422,
  );
  const secret = await call(
    'POST',
    `${comments}/records`,
    { ...payload, visibility: 'admin', structured: {} },
    'admin',
  );
  assert.equal(secret.statusCode, 201, secret.body);
  assert.equal(
    (
      await call(
        'POST',
        `${comments}/records`,
        { ...payload, structured: { replyTo: secret.json().id } },
        'admin',
      )
    ).statusCode,
    422,
    'a team reply cannot widen an administrator thread',
  );
  assert.equal(
    (
      await call(
        'POST',
        `${comments}/records`,
        { ...payload, visibility: 'admin', structured: { replyTo: secret.json().id } },
        'admin',
      )
    ).statusCode,
    201,
  );
  assert.equal((await list('reader')).length, 2, 'restricted threads stay hidden');
  assert.equal(
    (
      await call(
        'POST',
        `${comments}/records`,
        { ...payload, structured: { relatedRecord: privateContact }, visibility: 'admin' },
        'admin',
      )
    ).statusCode,
    201,
    'an administrator conversation may link a restricted contact',
  );

  // 编辑:正文本身作为新的原引用保存。
  const edited = await call('PATCH', `${comments}/records/${root.id}`, {
    ...payload,
    title: 'Call notes, corrected',
    body: 'Discussed a follow-up on Tuesday.',
    rawText: 'Discussed a follow-up on Tuesday.',
    revision: 1,
    structured: root.structured,
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const after = (await list()).find((r) => r.id === root.id)!;
  assert.notEqual(after.evidenceId, root.evidenceId);
  assert.equal(
    (await call('GET', `/api/evidence/${after.evidenceId}`)).json().text,
    'Discussed a follow-up on Tuesday.',
  );

  // 已归并为别名的联系人不能再被引用。
  await h.ctx.pool.query(
    'INSERT INTO omniboard.record_aliases (alias_id, record_id) VALUES ($1, $2)',
    [contact2, contact],
  );
  assert.equal(
    (
      await call('POST', `${comments}/records`, {
        ...payload,
        structured: { relatedRecord: contact2 },
      })
    ).statusCode,
    422,
  );
});
