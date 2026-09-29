import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictingClaimIds } from '../src/shared/claim-conflicts';
import { groupContacts } from '../src/shared/contact-groups';
import { explorationDestination } from '../src/shared/exploration-navigation';
import { claimGroups } from '../src/shared/exploration-model';
import {
  relationshipView,
  relationshipCanvas,
  relationshipFocus,
  relationshipKinds,
} from '../src/shared/relationship-view';
import { layoutRelationships, graphCard } from '../src/shared/relationship-layout';
import { movementTransition, movementType } from '../src/shared/people-movements';
import { validateMovementDate } from '../src/shared/movement-date';
import type { ExplorationNode, ExplorationEdge } from '../src/shared/exploration';
import type { KnowledgeClaim, KnowledgeObject } from '../src/shared/operations';
import type { ModuleRecord } from '../src/shared/types';
// 关系图谱的纯逻辑(frontend-spec 7.4–7.7、7.12)。v1 tests/claim-conflicts、exploration-navigation、
// relationship-view、contact-groups 与 exploration(claimGroups)的断言逐条保留;rawId 改名 evidenceId。

test('conflicts preserve exact scope, object identity, duplicates and validity', () => {
  const c = (id: string, value: string, overrides = {}) => ({
    id,
    value,
    objectId: 'org:a',
    field: 'rate',
    scope: 'spot',
    current: true,
    ...overrides,
  });
  const rows = [
    c('a', '1'),
    c('duplicate', '1'),
    c('different', '2'),
    c('expired', '3', { current: false }),
    c('elsewhere', '4', { objectId: 'org:b' }),
    c('other-scope', '5', { scope: 'futures' }),
    c('case', '6', { field: 'Rate' }),
    c('separator-a', '7', { objectId: 'a:b', field: 'c' }),
    c('separator-b', '8', { objectId: 'a', field: 'b:c' }),
  ];
  assert.deepEqual([...conflictingClaimIds(rows)].sort(), ['a', 'different', 'duplicate']);
});
test('grouped conflicts match the pairwise definition across varied datasets', () => {
  let seed = 41;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const rows = Array.from({ length: 800 }, (_, i) => ({
    id: String(i),
    objectId: String(random(15)),
    field: String(random(4)),
    scope: String(random(6)),
    value: String(random(3)),
    current: random(5) !== 0,
  }));
  const expected = rows
    .filter(
      (a) =>
        a.current &&
        rows.some(
          (b) =>
            a.id !== b.id &&
            b.current &&
            a.objectId === b.objectId &&
            a.field === b.field &&
            a.scope === b.scope &&
            a.value !== b.value,
        ),
    )
    .map((c) => c.id);
  assert.deepEqual([...conflictingClaimIds(rows)], expected);
  assert.equal(
    conflictingClaimIds(
      Array.from({ length: 20000 }, (_, i) => ({
        id: String(i),
        objectId: String(i),
        field: 'rate',
        scope: 'spot',
        value: '1',
        current: true,
      })),
    ).size,
    0,
  );
});

const person: ExplorationNode = {
  id: 'person-record:position-1',
  name: 'Same Name',
  kind: 'person',
  origin: 'object',
  scope: '',
  recordIds: ['position-1', 'movement-2'],
  visibility: 'team',
};
test('graph links preserve exact shared identities and use record profiles only for unlinked people', () => {
  assert.equal(
    explorationDestination(person),
    '/w/internal/talent?person=identity%3Aperson-record%3Aposition-1',
  );
  assert.equal(
    explorationDestination({ ...person, id: 'another-identity' }),
    '/w/internal/talent?person=identity%3Aanother-identity',
  );
  assert.equal(
    explorationDestination({
      ...person,
      origin: 'record',
      id: 'record:movement-2',
      recordIds: ['movement-2'],
    }),
    '/w/internal/talent?person=record%3Amovement-2',
  );
  assert.equal(explorationDestination({ ...person, origin: 'record' }), undefined);
});
test('only actual organization/person nodes offer profile navigation', () => {
  assert.equal(
    explorationDestination({
      ...person,
      origin: 'organization',
      kind: 'organization',
      id: 'organization:org-1',
    }),
    '/w/internal/organizations/org-1/overview',
  );
  for (const kind of ['account', 'capability', 'resource', 'record'] as const)
    assert.equal(explorationDestination({ ...person, kind }), undefined);
  assert.equal(
    explorationDestination({
      ...person,
      origin: 'organization',
      kind: 'organization',
      id: 'organization:',
    }),
    undefined,
  );
});

const node = (
  id: string,
  kind: ExplorationNode['kind'],
  origin: ExplorationNode['origin'] = 'object',
): ExplorationNode => ({
  id,
  name: id,
  kind,
  origin,
  scope: '',
  recordIds: [],
  visibility: 'team',
});
const edge = (
  id: string,
  fromId: string,
  toId: string,
  kind: ExplorationEdge['kind'] = 'context',
  current = true,
): ExplorationEdge => ({
  id,
  fromId,
  toId,
  kind,
  current,
  label: id,
  certainty: 'unconfirmed',
  evidenceId: 'evidence-' + id,
  validFrom: '',
  validUntil: '',
});
const nodes = [
  node('org', 'organization', 'organization'),
  node('manager', 'person', 'record'),
  node('person', 'person', 'record'),
  node('other', 'person'),
  node('source', 'record', 'record'),
  node('onboarding', 'resource', 'record'),
  node('account', 'account'),
  node('old', 'person'),
  node('other-org', 'organization', 'organization'),
];
const edges = [
  edge('a', 'org', 'manager'),
  edge('b', 'org', 'person'),
  edge('c', 'org', 'other'),
  edge('d', 'org', 'source'),
  edge('e', 'org', 'onboarding'),
  edge('f', 'org', 'account'),
  edge('reports', 'person', 'manager', 'reporting'),
  edge('old-role', 'manager', 'old', 'relationship', false),
  edge('cross-org', 'other-org', 'manager'),
];
const options = {
  depth: 1,
  historical: false,
  kinds: [...relationshipKinds],
  sources: false,
  limit: 24,
};

test('organization canvas separates source associations without dropping or verifying them', () => {
  const view = relationshipView(nodes, edges, 'org', options);
  const canvas = relationshipCanvas(view.nodes, view.edges, 'org', false);
  assert.deepEqual(canvas.nodes.map((n) => n.id).sort(), ['manager', 'person']);
  assert.ok(canvas.associated.some((n) => n.id === 'account'));
  assert.ok(canvas.edges.every((e) => e.kind !== 'context' && e.certainty === 'unconfirmed'));
  assert.equal(
    relationshipCanvas(view.nodes, view.edges, 'org', true).nodes.length,
    view.nodes.length,
  );
  const identityView = relationshipView(nodes, edges, 'manager', options);
  assert.ok(
    relationshipCanvas(identityView.nodes, identityView.edges, 'manager', false).edges.some(
      (e) => e.id === 'cross-org',
    ),
  );
});

test('graph folds incidental evidence, preserves business entities and explicitly selected records', () => {
  const view = relationshipView(nodes, edges, 'org', options);
  assert.equal(view.foldedSources, 2);
  assert.ok(!view.nodes.some((n) => ['source', 'onboarding'].includes(n.id)));
  assert.ok(view.nodes.some((n) => n.id === 'account'));
  assert.ok(
    view.edges.some(
      (e) =>
        e.id === 'reports' && e.certainty === 'unconfirmed' && e.evidenceId === 'evidence-reports',
    ),
  );
  assert.ok(
    relationshipView(nodes, edges, 'org', { ...options, sources: true }).nodes.some(
      (n) => n.id === 'source',
    ),
  );
  assert.ok(relationshipView(nodes, edges, 'source', options).nodes.some((n) => n.id === 'source'));
  const connectedEvidence = relationshipView(
    nodes,
    [...edges, edge('explicit', 'manager', 'source', 'relationship')],
    'org',
    options,
  );
  assert.ok(
    connectedEvidence.nodes.some((n) => n.id === 'source'),
    'Evidence that is an explicit relation endpoint must remain explorable',
  );
});

test('type filters and history preserve scope boundaries and never merge matching names', () => {
  const named = nodes.map((n) =>
    ['person', 'other'].includes(n.id) ? { ...n, name: 'Same name' } : n,
  );
  const view = relationshipView(named, edges, 'org', {
    ...options,
    kinds: ['person', 'organization'],
  });
  assert.equal(view.nodes.filter((n) => n.name === 'Same name').length, 2);
  assert.ok(!view.nodes.some((n) => n.id === 'account'));
  assert.equal(view.counts.account, 1, 'Counts remain available for collapsed branches');
  const local = relationshipView(nodes, edges, 'person', { ...options, depth: 2 });
  assert.ok(local.nodes.some((n) => n.id === 'other-org'));
  assert.ok(
    !local.nodes.some((n) => n.id === 'other'),
    'Do not fan out through an organization hub',
  );
  assert.ok(!local.nodes.some((n) => n.id === 'old'));
  assert.ok(
    relationshipView(nodes, edges, 'person', { ...options, depth: 2, historical: true }).edges.some(
      (e) => e.id === 'old-role' && !e.current,
    ),
  );
  const limited = relationshipView(nodes, edges, 'org', { ...options, limit: 2 });
  assert.equal(limited.nodes.length, 2);
  assert.ok(limited.total > 2);
  assert.ok(
    limited.edges.every(
      (e) =>
        limited.nodes.some((n) => n.id === e.fromId) && limited.nodes.some((n) => n.id === e.toId),
    ),
  );
});

test('focus traces exactly one relationship or one immediate neighborhood', () => {
  const selected = relationshipFocus(edges, undefined, 'reports');
  assert.deepEqual([...selected.nodes].sort(), ['manager', 'person']);
  assert.deepEqual([...selected.edges], ['reports']);
  const hovered = relationshipFocus(edges, 'person');
  assert.ok(hovered.nodes.has('manager') && hovered.nodes.has('org'));
  assert.ok(!hovered.nodes.has('other'));
});

test('capped views retain business relationships before incidental source records', () => {
  const view = relationshipView(
    nodes.map((n) => ({ ...n, name: n.id === 'source' ? 'AAA' : n.name })),
    edges,
    'org',
    { ...options, sources: true, limit: 3 },
  );
  assert.ok(view.edges.some((edge) => edge.id === 'reports'));
  assert.ok(view.total > view.nodes.length);
});

test('layout avoids overlapping cards, routes parallel links separately and preserves direction', async () => {
  const fixture = [
    node('a', 'person'),
    node('b', 'person'),
    node('c', 'account'),
    node('d', 'person'),
  ];
  const links = [
    edge('ab1', 'a', 'b', 'reporting'),
    edge('ab2', 'a', 'b', 'relationship'),
    edge('bc', 'b', 'c', 'relationship'),
    edge('ca', 'c', 'a', 'relationship'),
    edge('self', 'd', 'd', 'relationship'),
  ];
  const arranged = await layoutRelationships(fixture, links);
  assert.equal(arranged.paths.length, links.length);
  assert.equal(new Set(arranged.paths.map((p) => p.d)).size, links.length);
  for (const a of arranged.nodes)
    for (const b of arranged.nodes) {
      if (a === b) continue;
      assert.ok(
        a.x + graphCard.width <= b.x ||
          b.x + graphCard.width <= a.x ||
          a.y + graphCard.height <= b.y ||
          b.y + graphCard.height <= a.y,
        'Cards must not overlap',
      );
    }
  for (const path of arranged.paths) {
    assert.ok(!/NaN|undefined/.test(path.d));
    assert.equal(path.edge.fromId, links.find((e) => e.id === path.edge.id)!.fromId);
    assert.ok(Number.isFinite(path.x) && Number.isFinite(path.y));
  }
});

test('evidence comparison groups by object, exact field and scope; movement details preserve unknowns', () => {
  const claim: KnowledgeClaim = {
    id: 'a',
    objectId: 'one',
    field: 'API permission',
    value: 'read',
    scope: 'spot',
    validFrom: '',
    validUntil: '',
    observedOn: '',
    recordedAt: '2026-01-01',
    status: 'reported',
    current: true,
    conflict: false,
    evidenceId: 'raw',
    sourceRecordId: '',
    revision: 1,
  };
  const groups = claimGroups([
    claim,
    { ...claim, id: 'b', value: 'trade' },
    { ...claim, id: 'c', objectId: 'two' },
    { ...claim, id: 'd', scope: 'futures' },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find((g) => g.objectId === 'one' && g.scope === 'spot')?.claims.length, 2);
  const record = { eventType: 'left', structured: {} } as ModuleRecord;
  assert.deepEqual(movementTransition(record, 'Fixture org'), {
    fromOrganization: 'Fixture org',
    toOrganization: '',
    fromRole: '',
    toRole: '',
  });
  assert.equal(
    movementTransition({ ...record, eventType: 'joined' }, 'Fixture org').fromOrganization,
    '',
  );
  assert.equal(movementType('role_change').label, 'Role change');
  assert.equal(movementType('unexpected').label, 'Type not recorded');
  assert.equal(
    movementTransition({ ...record, eventType: '' }, 'Fixture org').fromOrganization,
    '',
  );
  assert.equal(
    movementTransition(
      { ...record, eventType: '', structured: { toOrganization: 'Other org' } },
      'Fixture org',
    ).toOrganization,
    'Other org',
  );
  const metadata = validateMovementDate('2026-04', {
    fromRole: 'Analyst',
    toRole: 'Lead',
    eventDatePrecision: 'month',
  });
  assert.equal(metadata.fromRole, 'Analyst');
  assert.equal(metadata.toRole, 'Lead');
  assert.equal(metadata.eventDatePrecision, 'month');
  assert.throws(() => validateMovementDate('', { fromRole: 'x'.repeat(201) }));
});

test('contact cards use shared identity, preserve source records and never merge names alone', () => {
  const records = ['a', 'b', 'c'].map((id) => ({ id, personName: 'Same Name' }) as ModuleRecord);
  const objects = [
    { id: 'person:1', kind: 'person', records: [{ id: 'a' }, { id: 'b' }] },
  ] as KnowledgeObject[];
  const groups = groupContacts(records, objects);
  assert.deepEqual(
    groups.map((g) => g.records.map((r) => r.id)),
    [['a', 'b'], ['c']],
  );
  assert.equal(groupContacts(records, []).length, 3);
  assert.equal(groups[0]!.records[0], records[0]);
  assert.equal(groupContacts(records.slice(1), objects)[0]!.records.length, 1);
});
