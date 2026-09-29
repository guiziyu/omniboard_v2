import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterValues,
  filterPreferenceKey,
  workFiltersFromQuery,
  defaultWorkFilters,
} from '../src/shared/filter-preferences';
test('filter preferences exclude selected objects, task actions and paging, and isolate users and pages', () => {
  assert.deepEqual(
    filterValues('work', {
      organizationId: 'org',
      ownerId: 'person',
      task: 'private-task',
      sourceRecord: 'private-source',
      record: 'record',
      page: '7',
      layout: 'board',
    }),
    { organizationId: 'org', ownerId: 'person', layout: 'board' },
  );
  assert.deepEqual(
    filterValues('organizations', {
      tag: 'bank',
      columns: 'revenue',
      person: 'person',
      task: 'task',
      object: 'object',
      page: '2',
    }),
    { tag: 'bank', columns: 'revenue' },
  );
  assert.deepEqual(filterValues('talent', { q: 'Ada', person: 'person', tag: 'bank' }), {
    q: 'Ada',
  });
  assert.notEqual(filterPreferenceKey('a', 'work'), filterPreferenceKey('b', 'work'));
  assert.notEqual(filterPreferenceKey('a', 'work'), filterPreferenceKey('a', 'talent'));
});
test('malformed stored preferences fail safely and explicit all-task filters remain meaningful', () => {
  for (const input of [null, [], 'bad', 3]) assert.deepEqual(filterValues('work', input), {});
  assert.deepEqual(
    filterValues('work', { search: ['bad'], ownerId: null, state: '', layout: 'x'.repeat(1001) }),
    { state: '' },
  );
  assert.deepEqual(
    workFiltersFromQuery({ state: 'unknown', lane: 'unknown' }),
    defaultWorkFilters(),
  );
  assert.equal(workFiltersFromQuery({ state: '' }).state, '');
  assert.equal(
    workFiltersFromQuery({ state: 'blocked', organizationId: 'linked-org' }).organizationId,
    'linked-org',
  );
});
