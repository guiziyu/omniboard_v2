import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyLayers, onboardingTemplate, type WorkTask } from '../src/shared/operations';
import {
  actionableTask,
  taskAttention,
  matchesWorkState,
  orderWorkTasks,
} from '../src/shared/work-queue';
import { taskImpact } from '../src/shared/focus';
import { defaultWorkFilters, workFiltersFromQuery } from '../src/shared/filter-preferences';
// 工作台的纯规则(frontend-spec 10.1–10.3、10.7),从 v1 tests/work-queue.test.ts 与
// tests/operations.test.ts(dependency graph)迁移。v1 同一用例里的资金计算器随资金情景一起迁移。
const today = '2026-09-20';
const task = (id: string, changes: Partial<WorkTask> = {}): WorkTask => ({
  id,
  organizationId: 'org',
  organizationName: 'Org',
  title: id,
  lane: 'business',
  state: 'planned',
  displayState: 'ready',
  origin: 'standard',
  templateKey: 'scope',
  ownerId: '',
  ownerName: '',
  description: '',
  nextStep: '',
  completionCriteria: '',
  followUpOn: '',
  outcome: '',
  dueOn: '',
  visibility: 'team',
  revision: 1,
  updatedAt: '',
  evidenceId: '',
  sourceRecordId: '',
  objectIds: [],
  dependencies: [],
  blockers: [],
  ...changes,
});
test('dependency graph groups independent work and rejects indirect cycles', () => {
  const layers = dependencyLayers(
    onboardingTemplate.map((t) => ({ id: t.key, dependencies: t.dependencies })),
  );
  assert.deepEqual(layers[0], ['scope', 'contacts', 'terms']);
  assert.equal(layers.at(-1)?.[0], 'validation');
  assert.throws(
    () =>
      dependencyLayers([
        { id: 'a', dependencies: ['b'] },
        { id: 'b', dependencies: ['a'] },
      ]),
    /depend/,
  );
});
test('normal readiness and future waiting are not alerts, and read-only queues keep overdue blockers', () => {
  const ready = task('ready');
  const waiting = task('waiting', {
    state: 'waiting',
    displayState: 'waiting',
    followUpOn: '2026-09-21',
  });
  const blocked = task('blocked', {
    displayState: 'blocked',
    dueOn: '2026-09-19',
    blockers: [{ id: 'prerequisite', title: 'Prerequisite' }],
  });
  assert.deepEqual(taskAttention(ready, today), []);
  assert.deepEqual(taskAttention(waiting, today), []);
  assert.equal(actionableTask(waiting, today), false);
  assert.equal(actionableTask(blocked, today), true);
  assert.equal(matchesWorkState(waiting, '', today), true);
  assert.equal(matchesWorkState(waiting, 'actionable', today), false);
  assert.deepEqual(
    orderWorkTasks([ready, blocked], today).map((t) => t.id),
    ['blocked', 'ready'],
  );
});
test('one task can have multiple follow-up reasons without appearing twice; finished tasks never alert', () => {
  const waiting = task('waiting', {
    state: 'waiting',
    displayState: 'waiting',
    dueOn: '2026-09-19',
    followUpOn: today,
  });
  assert.deepEqual(taskAttention(waiting, today), ['Overdue', 'Follow up now']);
  const done = { ...waiting, id: 'done', state: 'done' as const, displayState: 'done' as const };
  assert.deepEqual(taskAttention(done, today), []);
  assert.equal(matchesWorkState(done, 'open', today), false);
  assert.equal(matchesWorkState(done, 'done', today), true);
  const filtered = [waiting, done, task('ready')].filter((t) =>
    matchesWorkState(t, 'actionable', today),
  );
  assert.deepEqual(
    orderWorkTasks(filtered, today).map((t) => t.id),
    ['waiting', 'ready'],
  );
});
test('ordering: dated work first, then template order, discovered tasks after template tasks', () => {
  const scope = task('b-scope', { templateKey: 'scope' });
  const terms = task('a-terms', { templateKey: 'terms' });
  const discovered = task('0-discovered', { origin: 'discovery', templateKey: '' });
  const dated = task('z-dated', { templateKey: 'terms', dueOn: '2026-12-01' });
  assert.deepEqual(
    orderWorkTasks([discovered, terms, scope, dated], today).map((t) => t.id),
    ['z-dated', 'b-scope', 'a-terms', '0-discovered'],
  );
});
test('impact lists the downstream work this task unlocks and what else it still needs', () => {
  const a = task('a');
  const b = task('b');
  const onlyA = task('only-a', {
    dependencies: ['a'],
    displayState: 'blocked',
    blockers: [{ id: 'a', title: 'a' }],
  });
  const both = task('both', {
    dependencies: ['a', 'b'],
    displayState: 'blocked',
    blockers: [
      { id: 'a', title: 'a' },
      { id: 'b', title: 'b' },
    ],
  });
  const impact = taskImpact(a, [a, b, onlyA, both]);
  assert.deepEqual(impact.unlocked, [{ id: 'only-a', title: 'only-a' }]);
  assert.deepEqual(impact.remaining, [
    { id: 'both', title: 'both', blockers: [{ id: 'b', title: 'b' }] },
  ]);
});
test('work filters: invalid lane and state fall back, explicit empty state means all tasks', () => {
  assert.deepEqual(workFiltersFromQuery({}), defaultWorkFilters());
  assert.equal(workFiltersFromQuery({ state: '' }).state, '');
  assert.equal(workFiltersFromQuery({ state: 'bogus' }).state, 'actionable');
  assert.equal(workFiltersFromQuery({ lane: 'sales' }).lane, '');
  assert.equal(workFiltersFromQuery({ lane: 'compliance' }).lane, 'compliance');
});
