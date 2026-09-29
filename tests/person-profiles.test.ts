import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { ensurePersonDossier } from '../src/server/person-dossier';
import { personProfileSchema, personSourceKey } from '../src/shared/person-profile';
import type { TalentDetail, TalentDirectory } from '../src/shared/talent';
import type { KnowledgeObject } from '../src/shared/operations';
import { harness, original, tokenOf } from './helpers';
// 个人履历与由履历生成的人员变动(frontend-spec 6.12–6.15)。v1 tests/person-profiles.test.ts 逐条保留;
// v1 直接调用服务端函数的地方改为经 API 调用,抛错改为断言状态码。

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const h = await harness();
  t.after(h.close);
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@profiles.test' })).token,
  );
  const sessions: Record<string, string> = { admin: owner.cookie };
  for (const role of ['editor', 'reader']) {
    h.tick();
    const invited = await h.request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name: role, email: `${role}@profiles.test`, role },
    );
    sessions[role] = (await h.activate(tokenOf(invited.json().inviteLink))).cookie;
  }
  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, payload?: object, role = 'admin') =>
    h.request(method, '/api' + path, { cookie: sessions[role] }, payload);
  const pool = h.ctx.pool;
  const ownerId = (
    await pool.query<{ id: string }>('SELECT id FROM omniboard.member WHERE email = $1', [
      'owner@profiles.test',
    ])
  ).rows[0]!.id;
  const org = async (name: string) =>
    (await call('POST', '/organizations', { name, tags: ['company'] })).json().id as string;
  const a = await org('Alpha');
  const b = await org('Beta');
  const input = personProfileSchema.parse({
    url: 'https://www.linkedin.com/in/profile-fixture/',
    name: 'Alex Fixture',
    observedOn: '2026-09-01',
    rawText: 'Original profile: Alpha 2018–2023, Beta 2023–Present',
    positions: [
      {
        key: 'alpha',
        organizationId: a,
        organizationName: 'Alpha',
        role: 'Researcher',
        start: '2018',
        end: '2023',
        tenure: 'former',
        changeType: 'joined',
        endedEmployment: true,
      },
      {
        key: 'beta',
        organizationId: b,
        organizationName: 'Beta',
        role: 'Research lead',
        start: '2023',
        tenure: 'current',
        changeType: 'joined',
      },
    ],
  });
  type Result = { id: string; identityId: string; revision: number; unchanged: boolean };
  /** 导入并断言成功;v1 的 importPersonProfile。 */
  async function save(payload: object, role = 'admin'): Promise<Result> {
    const response = await call('POST', '/talent/source-profiles', payload, role);
    assert.equal(response.statusCode, 201, response.body);
    return response.json() as Result;
  }
  const status = async (payload: object, role = 'admin') =>
    (await call('POST', '/talent/source-profiles', payload, role)).statusCode;
  const person = async (identityId: string, role = 'admin') => {
    const response = await call('GET', '/talent/identity:' + identityId, undefined, role);
    assert.equal(response.statusCode, 200, response.body);
    return response.json() as TalentDetail;
  };
  const directory = async (query = '') =>
    (await call('GET', '/talent' + query)).json() as TalentDirectory;
  const count = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  let serial = 0;
  /** 旧记录:来源 URL 是个人主页或新闻页,带自动人员档案。 */
  async function record(name: string, url: string) {
    const key = `legacy-${++serial}`;
    await pool.query(
      `INSERT INTO omniboard.evidence
         (id, source, url, sha256, byte_length, content_type, parser_version, filename, visibility)
       VALUES ($1,'public_profile',$2,$3,0,'text/plain','manual-v1','reference.txt','team')`,
      ['evidence-' + key, url, await original(pool)],
    );
    await pool.query(
      `INSERT INTO omniboard.module_records
         (id, organization_id, tab_id, title, body, scope, status, visibility, person_name,
          evidence_id, revision, author_id)
       VALUES ($1,$2,'contacts','Contact','Source profile excerpt','Public profile','unverified',
               'team',$3,$4,1,$5)`,
      [key, a, name, 'evidence-' + key, ownerId],
    );
    const client = await pool.connect();
    try {
      return { recordId: key, identityId: await ensurePersonDossier(client, key) };
    } finally {
      client.release();
    }
  }
  type Row = {
    id: string;
    revision: number;
    organization_id: string;
    event_type: string;
    event_date: string | null;
    structured: Record<string, string>;
    evidence_id: string;
  };
  const movements = async (where = 'TRUE') =>
    (
      await pool.query<Row>(
        `SELECT id, revision, organization_id, event_type, event_date, structured, evidence_id
           FROM omniboard.module_records WHERE tab_id = 'people_movements' AND ${where}
          ORDER BY id`,
      )
    ).rows;
  return {
    h,
    pool,
    call,
    a,
    b,
    input,
    save,
    status,
    person,
    directory,
    count,
    record,
    movements,
  };
}

test('source identity normalizes personal LinkedIn URLs, never company/news URLs or lookalike hosts', () => {
  assert.deepEqual(
    personSourceKey('https://uk.linkedin.com/in/Profile-Fixture/details/experience/?trk=x'),
    personSourceKey('https://www.linkedin.com/in/profile-fixture/'),
  );
  assert.throws(() => personSourceKey('https://linkedin.com/company/test'));
  assert.throws(() => personSourceKey('https://linkedin.com/posts/test'));
  assert.throws(() => personSourceKey('https://user:secret@linkedin.com/in/test'));
  assert.notEqual(
    personSourceKey('https://linkedin.com.example.test/in/test').provider,
    'linkedin',
  );
});

test('one source produces one dossier, preserves partial dates, and re-import is idempotent', async (t) => {
  const { a, b, call, input, save, person, directory, count, movements } = await fixture(t);
  const first = await save(input);
  assert.equal(first.unchanged, false);
  const second = await save({
    ...input,
    url: 'https://uk.linkedin.com/in/profile-fixture/?trk=foo',
  });
  assert.equal(second.identityId, first.identityId);
  assert.equal(second.unchanged, true);
  const reordered = await save({ ...input, positions: [...input.positions].reverse() });
  assert.equal(reordered.unchanged, true);
  assert.equal(await count('SELECT count(*) n FROM omniboard.person_profile_captures'), 1);
  assert.equal(await count('SELECT count(*) n FROM omniboard.module_records'), 3);
  assert.equal((await directory()).total, 1);
  const detail = await person(first.identityId);
  assert.equal(detail.careers.length, 2);
  assert.deepEqual(detail.organizations.map((o) => o.id).sort(), [a, b].sort());
  assert.equal(detail.careers[1]!.start, '2018');
  assert.equal(detail.currentRoles[0], 'Research lead · Beta');
  assert.ok(
    (await movements()).some(
      (r) => r.organization_id === a && r.event_type === 'left' && r.event_date === '2023',
    ),
  );
  // 生成的变动不能在记录编辑器里直接改,要更新来源履历(6.14)。
  const generated = (await movements())[0]!;
  const patch = await call(
    'PATCH',
    `/organizations/${generated.organization_id}/tabs/people_movements/records/${generated.id}`,
    {
      title: 'Edited by hand',
      body: '',
      scope: 'Personal profile',
      status: 'unverified',
      visibility: 'team',
      personName: 'Alex Fixture',
      eventType: generated.event_type,
      eventDate: generated.event_date ?? '',
      rawText: 'Manual correction',
      sourceUrl: '',
      structured: { dateBasis: 'effective' },
      revision: generated.revision,
    },
  );
  assert.equal(patch.statusCode, 422, patch.body);
});

test('updates retain raw captures and stable position IDs; omitted roles never imply departures', async (t) => {
  const { input, save, status, person, count } = await fixture(t);
  const first = await save(input);
  const old = await person(first.identityId);
  const firstId = old.careers.find((p) => p.key === 'beta')!.id;
  const update = {
    ...input,
    revision: 1,
    observedOn: '2026-09-02',
    rawText: 'New source wording',
    positions: [{ ...input.positions[1]!, role: 'Head of research' }],
  };
  const second = await save(update);
  assert.equal(second.revision, 2);
  const data = await person(first.identityId);
  assert.equal(data.sources[0]!.captures.length, 2);
  assert.equal(data.careers.length, 2);
  assert.equal(data.careers.find((p) => p.key === 'beta')!.id, firstId);
  assert.equal(await count('SELECT count(*) n FROM omniboard.module_records'), 3);
  assert.equal(await status({ ...update, rawText: 'Stale change' }), 409);
  assert.equal(
    await status({
      ...update,
      revision: 2,
      observedOn: '2025-01-01',
      rawText: 'Older observation',
    }),
    409,
  );
  assert.equal(await status({ ...update, revision: 2, observedOn: '2026-09-30' }), 422);
  assert.equal(data.sources[0]!.captures[1]!.evidenceId, old.sources[0]!.captures[0]!.evidenceId);
});

test('matching names require review; explicit same-profile evidence merges reversibly', async (t) => {
  const { call, input, save, directory, record } = await fixture(t);
  const first = await record(input.name, input.url);
  const second = await record(input.name, input.url);
  const unrelated = await record(input.name, 'https://news.example.test/article');
  const result = await save(input);
  assert.ok([first.identityId, second.identityId].includes(result.identityId));
  assert.equal((await directory()).total, 2);
  assert.equal((await directory('?duplicates=review')).total, 2);
  const history = (await call('GET', '/knowledge/identities/' + result.identityId)).json() as {
    object: KnowledgeObject;
    history: { id: string; kind: string }[];
  };
  assert.equal(history.history.filter((e) => e.kind === 'merge').length, 1);
  const decision = await call('POST', `/talent/people/${result.identityId}/duplicate-decision`, {
    otherId: unrelated.identityId,
    decision: 'later',
    reason: 'Need further evidence',
  });
  assert.equal(decision.statusCode, 200, decision.body);
  assert.equal((await directory('?duplicates=review')).total, 0);
  const detail = (
    await call('GET', '/talent/identity:' + result.identityId)
  ).json() as TalentDetail;
  assert.equal(detail.duplicates.length, 1);
  assert.equal(detail.duplicates[0]!.deferred, true);
  assert.equal(
    (
      await call(
        'POST',
        `/talent/people/${result.identityId}/duplicate-decision`,
        { otherId: result.identityId, decision: 'different', reason: 'Same dossier' },
        'editor',
      )
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await call(
        'POST',
        `/talent/people/${result.identityId}/duplicate-decision`,
        { otherId: unrelated.identityId, decision: 'different', reason: 'Checked' },
        'reader',
      )
    ).statusCode,
    403,
  );
  const merge = history.history.find((e) => e.kind === 'merge')!;
  const undo = await call('POST', `/knowledge/identities/${result.identityId}/undo`, {
    eventId: merge.id,
    revision: history.object.revision,
    reason: 'Test reversible merge',
  });
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal((await directory()).total, 3);
  // 「不是同一人」之后这一对不再出现。
  await call('POST', `/talent/people/${result.identityId}/duplicate-decision`, {
    otherId: unrelated.identityId,
    decision: 'different',
    reason: 'Checked the roles; different people.',
  });
  const after = (await call('GET', '/talent/identity:' + result.identityId)).json() as TalentDetail;
  assert.ok(!after.duplicates.some((d) => d.id === unrelated.identityId));
});

test('source-only careers appear across organizations in relationship exploration', async (t) => {
  const { call, a, b, input, save } = await fixture(t);
  const data = {
    ...input,
    positions: input.positions.map((p) => ({
      ...p,
      changeType: 'unknown',
      endedEmployment: false,
    })),
  };
  const person = await save(data);
  const objects = async (orgId: string, role = 'reader') =>
    (await call('GET', `/organizations/${orgId}/objects`, undefined, role)).json()
      .objects as KnowledgeObject[];
  const object = (await objects(b)).find((p) => p.id === person.identityId)!;
  assert.equal(object.records.length, 0);
  assert.deepEqual(object.organizations!.map((o) => o.id).sort(), [a, b].sort());
  const hidden = await save({
    ...data,
    url: 'https://www.linkedin.com/in/private-career/',
    visibility: 'admin',
  });
  assert.equal(
    (await objects(b)).some((p) => p.id === hidden.identityId),
    false,
  );
  assert.equal(
    (await objects(b, 'admin')).some((p) => p.id === hidden.identityId),
    true,
  );
});

test('profile access, capture history and imports preserve authorization boundaries', async (t) => {
  const { call, input, save, status, directory, count } = await fixture(t);
  const secret = await save({ ...input, visibility: 'admin' });
  const readerList = (await call('GET', '/talent', undefined, 'reader')).json() as TalentDirectory;
  assert.equal(readerList.total, 0);
  assert.equal(
    (await call('GET', '/talent/source-profiles/' + secret.id, undefined, 'reader')).statusCode,
    404,
  );
  const own = await call('GET', '/talent/source-profiles/' + secret.id);
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.json().positions.length, 2);
  assert.equal(await status(input, 'reader'), 403);
  assert.equal(await status(input, 'editor'), 409);
  assert.equal(await status({ ...input, visibility: 'admin' }, 'editor'), 403);
  assert.equal(await count('SELECT count(*) n FROM omniboard.person_source_profiles'), 1);
  assert.equal((await directory()).total, 1);
});

test('incomplete and concurrent roles remain factual; same-company transfer has no inferred exit', async (t) => {
  const { a, input, save, status, person, movements } = await fixture(t);
  const value = {
    ...input,
    positions: [
      { ...input.positions[0]!, key: 'old-role', end: '2023-06', endedEmployment: false },
      {
        ...input.positions[1]!,
        organizationId: a,
        organizationName: 'Alpha',
        start: '2023-06',
        changeType: 'role_change' as const,
      },
      {
        ...input.positions[1]!,
        key: 'concurrent',
        role: 'Advisor',
        start: '',
        end: '',
        changeType: 'unknown' as const,
      },
    ],
  };
  const result = await save(value);
  const [movement] = await movements("event_type = 'role_change'");
  assert.equal(movement!.structured.fromRole, 'Researcher');
  assert.equal(movement!.structured.toRole, 'Research lead');
  const p = await person(result.identityId);
  assert.equal(p.careers.filter((r) => r.tenure === 'current').length, 2);
  assert.equal(p.careers.find((r) => r.key === 'concurrent')!.start, '');
  assert.equal((await movements("event_type = 'left'")).length, 0);
  assert.equal((await movements("event_type = 'role_change'")).length, 1);
  assert.equal(
    await status({ ...input, positions: [{ ...input.positions[1]!, end: '2025' }] }),
    422,
  );
  assert.equal(
    await status({ ...input, positions: [{ ...input.positions[0]!, start: '2025-02-30' }] }),
    422,
  );
});

test('internal transitions resolve across input order and partial updates, retaining both source references', async (t) => {
  const { pool, a, input, save, count, movements } = await fixture(t);
  const prior = { ...input.positions[0]!, end: '2023-06', endedEmployment: false };
  const next = {
    ...input.positions[1]!,
    organizationId: a,
    organizationName: 'Alpha',
    start: '2023-06',
    changeType: 'role_change' as const,
  };
  const data = { ...input, positions: [next, prior] };
  const result = await save(data);
  const read = async () => (await movements("event_type = 'role_change'"))[0]!;
  const initial = await read();
  assert.equal(initial.structured.fromRole, prior.role);
  const captures = () => count('SELECT count(*) n FROM omniboard.person_profile_captures');
  const history = () => count('SELECT count(*) n FROM omniboard.edit_history');
  const initialHistory = await history();
  await save({ ...data, positions: [prior, next] });
  assert.deepEqual(await read(), initial);
  assert.equal(await history(), initialHistory);
  assert.equal(await captures(), 1);

  // 模拟旧导入器生成的事件,再导入相同的证据:原地修复,不新增采集。
  await pool.query(
    `UPDATE omniboard.module_records
        SET structured = structured - 'fromRole' - 'fromOrganization' - 'previousCareerPositionId'
                         - 'previousRoleEvidenceId'
      WHERE id = $1`,
    [initial.id],
  );
  const repaired = await save(data);
  assert.equal(repaired.unchanged, true);
  assert.equal((await read()).id, initial.id);
  assert.equal((await read()).revision, initial.revision + 1);
  assert.equal(await captures(), 1);
  assert.equal(await history(), initialHistory + 1);
  assert.equal((await read()).structured.fromRole, prior.role);

  // 这次更新没有新职位;它的「之前职位」仍要刷新。
  await save({
    ...data,
    revision: result.revision,
    rawText: 'Corrected prior role: Executive Director',
    positions: [{ ...prior, role: 'Executive Director' }],
  });
  const refreshed = await read();
  const fields = refreshed.structured;
  assert.equal(refreshed.id, initial.id);
  assert.equal(fields.fromRole, 'Executive Director');
  assert.equal(fields.toRole, next.role);
  assert.equal(refreshed.evidence_id, initial.evidence_id);
  assert.notEqual(fields.previousRoleEvidenceId, refreshed.evidence_id);
  const savedPrior = (
    await pool.query<{ id: string; evidence_id: string }>(
      'SELECT id, evidence_id FROM omniboard.person_profile_positions WHERE source_key = $1',
      [prior.key],
    )
  ).rows[0]!;
  assert.equal(fields.previousCareerPositionId, savedPrior.id);
  assert.equal(fields.previousRoleEvidenceId, savedPrior.evidence_id);
});

test('ambiguous, departed, foreign-organization and imprecisely dated roles are never guessed as a predecessor', async (t) => {
  const { a, b, input, save, movements } = await fixture(t);
  const prior = { ...input.positions[0]!, end: '2023-06', endedEmployment: false };
  const next = {
    ...input.positions[1]!,
    organizationId: a,
    organizationName: 'Alpha',
    start: '2023-06',
    changeType: 'role_change' as const,
  };
  const data = { ...input, positions: [prior, next] };
  let result = await save(data);
  const fields = async () => (await movements("event_type = 'role_change'"))[0]!.structured;
  assert.equal((await fields()).fromRole, prior.role);
  result = await save({
    ...data,
    revision: result.revision,
    positions: [{ ...prior, key: 'parallel', role: 'Advisor' }],
  });
  assert.equal((await fields()).fromRole, undefined);
  assert.equal((await fields()).previousRoleEvidenceId, undefined);
  // 另一个并行职位离职后,唯一的内部前任恢复衔接。
  result = await save({
    ...data,
    revision: result.revision,
    positions: [{ ...prior, key: 'parallel', role: 'Advisor', endedEmployment: true }],
  });
  assert.equal((await fields()).fromRole, prior.role);
  for (const change of [
    { endedEmployment: true },
    { organizationId: b, organizationName: 'Beta' },
    { end: '2023' },
    { end: '' },
  ]) {
    result = await save({
      ...data,
      revision: result.revision,
      positions: [{ ...prior, ...change }],
    });
    assert.equal((await fields()).fromRole, undefined);
    assert.equal((await fields()).toRole, next.role);
  }
});

test('complete source careers link a mutually unique departure and arrival with preserved date precision', async (t) => {
  const { input, save, movements } = await fixture(t);
  const result = await save(input);
  const left = (await movements("event_type = 'left'"))[0]!;
  const joined = (await movements("event_type = 'joined' AND event_date = '2023'"))[0]!;
  const from = left.structured;
  const to = joined.structured;
  assert.equal(from.toOrganization, 'Beta');
  assert.equal(from.toRole, 'Research lead');
  assert.equal(to.fromOrganization, 'Alpha');
  assert.equal(to.fromRole, 'Researcher');
  assert.equal(from.movementGroupId, to.movementGroupId);
  assert.equal(from.dateBasis, 'effective');
  assert.equal(from.eventDatePrecision, 'year');
  assert.equal(from.transitionBasis, 'adjacent_profile_roles');
  // 并行的新职位让双方的去向 / 来处都不唯一。
  await save({
    ...input,
    revision: result.revision,
    positions: [{ ...input.positions[1]!, key: 'parallel', role: 'Advisor' }],
  });
  const refreshed = await movements();
  assert.equal(refreshed.find((r) => r.id === left.id)!.structured.toRole, undefined);
  assert.equal(refreshed.find((r) => r.id === joined.id)!.structured.fromRole, undefined);
});

test('explicit career links span employment gaps and project one transition into both organizations', async (t) => {
  const { call, a, b, input, save, person, movements } = await fixture(t);
  const prior = {
    ...input.positions[0]!,
    start: '2025-01',
    end: '2026-01',
    changeType: 'unknown' as const,
  };
  const next = { ...input.positions[1]!, start: '2026-02' };
  let result = await save({ ...input, positions: [prior, next] });
  assert.equal((await movements()).length, 2);
  assert.equal((await movements("event_type = 'left'"))[0]!.structured.toRole, undefined);
  const linked = { ...next, previousPositionKey: prior.key };
  const data = { ...input, revision: result.revision, positions: [linked, prior] };
  result = await save(data);
  const beforeReplay = await movements();
  assert.equal((await save(data)).unchanged, true);
  assert.deepEqual(await movements(), beforeReplay);
  const left = beforeReplay.find((r) => r.organization_id === a)!;
  const arrived = beforeReplay.find((r) => r.organization_id === b)!;
  assert.equal(left.event_type, 'left');
  assert.equal(left.event_date, '2026-01');
  assert.equal(arrived.event_type, 'joined');
  assert.equal(arrived.event_date, '2026-02');
  assert.equal(left.structured.movementGroupId, arrived.structured.movementGroupId);
  for (const fields of [left.structured, arrived.structured]) {
    assert.equal(fields.fromRole, prior.role);
    assert.equal(fields.toRole, next.role);
    assert.equal(fields.previousRoleEnd, '2026-01');
    assert.equal(fields.nextRoleStart, '2026-02');
    assert.equal(fields.transitionBasis, 'explicit_profile_transition');
  }
  for (const org of [a, b]) {
    const response = await call('GET', `/organizations/${org}/tabs/people_movements`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().records.length, 1);
  }
  const detail = await person(result.identityId);
  assert.equal(detail.latestMovement?.date, '2026-02');
  assert.deepEqual(detail.organizations.map((o) => o.id).sort(), [a, b].sort());
  // 局部更新改正前一职位的名称;稳定的事件在两个机构视图里一起刷新。
  await save({
    ...input,
    revision: result.revision,
    positions: [{ ...prior, role: 'Executive Director' }],
    rawText: 'Corrected title from the same source',
  });
  const after = await movements();
  assert.deepEqual(
    after.map((row) => row.id),
    beforeReplay.map((row) => row.id),
  );
  assert.ok(after.every((row) => row.structured.fromRole === 'Executive Director'));
});

test('explicit career links reject missing, conflicting and cyclic predecessors atomically', async (t) => {
  const { pool, input, save, status } = await fixture(t);
  const result = await save(input);
  const positions = async () =>
    (await pool.query('SELECT * FROM omniboard.person_profile_positions ORDER BY id')).rows;
  const before = await positions();
  for (const previousPositionKey of ['missing-position', input.positions[1]!.key]) {
    assert.equal(
      await status({
        ...input,
        revision: result.revision,
        positions: [{ ...input.positions[1]!, previousPositionKey }],
      }),
      422,
    );
    assert.deepEqual(await positions(), before);
  }
  assert.equal(
    await status({
      ...input,
      revision: result.revision,
      positions: [
        {
          ...input.positions[1]!,
          changeType: 'unknown',
          previousPositionKey: input.positions[0]!.key,
        },
      ],
    }),
    422,
  );
  assert.equal(
    await status({
      ...input,
      revision: result.revision,
      positions: [
        { ...input.positions[1]!, previousPositionKey: input.positions[0]!.key },
        { ...input.positions[1]!, key: 'parallel', previousPositionKey: input.positions[0]!.key },
      ],
    }),
    422,
  );
  assert.equal(
    await status({
      ...input,
      revision: result.revision,
      positions: [
        { ...input.positions[0]!, previousPositionKey: input.positions[1]!.key },
        {
          ...input.positions[1]!,
          tenure: 'former',
          end: '2025',
          endedEmployment: true,
          previousPositionKey: input.positions[0]!.key,
        },
      ],
    }),
    422,
  );
  assert.deepEqual(await positions(), before);
});

test('import: profiles, generated movements, duplicate decisions and position insights keep v1 ids', async (t) => {
  const { h, pool, call, a, input, save, person, movements } = await fixture(t);
  const bearer = (
    await call('POST', '/tokens', { name: 'importer', role: 'admin', expiresInDays: 7 })
  ).json().token as string;
  const post = (path: string, body: object) => h.request('POST', '/api' + path, { bearer }, body);
  const ownerId = (
    await pool.query<{ id: string }>('SELECT id FROM omniboard.member WHERE email = $1', [
      'owner@profiles.test',
    ])
  ).rows[0]!.id;
  const chart = await call('POST', `/organizations/${a}/tabs/org_chart/records`, {
    title: 'Researcher',
    body: 'Team page',
    scope: 'Fixture',
    status: 'unverified',
    visibility: 'team',
    personName: 'Alex Fixture',
    rawText: 'Alex Fixture, Researcher',
  });
  assert.equal(chart.statusCode, 201, chart.body);
  const positionId = chart.json().id as string;
  const objectId = `person-record:${positionId}`;
  const evidenceId = (
    await pool.query<{ evidence_id: string }>(
      'SELECT evidence_id FROM omniboard.module_records WHERE id = $1',
      [positionId],
    )
  ).rows[0]!.evidence_id;
  const movement = {
    id: 'v1-movement',
    title: 'Alex Fixture · Joined · Researcher',
    body: 'Alpha · Researcher',
    scope: 'Personal profile',
    status: 'unverified',
    visibility: 'team',
    personName: 'Alex Fixture',
    eventType: 'joined',
    eventDate: '2018',
    evidenceId,
    structured: {
      role: 'Researcher',
      dateBasis: 'effective',
      toOrganization: 'Alpha',
      toRole: 'Researcher',
      personProfileId: 'v1-profile',
      careerPositionId: 'v1-position',
    },
  };
  const tab = `/organizations/${a}/tabs/people_movements/records`;
  // 手工记录不接受履历生成的键;迁移导入可以带上。
  const { evidenceId: _evidence, id: _id, ...manual } = movement;
  assert.equal((await call('POST', tab, { ...manual, rawText: 'Manual text' })).statusCode, 422);
  const imported = await post(tab, movement);
  assert.equal(imported.statusCode, 201, imported.body);
  const alpha = { ...input.positions[0]!, end: '', tenure: 'unknown', endedEmployment: false };
  const profile = {
    id: 'v1-profile',
    objectId,
    url: 'https://uk.linkedin.com/in/profile-fixture/?trk=legacy',
    visibility: 'team',
    revision: 2,
    updatedAt: '2026-08-02T00:00:00Z',
    captures: [
      {
        id: 'v1-capture',
        evidenceId,
        payload: { ...input, positions: [alpha] },
        fingerprint: 'v1-fingerprint',
        observedOn: '2026-08-01',
        authorId: ownerId,
        createdAt: '2026-08-02T00:00:00Z',
      },
    ],
    positions: [
      {
        id: 'v1-position',
        data: alpha,
        evidenceId,
        updatedAt: '2026-08-02T00:00:00Z',
        startRecordId: 'v1-movement',
      },
    ],
  };
  assert.equal((await call('POST', '/import/person-profiles', profile)).statusCode, 403);
  assert.equal(
    (
      await post('/import/person-profiles', {
        ...profile,
        positions: [{ ...profile.positions[0]!, startRecordId: positionId }],
      })
    ).statusCode,
    422,
  );
  const saved = await post('/import/person-profiles', profile);
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal((await post('/import/person-profiles', profile)).statusCode, 409);
  const detail = await person(objectId);
  assert.equal(detail.sources[0]!.url, 'https://www.linkedin.com/in/profile-fixture/');
  assert.equal(detail.sources[0]!.captures[0]!.evidenceId, evidenceId);
  assert.equal(detail.careers[0]!.id, 'v1-position');
  // 之后照常更新同一来源:导入的事件原地重新生成,不另建记录。
  const updated = await save({
    ...input,
    revision: 2,
    identityId: objectId,
    positions: [{ ...alpha, tenure: 'former', end: '2023', endedEmployment: true }],
  });
  assert.equal(updated.identityId, objectId);
  const start = (await movements("structured->>'careerPositionId' = 'v1-position'")).filter(
    (r) => r.event_type === 'joined',
  );
  assert.deepEqual(
    start.map((r) => r.id),
    ['v1-movement'],
  );
  assert.equal(start[0]!.revision, 2);

  const driver = {
    id: 'v1-driver',
    positionId,
    data: {
      kind: 'kpi',
      title: 'Desk volume',
      summary: 'Reported by the desk',
      applicability: 'unknown',
      pressure: 'unknown',
      period: '',
      observedOn: '2026-08-01',
      validUntil: '',
      state: 'active',
      basis: 'team_report',
      attribution: 'Team',
      uncertainty: '',
      targets: [],
    },
    visibility: 'team',
    evidenceId,
    revision: 3,
    authorId: ownerId,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  };
  assert.equal((await post('/import/position-drivers', driver)).statusCode, 201);
  assert.equal((await post('/import/position-drivers', driver)).statusCode, 409);
  const drivers = (await call('GET', `/organizations/${a}/positions/${positionId}/drivers`)).json();
  assert.equal(drivers[0].revision, 3);
  assert.equal(drivers[0].updatedAt, '2026-08-03T00:00:00.000Z');

  const other = await call('POST', `/organizations/${a}/tabs/org_chart/records`, {
    title: 'Advisor',
    body: 'Team page',
    scope: 'Fixture',
    status: 'unverified',
    visibility: 'team',
    personName: 'Alex Fixture',
    rawText: 'Alex Fixture, Advisor',
  });
  const pair = [objectId, `person-record:${other.json().id}`].sort();
  const decision = {
    leftId: pair[1],
    rightId: pair[0],
    decision: 'different',
    reason: 'Reviewed in v1',
    evidenceId,
    authorId: ownerId,
    createdAt: '2026-08-04T00:00:00Z',
  };
  assert.equal((await post('/import/person-duplicate-decisions', decision)).statusCode, 422);
  const ordered = { ...decision, leftId: pair[0], rightId: pair[1] };
  assert.equal((await post('/import/person-duplicate-decisions', ordered)).statusCode, 201);
  assert.equal((await post('/import/person-duplicate-decisions', ordered)).statusCode, 409);
  assert.equal((await person(objectId)).duplicates.length, 0);
});
