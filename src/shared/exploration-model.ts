// 从 v1 src/modules/exploration.ts 迁移;rawId 改名 evidenceId,其余保持一致。
import type { ExplorationGraph, ExplorationNode, ExplorationEdge } from './exploration';
import type { KnowledgeClaim } from './operations';

/** Existing records are navigable context, not newly verified entities or identity matches. */
export function explorationModel(graph: ExplorationGraph) {
  const rootId = 'organization:' + graph.organization.id;
  const nodes: ExplorationNode[] = [
    {
      id: rootId,
      name: graph.organization.name,
      kind: 'organization',
      origin: 'organization',
      scope: 'Organization context',
      recordIds: graph.contextRecords
        .filter((r) => r.organizationId === graph.organization.id)
        .map((r) => r.id),
      visibility: 'team',
    },
  ];
  const edges: ExplorationEdge[] = [];
  const recordObjects = new Map<string, string[]>();
  for (const object of graph.objects) {
    nodes.push({ ...object, origin: 'object', recordIds: object.records.map((r) => r.id) });
    for (const record of object.records)
      recordObjects.set(record.id, [...(recordObjects.get(record.id) || []), object.id]);
    for (const org of object.organizations || [])
      if (!nodes.some((n) => n.id === 'organization:' + org.id))
        nodes.push({
          id: 'organization:' + org.id,
          name: org.name,
          kind: 'organization',
          origin: 'organization',
          scope: 'Organization context',
          recordIds: graph.contextRecords
            .filter((r) => r.organizationId === org.id)
            .map((r) => r.id),
          visibility: object.visibility,
        });
  }
  for (const record of graph.contextRecords) {
    if (recordObjects.has(record.id)) continue;
    const id = 'record:' + record.id;
    nodes.push({
      id,
      name: record.personName || record.title,
      kind: record.personName ? 'person' : record.tabId === 'onboarding' ? 'resource' : 'record',
      origin: 'record',
      scope: record.scope,
      recordIds: [record.id],
      recordContext: { tabId: record.tabId, title: record.title },
      visibility: record.visibility,
    });
    recordObjects.set(record.id, [id]);
  }
  for (const node of nodes.filter((n) => n.kind !== 'organization')) {
    const object = graph.objects.find((o) => o.id === node.id);
    const sourceOrg =
      graph.contextRecords.find((r) => node.recordIds.includes(r.id))?.organizationId ||
      graph.organization.id;
    for (const orgId of object?.organizations?.map((o) => o.id) || [sourceOrg])
      edges.push({
        id: 'context:' + orgId + ':' + node.id,
        fromId: 'organization:' + orgId,
        toId: node.id,
        label: 'Organization context',
        kind: 'context',
        certainty: 'unconfirmed',
        current: true,
        evidenceId: '',
        validFrom: '',
        validUntil: '',
      });
  }
  for (const relation of graph.relations) edges.push({ ...relation, kind: 'relationship' });
  for (const record of graph.contextRecords) {
    if (record.tabId !== 'org_chart' || !record.reportsTo) continue;
    const from = recordObjects.get(record.id),
      to = recordObjects.get(record.reportsTo);
    // A record linked to multiple entities needs a human to select the relevant entity.
    if (from?.length !== 1 || to?.length !== 1 || from[0] === to[0]) continue;
    edges.push({
      id: 'reporting:' + record.id,
      fromId: from[0]!,
      toId: to[0]!,
      label: 'Reports to',
      kind: 'reporting',
      certainty: record.relationshipKind,
      current: true,
      evidenceId: record.relationshipEvidenceId || record.evidenceId,
      validFrom: '',
      validUntil: '',
    });
  }
  return { rootId, nodes, edges };
}

export function explorationNeighborhood(
  nodes: ExplorationNode[],
  edges: ExplorationEdge[],
  selectedId: string,
  depth: number,
  includeHistory: boolean,
  limit = 32,
) {
  const visibleEdges = edges.filter((e) => includeHistory || e.current);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const distance = new Map<string, number>([[selectedId, 0]]);
  const adjacency = new Map<string, string[]>();
  for (const e of visibleEdges)
    for (const [a, b] of [
      [e.fromId, e.toId],
      [e.toId, e.fromId],
    ])
      adjacency.set(a!, [...(adjacency.get(a!) || []), b!]);
  for (let d = 0; d < depth; d++)
    for (const [id, level] of [...distance]) {
      if (level !== d || (d > 0 && byId.get(id)?.kind === 'organization')) continue;
      for (const neighbor of adjacency.get(id) || [])
        if (!distance.has(neighbor)) distance.set(neighbor, d + 1);
    }
  const businessDegree = new Map<string, number>();
  for (const edge of visibleEdges.filter((edge) => edge.kind !== 'context'))
    for (const id of [edge.fromId, edge.toId])
      businessDegree.set(id, (businessDegree.get(id) || 0) + 1);
  const ordered = nodes
    .filter((n) => distance.has(n.id))
    .sort(
      (a, b) =>
        distance.get(a.id)! - distance.get(b.id)! ||
        (businessDegree.get(b.id) || 0) - (businessDegree.get(a.id) || 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const shown = ordered.slice(0, Math.max(1, limit));
  const ids = new Set(shown.map((n) => n.id));
  return {
    nodes: shown.map((node) => ({ node })),
    edges: visibleEdges.filter((e) => ids.has(e.fromId) && ids.has(e.toId)),
    total: ordered.length,
  };
}

export function claimGroups(claims: KnowledgeClaim[]) {
  const groups = new Map<
    string,
    {
      key: string;
      objectId: string;
      field: string;
      scope: string;
      organizationName?: string;
      claims: KnowledgeClaim[];
      conflict: boolean;
    }
  >();
  for (const c of claims) {
    const key = JSON.stringify([c.objectId, c.organizationId || '', c.field, c.scope]);
    const group = groups.get(key) || {
      key,
      objectId: c.objectId,
      field: c.field,
      scope: c.scope,
      organizationName: c.organizationName,
      claims: [],
      conflict: false,
    };
    group.claims.push(c);
    group.conflict ||= c.conflict;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.conflict) - Number(a.conflict) || a.field.localeCompare(b.field),
  );
}
