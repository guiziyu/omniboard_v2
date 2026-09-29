import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { cardHeight, cardWidth, descendants, layoutChart } from '../src/shared/org-chart';
import { movementDateLabel, validateMovementDate } from '../src/shared/movement-date';
import {
  groupMovementRecords,
  movementDateLabelKey,
  movementPerspective,
  movementTransition,
  personMovement,
} from '../src/shared/people-movements';
import type { ModuleRecord } from '../src/shared/types';
import { harness, tokenOf } from './helpers';
// 组织架构图与人员变动(frontend-spec 6.1–6.8)。v1 tests/org-chart、movement-date、movement-perspective
// 的断言逐条保留;v1 的备份恢复断言改为检查关系证据行(v2 原件在对象存储,不走本地备份)。

test('chart layout preserves reporting topology, uncertainty and collapse without overlap', () => {
  const node = (
    id: string,
    reportsTo = '',
    relationshipKind: 'confirmed' | 'unconfirmed' = 'unconfirmed',
  ) => ({ id, reportsTo, relationshipKind, personName: id }) as ModuleRecord;
  const records = [
    node('A'),
    node('B', 'A', 'confirmed'),
    node('C', 'A'),
    node('D', 'B'),
    node('E'),
  ];
  assert.deepEqual([...descendants(records, 'B')].sort(), ['B', 'D']);
  const graph = layoutChart(records, new Set());
  assert.equal(graph.nodes.length, 5);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.edges.find((e) => e.id === 'B')?.kind, 'confirmed');
  assert.equal(graph.edges.find((e) => e.id === 'C')?.kind, 'unconfirmed');
  for (const a of graph.nodes)
    for (const b of graph.nodes)
      if (a.record.id !== b.record.id) {
        assert.ok(
          a.x + cardWidth <= b.x ||
            b.x + cardWidth <= a.x ||
            a.y + cardHeight <= b.y ||
            b.y + cardHeight <= a.y,
          'cards must not overlap',
        );
      }
  const collapsed = layoutChart(records, new Set(['B']));
  assert.equal(collapsed.nodes.length, 4);
  assert.ok(!collapsed.edges.some((e) => e.id === 'D'));
  assert.equal(collapsed.nodes.find((n) => n.record.id === 'B')?.childCount, 1);
  assert.equal(layoutChart(records, new Set(['A'])).nodes.length, 2);
  assert.deepEqual([...descendants([node('A', 'B'), node('B', 'A')], 'A')].sort(), ['A', 'B']);
});

test('movement dates never turn a month or relative label into an exact day', () => {
  assert.equal(validateMovementDate('2024-02-29').eventDatePrecision, 'day');
  assert.equal(validateMovementDate('2026-02').eventDatePrecision, 'month');
  assert.equal(validateMovementDate('', { dateLabel: '11mo' }).eventDatePrecision, 'unknown');
  assert.equal(movementDateLabel(''), 'Date not published');
  assert.equal(movementDateLabel('2026-02'), '2026-02 · Month only');
  assert.equal(validateMovementDate('2026').eventDatePrecision, 'year');
  assert.equal(movementDateLabel('2026'), '2026 · Year only');
  for (const invalid of ['2026-02-29', '2026-13', '2026-00', '2026-2', '11mo'])
    assert.throws(() => validateMovementDate(invalid));
  assert.throws(() => validateMovementDate('2026-02', { eventDatePrecision: 'day' }));
  assert.throws(() => validateMovementDate('', { eventDatePrecision: 'month' }));
});

test('one cross-organization event is a departure at its origin and an arrival at its destination', () => {
  const event = {
    eventType: 'joined',
    structured: {
      fromOrganization: 'Binance',
      toOrganization: 'Bitget',
      fromRole: 'Regional VP',
      toRole: 'Chief Business Officer',
    },
  };
  const before = JSON.stringify(event);
  assert.equal(movementPerspective(event, 'Binance'), 'left');
  assert.equal(movementPerspective(event, 'Bitget'), 'joined');
  assert.equal(movementPerspective(event, 'OKX'), 'related');
  assert.equal(movementPerspective({ ...event, eventType: 'role_change' }, 'Binance'), 'left');
  assert.equal(movementPerspective({ ...event, eventType: 'left' }, 'Bitget'), 'joined');
  assert.equal(JSON.stringify(event), before, 'Classifying a view must not rewrite the source');
  assert.deepEqual(
    ['Binance', 'Bitget'].map((org) => movementTransition(event, org).toOrganization),
    ['Bitget', 'Bitget'],
  );
});

test('person summaries show a known destination regardless of which side of the move was selected', () => {
  const structured = {
    fromOrganization: 'Bitget',
    toOrganization: 'Ondo Finance',
    fromRole: 'Chief Business Officer',
    toRole: 'Managing Director',
  };
  const from = personMovement({ eventType: 'left', structured }, 'Bitget');
  const to = personMovement({ eventType: 'joined', structured }, 'Ondo Finance');
  assert.deepEqual(from, to);
  assert.equal(from.type, 'transferred');
  assert.equal(from.organizationName, 'Ondo Finance');
  assert.equal(personMovement({ eventType: 'left', structured: {} }, 'Bitget').type, 'left');
  assert.equal(
    personMovement(
      {
        eventType: 'role_change',
        structured: { fromOrganization: 'Bitget', toOrganization: 'Bitget' },
      },
      'Bitget',
    ).type,
    'role_change',
  );
});

test('multiple sources group only by an explicit reviewed event key and prefer employment timing', () => {
  const announcement = {
    id: 'announcement',
    personName: 'Alex',
    eventDate: '2024-10-28',
    structured: { dateBasis: 'announcement', movementGroupId: 'reviewed-transfer' },
  };
  const career = {
    ...announcement,
    id: 'career',
    eventDate: '2024-07',
    structured: { dateBasis: 'effective', movementGroupId: 'reviewed-transfer' },
  };
  const unrelated = { ...announcement, id: 'other', structured: {} };
  const otherPerson = { ...announcement, id: 'another-person', personName: 'Other Alex' };
  const groups = groupMovementRecords([announcement, career, unrelated, otherPerson]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0]!.record.id, career.id);
  assert.equal(groups[0]!.sources.length, 2);
  assert.equal(groups[0]!.sources[0]!.eventDate, '2024-10-28');
  assert.equal(movementDateLabelKey({ dateBasis: 'unknown' }), 'Date meaning not specified');
});

test('internal changes and legacy events work without guessing unknown destinations or aliases', () => {
  assert.equal(
    movementPerspective({ eventType: 'role_change', structured: {} }, 'Binance'),
    'role_change',
  );
  assert.equal(movementPerspective({ eventType: 'joined', structured: {} }, 'Binance'), 'joined');
  assert.equal(movementPerspective({ eventType: 'left', structured: {} }, 'Binance'), 'left');
  assert.equal(
    movementTransition({ eventType: 'left', structured: {} }, 'Binance').toOrganization,
    '',
  );
  assert.equal(
    movementPerspective(
      { eventType: 'joined', structured: { toOrganization: 'Bitget' } },
      'Binance',
    ),
    'related',
  );
  assert.equal(
    movementPerspective(
      { eventType: 'left', structured: { fromOrganization: 'Bitget' } },
      'Binance',
    ),
    'related',
  );
  assert.equal(
    movementPerspective(
      { eventType: 'joined', structured: { fromOrganization: 'Binance' } },
      'Binance',
    ),
    'left',
  );
  assert.equal(
    movementTransition(
      { eventType: 'joined', structured: { fromOrganization: 'Binance' } },
      'Binance',
    ).toOrganization,
    '',
  );
  assert.equal(
    movementPerspective(
      { eventType: 'role_change', structured: { fromOrganization: 'Bitget' } },
      'Binance',
    ),
    'related',
  );
  assert.equal(
    movementPerspective(
      {
        eventType: 'joined',
        structured: {
          fromOrganization: ' binance ',
          toOrganization: 'BINANCE',
          fromRole: 'Analyst',
          toRole: 'Manager',
        },
      },
      'Binance',
    ),
    'role_change',
  );
  assert.equal(
    movementPerspective(
      {
        eventType: 'joined',
        structured: { fromOrganization: 'Binance.US', toOrganization: 'Bitget' },
      },
      'Binance',
    ),
    'related',
  );
});

test('perspective filters and counts use the same classification and announcement dates stay explicit', () => {
  const records: Parameters<typeof movementPerspective>[0][] = [
    { eventType: 'joined', structured: { fromOrganization: 'Binance', toOrganization: 'Bitget' } },
    { eventType: 'joined', structured: { fromOrganization: 'Example', toOrganization: 'Binance' } },
    { eventType: 'role_change', structured: {} },
  ];
  assert.equal(records.filter((r) => movementPerspective(r, 'Binance') === 'left').length, 1);
  assert.equal(records.filter((r) => movementPerspective(r, 'Binance') === 'joined').length, 1);
  assert.equal(
    records.filter((r) => movementPerspective(r, 'Binance') === 'role_change').length,
    1,
  );
  const structured = validateMovementDate('2024-10-28', {
    dateBasis: 'announcement',
    dateLabel: 'Announcement only; exact employment dates unknown',
  });
  assert.equal(structured.eventDatePrecision, 'day');
  assert.equal(movementDateLabelKey(structured), 'Announcement date');
  assert.equal(movementDateLabelKey({}), 'Source date');
  assert.equal(movementDateLabelKey({ dateBasis: 'effective' }), 'Effective date');
  assert.throws(() => validateMovementDate('2024-10-28', { dateBasis: 'guessed' }));
});

test('org chart and movements: relationship evidence, hierarchy rules, permissions, import', async (t) => {
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
  const org = (
    await call('POST', '/api/organizations', { name: 'Chart test organization', tags: ['company'] })
  ).json().id as string;
  const other = (
    await call('POST', '/api/organizations', { name: 'Other organization', tags: ['company'] })
  ).json().id as string;
  const base = {
    title: 'Test role',
    body: 'Original person notes',
    scope: 'Test',
    status: 'confirmed',
    visibility: 'team',
    personName: 'Test person',
    personEmail: 'person@example.test',
    reportsTo: '',
    eventDate: '',
    eventType: '',
    rawText: '  Original position evidence\nPreserve this exactly.  ',
    sourceUrl: '',
  };
  async function create(
    personName: string,
    reportsTo = '',
    visibility = 'team',
    organizationId = org,
  ) {
    const response = await call(
      'POST',
      `/api/organizations/${organizationId}/tabs/org_chart/records`,
      { ...base, personName, reportsTo, visibility },
      visibility === 'admin' ? 'admin' : 'editor',
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const list = async (role = 'editor') =>
    (await call('GET', `/api/organizations/${org}/tabs/org_chart`, undefined, role)).json()
      .records as ModuleRecord[];

  await t.test(
    'moves keep independent evidence and history; invalid hierarchy is rejected',
    async () => {
      const ceo = await create('CEO');
      const manager = await create('Manager', ceo);
      const specialist = await create('Specialist', manager);
      const peer = await create('Peer');
      const hidden = await create('Hidden manager', '', 'admin');
      const remote = await create('Other person', '', 'team', other);
      const initial = (await list()).find((r) => r.id === specialist)!;
      assert.equal(
        initial.relationshipKind,
        'unconfirmed',
        'Confirmed person workflow must not confirm an edge.',
      );
      // 没有关系元数据的旧上级读作 unconfirmed。
      await h.ctx.pool.query('DELETE FROM omniboard.org_chart_relationships WHERE record_id = $1', [
        manager,
      ]);
      assert.equal((await list()).find((r) => r.id === manager)?.relationshipKind, 'unconfirmed');
      const path = `/api/organizations/${org}/org-chart/${specialist}/relationship`;
      const change = {
        revision: 1,
        reportsTo: peer,
        relationshipKind: 'confirmed',
        note: '  BD meeting: the specialist confirmed reporting to Peer on 2026-09-18.\nOriginal note.  ',
        sourceUrl: 'https://example.test/meeting',
      };
      assert.equal((await call('PATCH', path, change, 'reader')).statusCode, 403);
      assert.equal((await call('PATCH', path, { ...change, note: ' ' })).statusCode, 422);
      assert.equal((await call('PATCH', path, { ...change, reportsTo: remote })).statusCode, 422);
      assert.equal((await call('PATCH', path, { ...change, reportsTo: hidden })).statusCode, 422);
      assert.equal(
        (await call('PATCH', path, { ...change, reportsTo: specialist })).statusCode,
        422,
      );
      assert.equal(
        (
          await call('PATCH', `/api/organizations/${org}/org-chart/${ceo}/relationship`, {
            ...change,
            reportsTo: specialist,
          })
        ).statusCode,
        422,
      );
      assert.equal(
        (await call('PATCH', path, { ...change, sourceUrl: 'javascript:alert(1)' })).statusCode,
        422,
      );
      const moved = await call('PATCH', path, change);
      assert.equal(moved.statusCode, 200, moved.body);
      assert.deepEqual(moved.json(), { id: specialist, revision: 2 });
      const current = (await list()).find((r) => r.id === specialist)!;
      assert.equal(current.reportsTo, peer);
      assert.equal(current.relationshipKind, 'confirmed');
      assert.equal(current.revision, 2);
      assert.equal(
        current.evidenceId,
        initial.evidenceId,
        'The position evidence is never overwritten by a move.',
      );
      assert.equal(current.body, initial.body);
      assert.equal(current.personEmail, initial.personEmail);
      assert.notEqual(current.relationshipEvidenceId, initial.relationshipEvidenceId);
      assert.equal(
        (await call('GET', `/api/evidence/${current.evidenceId}`)).json().text,
        base.rawText,
      );
      assert.equal(
        (await call('GET', `/api/evidence/${current.relationshipEvidenceId}`)).json().text,
        change.note,
      );
      assert.equal((await call('PATCH', path, change)).statusCode, 409, 'stale drag revision');
      const history = (await call('GET', `/api/records/${specialist}/history`)).json().history;
      assert.equal(history.length, 2);
      assert.equal(history[0].action, 'reporting_relationship_updated');
      assert.equal(history[1].payload.reportsTo, manager);
      assert.equal(history[0].payload.relationshipEvidenceId, current.relationshipEvidenceId);
      assert.equal(history[1].payload.relationshipEvidenceId, initial.relationshipEvidenceId);
      const generic = `/api/organizations/${org}/tabs/org_chart/records/${specialist}`;
      const edit = {
        ...base,
        personName: 'Specialist',
        reportsTo: peer,
        revision: 2,
        rawText: '',
        reuseReference: true,
      };
      assert.equal(
        (await call('PATCH', generic, { ...edit, reportsTo: ceo })).statusCode,
        422,
        'generic editor also requires fresh relationship evidence',
      );
      assert.equal(
        (await call('PATCH', generic, { ...edit, title: 'Updated role' })).statusCode,
        200,
      );
      assert.equal(
        (await list()).find((r) => r.id === specialist)?.relationshipKind,
        'confirmed',
        'ordinary edits retain confirmation',
      );
      assert.equal(
        (
          await call('PATCH', path, {
            ...change,
            revision: 3,
            reportsTo: '',
            relationshipKind: 'confirmed',
            note: 'Reporting manager is no longer known.',
          })
        ).statusCode,
        200,
      );
      const top = (await list()).find((r) => r.id === specialist)!;
      assert.equal(top.reportsTo, '');
      assert.equal(top.relationshipKind, 'unconfirmed', 'top level is never a confirmed edge');
      assert.equal(
        (
          await call('PATCH', path, {
            ...change,
            revision: 4,
            reportsTo: '',
            relationshipKind: 'unconfirmed',
            note: 'Same again.',
          })
        ).statusCode,
        422,
        'a move must change the manager or certainty',
      );
      const hiddenChild = await create('Hidden child', '', 'admin');
      const secretPath = `/api/organizations/${org}/org-chart/${hiddenChild}/relationship`;
      assert.equal(
        (await call('PATCH', secretPath, { ...change, reportsTo: hidden }, 'editor')).statusCode,
        404,
      );
      assert.equal(
        (await call('PATCH', secretPath, { ...change, reportsTo: hidden }, 'admin')).statusCode,
        200,
      );
      const restricted = (await list('admin')).find((r) => r.id === hiddenChild)!;
      assert.equal(
        (
          await call(
            'GET',
            `/api/evidence/${restricted.relationshipEvidenceId}`,
            undefined,
            'reader',
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (await call('GET', `/api/records/${hiddenChild}/history`, undefined, 'editor')).statusCode,
        403,
      );
      assert.ok(!(await list('reader')).some((r) => r.id === hiddenChild));
      const evidence = await h.ctx.pool.query(
        `SELECT e.visibility, e.filename FROM omniboard.org_chart_relationships c
         JOIN omniboard.evidence e ON e.id = c.evidence_id WHERE c.record_id = $1`,
        [hiddenChild],
      );
      assert.deepEqual(evidence.rows, [
        { visibility: 'admin', filename: 'relationship-reference.txt' },
      ]);
      assert.equal(
        (
          await call('POST', `/api/organizations/${org}/tabs/org_chart/records`, {
            ...base,
            personName: '',
          })
        ).statusCode,
        422,
        'a position requires a person name',
      );
    },
  );

  const movements = `/api/organizations/${org}/tabs/people_movements`;
  const movement = {
    ...base,
    title: 'Robin joined as trader',
    personName: 'Robin Fixture',
    status: 'unverified',
    eventType: 'joined',
    eventDate: '2026-04',
    structured: { dateBasis: 'effective', toRole: 'Trader', dateLabel: 'Joined April 2026' },
  };
  await t.test('movement dates, metadata whitelist and ordering', async () => {
    const post = (patch: Record<string, unknown>) =>
      call('POST', `${movements}/records`, { ...movement, ...patch });
    for (const patch of [
      { personName: '' },
      { eventType: '' },
      { eventDate: '2026-2' },
      { eventDate: '11mo' },
      { eventDate: '2026-02-29' },
      { structured: { eventDatePrecision: 'day' } },
      { structured: { dateBasis: 'guessed' } },
      { structured: { transitionBasis: 'adjacent_profile_roles' } },
      { reportsTo: 'someone' },
    ])
      assert.equal((await post(patch)).statusCode, 422, JSON.stringify(patch));
    const created = await post({});
    assert.equal(created.statusCode, 201, created.body);
    assert.equal((await post({ title: 'Undated', eventDate: '', structured: {} })).statusCode, 201);
    assert.equal(
      (await post({ title: 'Exact day', eventDate: '2026-04-15', structured: {} })).statusCode,
      201,
    );
    const records = (await call('GET', movements)).json().records as ModuleRecord[];
    assert.deepEqual(
      records.map((r) => r.eventDate),
      ['2026-04-15', '2026-04', ''],
      'known dates first; an exact day sorts ahead of its month',
    );
    const saved = records.find((r) => r.id === created.json().id)!;
    assert.equal(saved.structured.eventDatePrecision, 'month');
    assert.equal(movementPerspective(saved, 'Chart test organization'), 'joined');
  });

  await t.test('import: relationship evidence and aliases need the import window', async () => {
    const bearer = (
      await request(
        'POST',
        '/api/tokens',
        { cookie: sessions.admin! },
        {
          name: 'importer',
          role: 'admin',
          expiresInDays: 7,
        },
      )
    ).json().token as string;
    const positions = await list();
    const ceo = positions.find((r) => r.personName === 'CEO')!;
    const note = await call('GET', `/api/evidence/${ceo.evidenceId}`);
    assert.equal(note.statusCode, 200);
    const imported = {
      ...base,
      id: 'v1-position',
      personName: 'Imported deputy',
      reportsTo: ceo.id,
      relationshipKind: 'confirmed',
      relationshipNote: 'Confirmed by the CEO in v1.',
      relationshipEvidenceId: ceo.evidenceId,
      evidenceId: ceo.evidenceId,
      rawText: '',
    };
    const url = `/api/organizations/${org}/tabs/org_chart/records`;
    assert.equal((await call('POST', url, imported, 'admin')).statusCode, 403);
    const res = await request('POST', url, { bearer }, imported);
    assert.equal(res.statusCode, 201, res.body);
    const deputy = (await list()).find((r) => r.id === 'v1-position')!;
    assert.equal(deputy.relationshipKind, 'confirmed');
    assert.equal(deputy.relationshipEvidenceId, ceo.evidenceId);
    assert.equal(deputy.relationshipNote, 'Confirmed by the CEO in v1.');
    // 旧数据里没有关系元数据的上级可以原样导入,读作 unconfirmed。
    const legacy = await request(
      'POST',
      url,
      { bearer },
      {
        ...imported,
        id: 'v1-legacy',
        relationshipKind: undefined,
        relationshipNote: '',
        relationshipEvidenceId: undefined,
      },
    );
    assert.equal(legacy.statusCode, 201, legacy.body);
    assert.equal((await list()).find((r) => r.id === 'v1-legacy')?.relationshipKind, 'unconfirmed');

    const aliasOrg = (
      await call('POST', '/api/organizations', { name: 'Old duplicate', tags: ['company'] })
    ).json().id as string;
    const orgAlias = {
      aliasId: aliasOrg,
      organizationId: org,
      reason: 'Reviewed duplicate',
      createdAt: '2026-01-02T00:00:00Z',
      payload: { movedRecordIds: [] },
    };
    const importOrg = (body: unknown, auth: { bearer?: string; cookie?: string } = { bearer }) =>
      request('POST', '/api/import/organization-aliases', auth, body);
    assert.equal((await importOrg(orgAlias, { cookie: sessions.admin! })).statusCode, 403);
    assert.equal((await importOrg({ ...orgAlias, aliasId: org })).statusCode, 422);
    assert.equal((await importOrg(orgAlias)).statusCode, 201);
    assert.equal((await importOrg(orgAlias)).statusCode, 200, 'idempotent');
    assert.equal((await importOrg({ ...orgAlias, organizationId: other })).statusCode, 409);
    assert.equal(
      (await importOrg({ ...orgAlias, aliasId: other, organizationId: aliasOrg })).statusCode,
      422,
      'an alias cannot be the canonical target',
    );
    assert.equal((await call('GET', `/api/organizations/${aliasOrg}`)).json().organization.id, org);
    const importRecord = (body: unknown) =>
      request('POST', '/api/import/record-aliases', { bearer }, body);
    const recordAlias = { aliasId: 'v1-legacy', recordId: 'v1-position' };
    assert.equal((await importRecord({ ...recordAlias, recordId: 'missing' })).statusCode, 422);
    assert.equal((await importRecord(recordAlias)).statusCode, 201);
    assert.equal((await importRecord(recordAlias)).statusCode, 200);
    assert.equal((await importRecord({ ...recordAlias, recordId: ceo.id })).statusCode, 409);
    await h.ctx.pool.query(
      "UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'",
    );
    assert.equal(
      (await importRecord({ aliasId: 'v1-position', recordId: ceo.id })).statusCode,
      403,
    );
  });
});
