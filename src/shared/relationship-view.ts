// 从 v1 src/modules/relationship-view.ts 迁移,内容保持一致。
import type { ExplorationNode, ExplorationEdge } from './exploration';
import { explorationNeighborhood } from './exploration-model';

export const relationshipKinds = [
  'person',
  'organization',
  'account',
  'capability',
  'resource',
] as const;
export type RelationshipKind = (typeof relationshipKinds)[number];
export const isEvidenceNode = (node: ExplorationNode) =>
  node.origin === 'record' && node.kind !== 'person';

/** Organization membership is provenance context, not a business relationship. */
export function relationshipCanvas(
  nodes: ExplorationNode[],
  edges: ExplorationEdge[],
  selectedId: string,
  associations: boolean,
) {
  if (associations || nodes.find((node) => node.id === selectedId)?.kind !== 'organization')
    return { nodes, edges, associated: [] as ExplorationNode[] };
  const business = edges.filter((edge) => edge.kind !== 'context');
  const connected = new Set(business.flatMap((edge) => [edge.fromId, edge.toId]));
  return {
    nodes: nodes.filter((node) => connected.has(node.id)),
    edges: business,
    associated: nodes.filter((node) => node.id !== selectedId && !connected.has(node.id)),
  };
}

/** Filtering changes the view only. Context links never become verified business relations. */
export function relationshipView(
  nodes: ExplorationNode[],
  edges: ExplorationEdge[],
  selectedId: string,
  options: {
    depth: number;
    historical: boolean;
    kinds: readonly RelationshipKind[];
    sources: boolean;
    limit: number;
  },
) {
  const currentEdges = edges.filter((edge) => options.historical || edge.current);
  const businessEndpoints = new Set(
    currentEdges
      .filter((edge) => edge.kind !== 'context')
      .flatMap((edge) => [edge.fromId, edge.toId]),
  );
  const isFolded = (node: ExplorationNode) =>
    isEvidenceNode(node) && !businessEndpoints.has(node.id) && node.id !== selectedId;
  const available = explorationNeighborhood(
    nodes,
    currentEdges,
    selectedId,
    options.depth,
    true,
    nodes.length,
  );
  const counts = Object.fromEntries(
    relationshipKinds.map((kind) => [
      kind,
      available.nodes.filter(
        ({ node }) => node.id !== selectedId && node.kind === kind && !isFolded(node),
      ).length,
    ]),
  ) as Record<RelationshipKind, number>;
  const eligible = nodes.filter(
    (node) =>
      node.id === selectedId ||
      (isFolded(node)
        ? options.sources
        : node.kind === 'record' || options.kinds.includes(node.kind)),
  );
  const eligibleIds = new Set(eligible.map((node) => node.id));
  const selection = explorationNeighborhood(
    eligible,
    currentEdges.filter((edge) => eligibleIds.has(edge.fromId) && eligibleIds.has(edge.toId)),
    selectedId,
    options.depth,
    true,
    options.limit,
  );
  return {
    nodes: selection.nodes.map(({ node }) => node),
    edges: selection.edges,
    total: selection.total,
    counts,
    foldedSources: available.nodes.filter(({ node }) => isFolded(node)).length,
  };
}

/** Incident-edge focus, not transitive highlighting of the whole component. */
export function relationshipFocus(edges: ExplorationEdge[], nodeId?: string, edgeId?: string) {
  const relevant = edges.filter((edge) =>
    edgeId ? edge.id === edgeId : !!nodeId && (edge.fromId === nodeId || edge.toId === nodeId),
  );
  return {
    edges: new Set(relevant.map((edge) => edge.id)),
    nodes: new Set([
      ...(nodeId ? [nodeId] : []),
      ...relevant.flatMap((edge) => [edge.fromId, edge.toId]),
    ]),
  };
}
