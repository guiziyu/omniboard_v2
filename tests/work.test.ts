import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import type { WorkFeed } from '../src/shared/operations';
import { harness, tokenOf } from './helpers';
// 工作台任务(frontend-spec 10.1–10.7)。v1 tests/operations.test.ts 里任务相关的用例逐条保留:
// editing a task source、completion feedback、progress preserves state、standard onboarding、
// private evidence(工作摘要的断言随 Overview 4.8 迁移)。v1 用 `/work/intelligence/:id` 取记录的证据,
// 这里直接读库;已退役的 `/work/views`、`/work/seen` 仍须 404。

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
  async function record(access: 'team' | 'admin', orgId = org) {
    const response = await call('admin', 'POST', `/organizations/${orgId}/tabs/comments/records`, {
      title: access + ' fixture record',
      body: 'Fixture text',
      scope: 'Fixture scope',
      status: 'unverified',
      visibility: access,
      rawText: 'Synthetic evidence, never real provider facts.',
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const feed = async (role = 'admin') => (await call(role, 'GET', '/work')).json<WorkFeed>();
  const memberId = async (role: string) =>
    (await call(role, 'GET', '/session')).json().user.id as string;
  return { h, call, sql, sessions, org, other, newOrg, record, feed, memberId };
}

test('editing a task source keeps the current reference, history and access consistent', async (t) => {
  const { call, sql, org, record, feed } = await setup(t);
  const a = await record('team');
  const b = await record('team');
  const restricted = await record('admin');
  const plan = { title: 'Recheck source', lane: 'research', visibility: 'team', sourceRecordId: a };
  const created = await call('editor', 'POST', `/organizations/${org}/work/tasks`, plan);
  assert.equal(created.statusCode, 201, created.body);
  const taskId = created.json().id;
  let task = (await feed()).tasks.find((x) => x.id === taskId)!;
  const originalEvidence = task.evidenceId;
  let response = await call('editor', 'PATCH', `/work/tasks/${taskId}`, {
    ...plan,
    sourceRecordId: b,
    revision: task.revision,
  });
  assert.equal(response.statusCode, 200, response.body);
  task = (await feed()).tasks.find((x) => x.id === taskId)!;
  const sourceEvidence = (
    await sql('SELECT evidence_id FROM omniboard.module_records WHERE id = $1', [b])
  ).rows[0].evidence_id;
  assert.equal(task.sourceRecordId, b);
  assert.equal(task.sourceRecordTabId, 'comments');
  assert.equal(task.evidenceId, sourceEvidence);
  assert.notEqual(task.evidenceId, originalEvidence);
  const history = (await call('editor', 'GET', `/work/tasks/${taskId}/history`)).json().events;
  assert.equal(history[0].payload.evidenceId, task.evidenceId);
  assert.equal(history.at(-1).payload.evidenceId, originalEvidence);
  // An explicit new note takes precedence over the selected source for this revision.
  response = await call('editor', 'PATCH', `/work/tasks/${taskId}`, {
    ...plan,
    sourceRecordId: b,
    revision: task.revision,
    rawText: 'New original note about source B',
  });
  assert.equal(response.statusCode, 200, response.body);
  task = (await feed()).tasks.find((x) => x.id === taskId)!;
  const noteEvidence = task.evidenceId;
  assert.notEqual(noteEvidence, sourceEvidence);
  // A title-only edit must not reset that note to the original source.
  await call('editor', 'PATCH', `/work/tasks/${taskId}`, {
    ...plan,
    title: 'Revised title',
    sourceRecordId: b,
    revision: task.revision,
  });
  task = (await feed()).tasks.find((x) => x.id === taskId)!;
  assert.equal(task.evidenceId, noteEvidence);
  response = await call('editor', 'PATCH', `/work/tasks/${taskId}`, {
    ...plan,
    sourceRecordId: restricted,
    revision: task.revision,
  });
  assert.equal(response.statusCode, 403);
  const after = (await feed()).tasks.find((x) => x.id === taskId)!;
  assert.equal(after.revision, task.revision);
  assert.equal(after.evidenceId, noteEvidence);
});

test('completion feedback reports actual new readiness and keeps outstanding prerequisites visible', async (t) => {
  const { call, org, feed } = await setup(t);
  await call('editor', 'POST', `/organizations/${org}/work/start`, { visibility: 'team' });
  const finish = async (key: string, state = 'done') => {
    const task = (await feed()).tasks.find((x) => x.templateKey === key)!;
    const r = await call('editor', 'POST', `/work/tasks/${task.id}/actions`, {
      revision: task.revision,
      state,
      outcome: 'Synthetic decision',
      rawText: 'Original fixture evidence',
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const scoped = await finish('scope');
  const tasks = (await feed()).tasks;
  assert.deepEqual(
    new Set(scoped.unlocked.map((x: { id: string }) => x.id)),
    new Set(tasks.filter((x) => ['docs', 'eligibility'].includes(x.templateKey)).map((x) => x.id)),
  );
  await finish('docs');
  const implemented = await finish('implementation');
  assert.equal(implemented.unlocked.length, 0);
  assert.equal(implemented.remaining.length, 1);
  assert.equal(
    implemented.remaining[0].blockers[0].id,
    tasks.find((x) => x.templateKey === 'resources')!.id,
  );
  await finish('eligibility');
  await finish('account');
  const waived = await finish('resources', 'skipped');
  assert.equal(waived.state, 'skipped');
  assert.equal(waived.unlocked[0].id, tasks.find((x) => x.templateKey === 'validation')!.id);
});

test('progress preserves state, original note and ownership, checks revisions and rejects reader writes', async (t) => {
  const { call, org, feed, memberId } = await setup(t);
  const editorId = await memberId('editor');
  await call('editor', 'POST', `/organizations/${org}/work/start`, { visibility: 'team' });
  let task = (await feed()).tasks.find((x) => x.templateKey === 'contacts')!;
  let r = await call('editor', 'POST', `/work/tasks/${task.id}/actions`, {
    revision: task.revision,
    state: 'active',
    claim: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().unlocked, []);
  task = (await feed()).tasks.find((x) => x.id === task.id)!;
  assert.equal(task.ownerId, editorId);
  r = await call('admin', 'POST', `/work/tasks/${task.id}/actions`, {
    revision: task.revision,
    state: 'waiting',
    outcome: 'Waiting for a reply',
    followUpOn: '2026-09-22',
    claim: true,
  });
  assert.equal(r.statusCode, 200, r.body);
  task = (await feed()).tasks.find((x) => x.id === task.id)!;
  assert.equal(task.followUpOn, '2026-09-22');
  assert.deepEqual(
    (await feed()).alerts.filter((a) => a.kind === 'task').map((a) => a.detail),
    ['Follow up now'],
    'the harness clock is 2026-09-29, so the follow-up date has arrived',
  );
  const beforeEvidence = task.evidenceId;
  const input = {
    revision: task.revision,
    outcome: 'Contact asked for scoped account details.',
    nextStep: 'Send the entity and product scope.',
    followUpOn: '2026-10-24',
  };
  assert.equal(
    (await call('reader', 'POST', `/work/tasks/${task.id}/updates`, input)).statusCode,
    403,
  );
  r = await call('editor', 'POST', `/work/tasks/${task.id}/updates`, input);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await call('editor', 'POST', `/work/tasks/${task.id}/updates`, input)).statusCode,
    409,
  );
  task = (await feed()).tasks.find((x) => x.id === task.id)!;
  assert.equal(task.state, 'waiting');
  assert.equal(task.ownerId, editorId);
  assert.equal(task.nextStep, input.nextStep);
  assert.equal(task.followUpOn, input.followUpOn);
  assert.notEqual(task.evidenceId, beforeEvidence);
  assert.deepEqual(
    (await feed()).alerts.filter((a) => a.kind === 'task'),
    [],
  );
  const history = (await call('editor', 'GET', `/work/tasks/${task.id}/history`)).json().events;
  assert.equal(history[0].payload.evidenceId, task.evidenceId);
  assert.equal(history[0].payload.outcome, input.outcome);
  assert.equal(history[0].title, 'Progress recorded · ' + task.title);
  const raw = await call('editor', 'GET', `/evidence/${task.evidenceId}`);
  assert.equal(raw.statusCode, 200, raw.body);
  const done = await call('editor', 'POST', `/work/tasks/${task.id}/actions`, {
    revision: task.revision,
    state: 'done',
    outcome: 'Route recorded',
    rawText: 'Synthetic final contact route',
  });
  assert.equal(done.statusCode, 200, done.body);
  task = (await feed()).tasks.find((x) => x.id === task.id)!;
  assert.equal(task.followUpOn, '');
  assert.equal(
    (
      await call('editor', 'POST', `/work/tasks/${task.id}/updates`, {
        ...input,
        revision: task.revision,
      })
    ).statusCode,
    422,
  );
});

test('standard onboarding starts once, runs parallel tracks, enforces dependencies, optimistic revisions and evidence', async (t) => {
  const { call, org, newOrg, feed, memberId } = await setup(t);
  const editorId = await memberId('editor');
  const company = (
    await call('admin', 'POST', '/organizations', { name: 'Synthetic company', tags: ['company'] })
  ).json().id;
  assert.equal(
    (await call('editor', 'POST', `/organizations/${company}/work/start`, {})).statusCode,
    422,
    'organizations without the Onboarding module have no standard plan',
  );
  assert.equal(
    (await call('editor', 'POST', `/organizations/${org}/work/start`, { visibility: 'admin' }))
      .statusCode,
    403,
  );
  const first = await call('editor', 'POST', `/organizations/${org}/work/start`, {
    visibility: 'team',
  });
  assert.equal(first.statusCode, 201, first.body);
  const again = await call('editor', 'POST', `/organizations/${org}/work/start`, {
    visibility: 'team',
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, 0);
  const tasks = (await feed()).tasks;
  assert.equal(tasks.length, 9);
  assert.equal(tasks.filter((x) => x.displayState === 'ready').length, 3);
  assert.ok(tasks.every((x) => x.state === 'planned' && x.origin === 'standard'));
  assert.ok(tasks.every((x) => x.nextStep && x.completionCriteria));
  assert.equal(new Set(tasks.map((x) => x.evidenceId)).size, 1, 'one template snapshot');
  const get = async (key: string) =>
    (await feed()).tasks.find((x) => x.templateKey === key && x.organizationId === org)!;
  const action = async (key: string, state: string, extras = {}) => {
    const task = await get(key);
    return call('editor', 'POST', `/work/tasks/${task.id}/actions`, {
      revision: task.revision,
      state,
      ...extras,
    });
  };
  assert.equal((await action('validation', 'active')).statusCode, 409);
  assert.equal((await action('scope', 'planned')).statusCode, 422, 'same state');
  assert.equal((await action('scope', 'done', { outcome: 'Fixture scope' })).statusCode, 422);
  assert.equal(
    (
      await action('scope', 'done', {
        outcome: 'Fixture scope',
        rawText: 'Synthetic scope decision',
      })
    ).statusCode,
    200,
  );
  assert.equal((await action('docs', 'active')).statusCode, 200);
  assert.equal((await action('contacts', 'active')).statusCode, 200);
  assert.equal(
    (await action('scope', 'planned')).statusCode,
    409,
    'Active descendants protect completed prerequisites',
  );
  const doc = await get('docs');
  const payload = {
    title: doc.title,
    lane: doc.lane,
    ownerId: editorId,
    description: doc.description,
    dueOn: '',
    visibility: doc.visibility,
    dependencies: doc.dependencies,
    objectIds: [],
    sourceRecordId: '',
    revision: doc.revision,
  };
  assert.equal((await call('editor', 'PATCH', `/work/tasks/${doc.id}`, payload)).statusCode, 200);
  assert.equal((await call('editor', 'PATCH', `/work/tasks/${doc.id}`, payload)).statusCode, 409);
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${doc.id}`, {
        ...payload,
        revision: doc.revision + 1,
        visibility: 'admin',
      })
    ).statusCode,
    422,
    'task access cannot change after creation',
  );
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${doc.id}`, {
        ...payload,
        revision: doc.revision + 1,
        ownerId: 'not-a-member',
      })
    ).statusCode,
    422,
  );
  const scope = await get('scope');
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${scope.id}`, {
        ...payload,
        revision: scope.revision,
      })
    ).statusCode,
    422,
    'A completed plan is immutable until reopened',
  );
  const contacts = await get('contacts');
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${(await get('docs')).id}`, {
        ...payload,
        revision: doc.revision + 1,
        dependencies: [...doc.dependencies, contacts.id],
      })
    ).statusCode,
    409,
    'an active task cannot gain an unfinished prerequisite',
  );
  assert.equal((await action('docs', 'planned')).statusCode, 200);
  const docs = await get('docs');
  const implementation = await get('implementation');
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${docs.id}`, {
        ...payload,
        revision: docs.revision,
        dependencies: [implementation.id],
      })
    ).statusCode,
    422,
    'Reject indirect dependency cycles',
  );
  const foreign = await newOrg('Foreign synthetic exchange');
  await call('editor', 'POST', `/organizations/${foreign}/work/start`, {});
  const foreignTask = (await feed()).tasks.find((x) => x.organizationId === foreign)!;
  assert.equal(
    (
      await call('editor', 'PATCH', `/work/tasks/${docs.id}`, {
        ...payload,
        revision: docs.revision,
        dependencies: [foreignTask.id],
      })
    ).statusCode,
    422,
    'prerequisites stay inside the organization',
  );
  for (const key of ['eligibility', 'account', 'resources', 'docs', 'implementation'])
    assert.equal(
      (
        await action(key, 'done', {
          outcome: 'Fixture completion',
          rawText: 'Synthetic completion evidence',
        })
      ).statusCode,
      200,
      key,
    );
  assert.equal(
    (
      await action('validation', 'done', {
        outcome: 'Fixture validation',
        rawText: 'Fixture evidence',
      })
    ).statusCode,
    422,
  );
  assert.equal(
    (
      await action('validation', 'done', {
        outcome: 'Fixture validation',
        rawText: 'Fixture evidence',
        environment: 'Isolated fixture',
        codeRevision: 'fixture-123',
      })
    ).statusCode,
    200,
  );
  assert.equal((await get('contacts')).state, 'active');
  const validation = await get('validation');
  assert.equal(
    validation.outcome,
    'Fixture validation\nEnvironment: Isolated fixture\nCode revision: fixture-123',
  );
  const history = await call('reader', 'GET', `/work/tasks/${validation.id}/history`);
  assert.ok(history.body.includes('fixture-123'));
  assert.equal(history.json().events[0].title, 'Completed · ' + validation.title);
});

test('private evidence, dependent tasks, retired view routes and inherited access remain protected', async (t) => {
  const { call, org, other, feed, record } = await setup(t);
  const privateRecord = await record('admin');
  const publicRecord = await record('team');
  const input = {
    title: 'Private fixture task',
    lane: 'business',
    visibility: 'admin',
    sourceRecordId: privateRecord,
  };
  assert.equal(
    (await call('editor', 'POST', `/organizations/${org}/work/tasks`, input)).statusCode,
    403,
  );
  assert.equal(
    (
      await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
        ...input,
        visibility: 'team',
      })
    ).statusCode,
    422,
  );
  const secret = (await call('admin', 'POST', `/organizations/${org}/work/tasks`, input)).json()
    .id as string;
  assert.equal(
    (
      await call('reader', 'POST', `/organizations/${org}/work/tasks`, {
        ...input,
        visibility: 'team',
      })
    ).statusCode,
    403,
  );
  const taskInput = {
    title: 'Visible fixture task',
    lane: 'research',
    visibility: 'team',
    sourceRecordId: publicRecord,
  };
  assert.equal(
    (
      await call('editor', 'POST', `/organizations/${org}/work/tasks`, {
        title: 'No source',
        lane: 'research',
      })
    ).statusCode,
    422,
    'a new task needs original information or a source record',
  );
  const publicId = (
    await call('editor', 'POST', `/organizations/${org}/work/tasks`, taskInput)
  ).json().id as string;
  assert.equal(
    (
      await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
        ...taskInput,
        dependencies: [secret],
      })
    ).statusCode,
    422,
  );
  const foreignRecord = await record('team', other);
  assert.equal(
    (
      await call('editor', 'POST', `/organizations/${org}/work/tasks`, {
        ...taskInput,
        sourceRecordId: foreignRecord,
      })
    ).statusCode,
    404,
  );
  const publicTask = (await feed()).tasks.find((x) => x.id === publicId)!;
  assert.equal(
    (
      await call('editor', 'POST', `/work/tasks/${publicId}/actions`, {
        revision: publicTask.revision,
        state: 'done',
        outcome: 'Fixture',
        rawText: 'Fixture completion',
      })
    ).statusCode,
    200,
  );
  const secretTask = (await feed()).tasks.find((x) => x.id === secret)!;
  assert.equal(
    (
      await call('admin', 'PATCH', `/work/tasks/${secret}`, {
        ...input,
        revision: secretTask.revision,
        dependencies: [publicId],
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call('admin', 'POST', `/work/tasks/${secret}/actions`, { revision: 2, state: 'active' }))
      .statusCode,
    200,
  );
  const reopen = await call('editor', 'POST', `/work/tasks/${publicId}/actions`, {
    revision: 2,
    state: 'planned',
  });
  assert.equal(reopen.statusCode, 409);
  assert.ok(!reopen.body.includes('Private fixture task'));
  assert.match(reopen.json().message, /An administrator must reset a dependent task/);
  const readerFeed = await feed('reader');
  assert.equal(readerFeed.tasks.length, 1);
  assert.ok(!JSON.stringify(readerFeed).includes('Private fixture task'));
  assert.equal((await call('reader', 'GET', `/work/tasks/${secret}/history`)).statusCode, 404);
  assert.equal((await call('admin', 'POST', '/work/views', {})).statusCode, 404);
  assert.equal((await call('admin', 'POST', '/work/seen', { through: 2 })).statusCode, 404);
  assert.ok(!('views' in readerFeed));
  assert.ok(!('seenThrough' in readerFeed));
});

test('administrator-only plans and their prerequisites stay invisible to other roles', async (t) => {
  const { call, org, feed, record } = await setup(t);
  const privateRecord = await record('admin');
  const secret = (
    await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
      title: 'Private prerequisite',
      lane: 'business',
      visibility: 'admin',
      sourceRecordId: privateRecord,
    })
  ).json().id as string;
  const dependent = (
    await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
      title: 'Admin dependent',
      lane: 'business',
      visibility: 'admin',
      dependencies: [secret],
      rawText: 'Fixture note',
    })
  ).json().id as string;
  const adminView = (await feed()).tasks.find((x) => x.id === dependent)!;
  assert.equal(adminView.displayState, 'blocked');
  assert.deepEqual(adminView.blockers, [{ id: secret, title: 'Private prerequisite' }]);
  assert.equal(
    (await call('editor', 'GET', `/work/tasks/${dependent}/history`)).statusCode,
    404,
    'admin tasks are invisible to editors',
  );
  assert.deepEqual((await feed('editor')).tasks, []);
  assert.equal(
    (
      await call('admin', 'POST', `/organizations/${org}/work/tasks`, {
        title: 'Team dependent',
        lane: 'business',
        dependencies: [secret],
        rawText: 'Fixture note',
      })
    ).statusCode,
    422,
    'a team task cannot depend on a restricted task',
  );
});

test('work feed: organization scope, alias organizations, members and claim alerts', async (t) => {
  const { call, org, other, feed, record } = await setup(t);
  await call('editor', 'POST', `/organizations/${org}/work/start`, {});
  await call('editor', 'POST', `/organizations/${other}/work/tasks`, {
    title: 'Other task',
    lane: 'research',
    rawText: 'Fixture note',
  });
  const scoped = (await call('editor', 'GET', `/work?organizationId=${other}`)).json<WorkFeed>();
  assert.deepEqual(
    scoped.tasks.map((x) => x.title),
    ['Other task'],
  );
  assert.deepEqual(
    scoped.events.map((e) => e.title),
    ['New information → Other task'],
  );
  assert.equal((await call('editor', 'GET', '/work?organizationId=missing')).statusCode, 404);
  const all = await feed('editor');
  assert.deepEqual(
    all.organizations.map((o) => o.name),
    ['Other synthetic exchange', 'Synthetic exchange'],
  );
  assert.ok(all.organizations[0]!.tags.includes('exchange'));
  assert.deepEqual(all.members.map((m) => m.name).sort(), ['Owner', 'editor', 'reader'].sort());
  // 结论冲突与临近过期都进 alerts(8.1)。
  const source = await record('team');
  const object = (
    await call('editor', 'POST', `/organizations/${org}/knowledge/objects`, {
      name: 'Fixture account',
      kind: 'account',
      scope: 'Fixture scope',
      visibility: 'team',
      sourceRecordId: source,
    })
  ).json().id as string;
  const claim = await call('editor', 'POST', `/knowledge/objects/${object}/claims`, {
    field: 'Fee tier',
    scope: 'Spot',
    value: 'VIP 1',
    validUntil: '2026-10-10',
    sourceRecordId: source,
  });
  assert.equal(claim.statusCode, 201, claim.body);
  const alerts = (await feed('editor')).alerts.filter((a) => a.kind === 'claim');
  assert.deepEqual(
    alerts.map((a) => [a.title, a.detail]),
    [['Fixture account · Fee tier', 'Expires soon · 2026-10-10']],
  );
});

test('task import keeps v1 ids, times and links, and follows the import window', async (t) => {
  const { h, call, sql, sessions, org, other, feed, record, memberId } = await setup(t);
  const editorId = await memberId('editor');
  const bearer = (
    await h.request(
      'POST',
      '/api/tokens',
      { cookie: sessions.admin! },
      { name: 'importer', role: 'admin', expiresInDays: 7 },
    )
  ).json().token as string;
  const post = (path: string, body: object) => h.request('POST', path, { bearer }, body);
  const source = await record('team');
  const secretSource = await record('admin');
  const evidence = (
    await sql('SELECT evidence_id FROM omniboard.module_records WHERE id = $1', [source])
  ).rows[0].evidence_id as string;
  const prerequisite = {
    id: 'v1-scope',
    organizationId: org,
    title: 'Define account and product scope',
    lane: 'business',
    state: 'done',
    origin: 'standard',
    templateKey: 'scope',
    outcome: 'Scoped',
    visibility: 'team',
    evidenceId: evidence,
    revision: 4,
    updatedAt: '2025-02-03T04:05:06Z',
  };
  assert.equal(
    (await h.request('POST', '/api/import/work-tasks', { cookie: sessions.admin! }, prerequisite))
      .statusCode,
    403,
  );
  assert.equal(
    (await post('/api/import/work-tasks', { ...prerequisite, templateKey: '' })).statusCode,
    422,
  );
  assert.equal((await post('/api/import/work-tasks', prerequisite)).statusCode, 201);
  assert.equal((await post('/api/import/work-tasks', prerequisite)).statusCode, 409);
  const task = {
    id: 'v1-follow-up',
    organizationId: org,
    title: 'Imported follow-up',
    lane: 'research',
    state: 'waiting',
    origin: 'discovery',
    ownerId: editorId,
    followUpOn: '2025-03-01',
    dueOn: '2025-03-15',
    visibility: 'team',
    sourceRecordId: source,
    evidenceId: evidence,
    revision: 2,
    updatedAt: '2025-02-04T00:00:00Z',
    dependencies: ['v1-scope'],
  };
  assert.equal(
    (await post('/api/import/work-tasks', { ...task, dependencies: ['missing'] })).statusCode,
    422,
  );
  assert.equal(
    (await post('/api/import/work-tasks', { ...task, sourceRecordId: secretSource })).statusCode,
    422,
  );
  assert.equal(
    (await post('/api/import/work-tasks', { ...task, organizationId: other })).statusCode,
    422,
  );
  assert.equal((await post('/api/import/work-tasks', task)).statusCode, 201);
  const imported = (await feed()).tasks.find((x) => x.id === 'v1-follow-up')!;
  assert.equal(imported.revision, 2);
  assert.equal(imported.updatedAt, '2025-02-04T00:00:00.000Z');
  assert.equal(imported.ownerName, 'editor');
  assert.deepEqual(imported.dependencies, ['v1-scope']);
  assert.equal(imported.displayState, 'waiting');
  assert.deepEqual(
    (await feed()).alerts.filter((a) => a.targetId === 'v1-follow-up').map((a) => a.detail),
    ['Overdue · Follow up now'],
  );
  // 导入的任务照常可以继续推进。
  const progressed = await call('editor', 'POST', '/work/tasks/v1-follow-up/updates', {
    revision: 2,
    outcome: 'Still waiting',
  });
  assert.equal(progressed.statusCode, 200, progressed.body);
  await sql("UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'");
  assert.equal(
    (await post('/api/import/work-tasks', { ...task, id: 'late', dependencies: [] })).statusCode,
    403,
  );
});
