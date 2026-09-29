import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { tabsFor, unionTabs } from '../src/shared/registry';
import { tagDefinitions, type OrganizationTag } from '../src/shared/tags';
import { defaultsFor, validateKnowledge } from '../src/shared/knowledge';
import { compareRoadmap, roadmapPeriod, roadmapWindowPassed } from '../src/shared/roadmap';
import type { ModuleRecord } from '../src/shared/types';
import type { WorkFeed } from '../src/shared/operations';
import { harness, tokenOf } from './helpers';
// 路线图(frontend-spec 10.11、10.12)。v1 tests/roadmap.test.ts 的三个用例逐条保留;
// 另加 10.12 的「完成关联任务不改里程碑状态」。

test('roadmap is available exactly once for every organization tag and comparisons', () => {
  for (const tag of Object.keys(tagDefinitions) as OrganizationTag[]) {
    const tabs = tabsFor([tag]);
    assert.equal(tabs.filter((t) => t.id === 'roadmap').length, 1);
    assert.ok(
      tabs.findIndex((t) => t.id === 'roadmap') < tabs.findIndex((t) => t.id === 'comments'),
    );
    const onboarding = tabs.findIndex((t) => t.id === 'onboarding');
    if (onboarding >= 0) assert.ok(onboarding < tabs.findIndex((t) => t.id === 'roadmap'));
    assert.equal(
      unionTabs([tag], ['company', 'exchange']).filter((t) => t.id === 'roadmap').length,
      1,
    );
  }
});

test('roadmap preserves partial target dates and separates completion from review status', () => {
  const base = {
    ...defaultsFor('roadmap'),
    successCriteria: 'Fixture outcome',
    reviewedOn: '2026-09-19',
  };
  for (const targetPeriod of ['', '2027', '2027-Q2', '2028-02', '2028-02-29'])
    assert.equal(
      validateKnowledge('roadmap', { ...base, targetPeriod }).targetPeriod,
      targetPeriod,
    );
  for (const targetPeriod of [
    'soon',
    '2027-Q5',
    '2027-13',
    '2027-02-29',
    '2027-04-31',
    '2027-1',
    '0000',
  ])
    assert.throws(() => validateKnowledge('roadmap', { ...base, targetPeriod }));
  for (const extra of [
    { planType: 'invented' },
    { roadmapStatus: 'verified' },
    { successCriteria: '' },
    { percent: '75' },
  ])
    assert.throws(() => validateKnowledge('roadmap', { ...base, ...extra }));
  assert.deepEqual(roadmapPeriod('2027-Q2'), { start: '2027-04-01', end: '2027-06-30' });
  assert.deepEqual(roadmapPeriod('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  const record = (id: string, targetPeriod: string, roadmapStatus = 'planned') => ({
    id,
    title: id,
    status: 'confirmed',
    structured: { targetPeriod, roadmapStatus },
  });
  assert.equal(roadmapWindowPassed(record('Quarter', '2027-Q2'), '2027-06-30'), false);
  assert.equal(roadmapWindowPassed(record('Quarter', '2027-Q2'), '2027-07-01'), true);
  assert.equal(roadmapWindowPassed(record('Unknown', ''), '2027-07-01'), false);
  for (const state of ['delivered', 'cancelled'])
    assert.equal(roadmapWindowPassed(record('Finished', '2026', state), '2027-07-01'), false);
  const list = [record('Undated', ''), record('Later', '2028'), record('Soon', '2027-Q2')];
  assert.deepEqual(
    list.sort(compareRoadmap).map((r) => r.id),
    ['Soon', 'Later', 'Undated'],
  );
});

test('roadmap records retain evidence and revisions, link execution tasks and respect permissions', async (t) => {
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
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    payload?: object,
    role = 'editor',
  ) => h.request(method, '/api' + path, { cookie: sessions[role]! }, payload);

  const orgs: string[] = [];
  for (const tag of ['company', 'government', 'exchange']) {
    const org = (
      await call('POST', '/organizations', { name: 'Roadmap fixture ' + tag, tags: [tag] })
    ).json().id as string;
    orgs.push(org);
    const empty = await call('GET', `/organizations/${org}/tabs/roadmap`);
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().status, 'empty');
  }
  const org = orgs[0]!;
  const path = `/organizations/${org}/tabs/roadmap/records`;
  const input = {
    title: 'Synthetic market launch',
    body: 'The source describes a planned launch.',
    scope: 'Synthetic region',
    status: 'unverified',
    visibility: 'team',
    rawText: 'Original fixture plan: target Q4 2027, subject to review.',
    sourceUrl: 'https://example.test/roadmap',
    structured: {
      ...defaultsFor('roadmap'),
      targetPeriod: '2027-Q4',
      successCriteria: 'Fixture launch available',
      reviewedOn: '2026-09-19',
    },
  };
  assert.equal((await call('POST', path, input, 'reader')).statusCode, 403);
  assert.equal((await call('POST', path, { ...input, rawText: '' })).statusCode, 422);
  assert.equal(
    (
      await call('POST', path, {
        ...input,
        structured: { ...input.structured, targetPeriod: '2027-02-29' },
      })
    ).statusCode,
    422,
  );
  const created = await call('POST', path, input);
  assert.equal(created.statusCode, 201, created.body);
  const recordId = created.json().id as string;
  const read = async (role = 'editor') =>
    (await call('GET', `/organizations/${org}/tabs/roadmap`, undefined, role)).json()
      .records as ModuleRecord[];
  const first = (await read())[0]!;
  const updated = await call('PATCH', `${path}/${recordId}`, {
    ...input,
    rawText: '',
    revision: 1,
    reuseReference: true,
    structured: { ...input.structured, roadmapStatus: 'in_progress' },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(
    (await call('PATCH', `${path}/${recordId}`, { ...input, revision: 1, reuseReference: true }))
      .statusCode,
    409,
  );
  const current = (await read())[0]!;
  assert.equal(current.evidenceId, first.evidenceId);
  assert.equal(current.status, 'unverified', 'Plan progress never verifies the source.');
  assert.equal(current.structured.targetPeriod, '2027-Q4');
  assert.equal(current.structured.roadmapStatus, 'in_progress');
  assert.equal(current.revision, 2);
  assert.equal((await call('GET', `/records/${recordId}/history`)).json().history.length, 2);

  const task = await call('POST', `/organizations/${org}/work/tasks`, {
    title: 'Validate the launch with the provider',
    lane: 'business',
    sourceRecordId: recordId,
  });
  assert.equal(task.statusCode, 201, task.body);
  const feed = (await call('GET', `/work?organizationId=${org}`)).json() as WorkFeed;
  const linked = feed.tasks.find((t) => t.sourceRecordId === recordId)!;
  assert.ok(linked);
  const done = await call('POST', `/work/tasks/${linked.id}/actions`, {
    revision: linked.revision,
    state: 'done',
    outcome: 'Provider confirmed the fixture launch window.',
    rawText: 'Provider email: launch window confirmed.',
  });
  assert.equal(done.statusCode, 200, done.body);
  const afterTask = (await read())[0]!;
  assert.equal(afterTask.structured.roadmapStatus, 'in_progress', 'tasks never move milestones');
  assert.equal(afterTask.revision, 2);

  const privatePlan = await call(
    'POST',
    path,
    { ...input, title: 'Private fixture plan', visibility: 'admin' },
    'admin',
  );
  assert.equal(privatePlan.statusCode, 201, privatePlan.body);
  assert.equal((await read('reader')).length, 1);
  const privateRecord = (await read('admin')).find((r) => r.visibility === 'admin')!;
  assert.equal(
    (await call('GET', `/evidence/${privateRecord.evidenceId}`, undefined, 'reader')).statusCode,
    403,
  );
});
