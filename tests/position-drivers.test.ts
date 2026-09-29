import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { driverReviewState, positionDriverDataSchema } from '../src/shared/position-drivers';
import type { PositionDriver } from '../src/shared/position-drivers';
import { harness, tokenOf } from './helpers';
// 岗位目标与激励(frontend-spec 6.16)。v1 tests/position-drivers.test.ts 逐条保留;
// v1 最后「岗位事后放宽可见性」的断言改为检查可见性不可改:v2 的记录与情报可见性建立后都由触发器锁定。

const data = {
  kind: 'okr',
  title: 'BD quarterly target',
  summary: 'Role policy reported by contact',
  applicability: 'role_policy',
  pressure: 'target_reported',
  period: 'Q3 · year unknown',
  observedOn: '2026-09-20',
  validUntil: '',
  state: 'active',
  basis: 'contact_report',
  attribution: 'Contact via team',
  uncertainty: 'Currency and personal eligibility unknown',
  targets: [
    {
      audience: 'Tenure > 3 months',
      metric: 'Daily average volume',
      comparison: 'increase_by',
      value: 50000000,
      unit: '',
      baseline: 'Own Q2 average',
    },
  ],
};
test('targets preserve deltas, missing units and uncertain applicability', () => {
  const result = positionDriverDataSchema.parse(data);
  assert.equal(result.targets[0]!.comparison, 'increase_by');
  assert.equal(result.targets[0]!.unit, '');
  assert.equal(result.applicability, 'role_policy');
  assert.equal(
    positionDriverDataSchema.safeParse({ ...data, pressure: 'none_reported' }).success,
    false,
  );
  assert.equal(
    positionDriverDataSchema.safeParse({ ...data, observedOn: '2026-02-30' }).success,
    false,
  );
  assert.equal(
    positionDriverDataSchema.safeParse({ ...data, validUntil: '2026-01-01' }).success,
    false,
  );
  assert.equal(
    driverReviewState({ ...result, validUntil: '2026-10-01' }, '2026-10-02'),
    'Review due',
  );
  assert.equal(driverReviewState({ ...result, state: 'retired' }, '2026-09-20'), 'Retired');
});

test('role insights enforce position binding, permissions, evidence and revision history', async (t) => {
  const h = await harness();
  t.after(h.close);
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'admin@example.test' })).token,
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
  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    payload?: unknown,
    role = 'editor',
  ) => h.request(method, '/api' + path, { cookie: sessions[role]! }, payload);
  const org = (
    await request('POST', '/organizations', { name: 'First company', tags: ['company'] })
  ).json().id as string;
  const other = (
    await request('POST', '/organizations', { name: 'Second company', tags: ['company'] })
  ).json().id as string;
  async function pos(o: string, visibility = 'team', tab = 'org_chart') {
    const r = await request(
      'POST',
      `/organizations/${o}/tabs/${tab}/records`,
      {
        title: 'Sales',
        body: 'Source evidence',
        scope: 'Test',
        status: 'unverified',
        visibility,
        personName: 'Same person',
        rawText: 'Original role evidence',
        sourceUrl: '',
        eventDate: '',
        eventType: '',
      },
      'admin',
    );
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  }
  const p = await pos(org);
  const p2 = await pos(other);
  const secret = await pos(org, 'admin');
  const path = (o: string, id: string) => `/organizations/${o}/positions/${id}/drivers`;
  const input = {
    data,
    rawText: '  Original quotation\nexact spaces preserved  ',
    attachment: {
      filename: 'okr.png',
      base64: Buffer.from('test attachment bytes').toString('base64'),
    },
  };
  assert.equal((await request('POST', path(org, p), input, 'reader')).statusCode, 403);
  assert.equal((await request('POST', path(other, p), input)).statusCode, 404);
  assert.equal(
    (
      await request('POST', path(org, p), {
        ...input,
        data: { ...data, pressure: 'none_reported' },
      })
    ).statusCode,
    422,
  );
  const added = await request('POST', path(org, p), input);
  assert.equal(added.statusCode, 201, added.body);
  const id = added.json().id as string;
  const rows = (await request('GET', path(org, p), undefined, 'reader')).json() as PositionDriver[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.positionId, p);
  assert.equal(
    (await request('GET', path(other, p2))).json().length,
    0,
    'does not follow the same name to a new employer',
  );
  const evidence = (await request('GET', '/evidence/' + rows[0]!.evidenceId)).json();
  assert.equal(evidence.text, input.rawText);
  const attachment = await request('GET', `/evidence/${rows[0]!.attachmentEvidenceId}/download`);
  assert.equal(attachment.statusCode, 200, attachment.body);
  assert.equal(attachment.body, 'test attachment bytes');
  assert.equal(
    (await request('PATCH', path(org, p) + '/' + id, { ...input, revision: 10 })).statusCode,
    409,
  );
  const changed = await request('PATCH', path(org, p) + '/' + id, {
    ...input,
    attachment: undefined,
    data: { ...data, state: 'retired' },
    revision: 1,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const saved = ((await request('GET', path(org, p))).json() as PositionDriver[])[0]!;
  assert.equal(saved.revision, 2);
  assert.equal(saved.state, 'retired');
  assert.equal(saved.attachmentEvidenceId, rows[0]!.attachmentEvidenceId, 'attachment is kept');
  assert.equal(
    (await request('GET', '/evidence/' + rows[0]!.evidenceId)).json().text,
    input.rawText,
    'earlier evidence survives edits',
  );
  const history = await h.ctx.pool.query(
    'SELECT count(*)::int AS n FROM omniboard.edit_history WHERE subject_id = $1',
    [id],
  );
  assert.equal(history.rows[0].n, 2);
  const privateAdded = await request('POST', path(org, secret), input, 'admin');
  assert.equal(privateAdded.statusCode, 201, privateAdded.body);
  assert.equal((await request('GET', path(org, secret))).statusCode, 404);
  assert.equal(
    (
      await request('PATCH', path(org, secret) + '/' + privateAdded.json().id, {
        ...input,
        revision: 1,
      })
    ).statusCode,
    404,
  );
  const stored = await h.ctx.pool.query<{ visibility: string }>(
    'SELECT visibility FROM omniboard.position_drivers WHERE id = $1',
    [privateAdded.json().id],
  );
  assert.equal(stored.rows[0]!.visibility, 'admin');
  await assert.rejects(
    h.ctx.pool.query("UPDATE omniboard.position_drivers SET visibility = 'team' WHERE id = $1", [
      privateAdded.json().id,
    ]),
    /Visibility cannot change/,
  );
});
