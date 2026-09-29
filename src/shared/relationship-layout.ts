// 从 v1 src/modules/relationship-layout.ts 迁移,内容保持一致。
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { ExplorationNode, ExplorationEdge } from './exploration';

export const graphCard = { width: 210, height: 94 };
export interface RelationshipLayout {
  nodes: { node: ExplorationNode; x: number; y: number }[];
  paths: { edge: ExplorationEdge; d: string; x: number; y: number }[];
  width: number;
  height: number;
}

const elk = new ELK();
export async function layoutRelationships(
  nodes: ExplorationNode[],
  edges: ExplorationEdge[],
): Promise<RelationshipLayout> {
  const ids = new Set(nodes.map((node) => node.id));
  const connections = edges.filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId));
  const result = await elk.layout<ElkNode>({
    id: 'relationships',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=32,left=32,bottom=32,right=32]',
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '105',
      'elk.layered.spacing.edgeNodeBetweenLayers': '22',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.randomSeed': '1',
    },
    children: nodes.map((node) => ({ id: node.id, ...graphCard })),
    edges: connections.map((edge) => ({
      id: edge.id,
      sources: [edge.fromId],
      targets: [edge.toId],
    })),
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map(connections.map((edge) => [edge.id, edge]));
  return {
    nodes: (result.children || []).map((node) => ({
      node: byId.get(node.id)!,
      x: node.x || 0,
      y: node.y || 0,
    })),
    paths: (result.edges || []).flatMap((routed) => {
      const edge = edgeById.get(routed.id)!;
      const sections = routed.sections || [];
      if (!sections.length) return [];
      const points = sections.flatMap((section) => [
        section.startPoint,
        ...(section.bendPoints || []),
        section.endPoint,
      ]);
      // Use the longest segment for the single active label. Other labels stay in the list.
      let anchor = points[0]!,
        longest = -1;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > longest) {
          longest = length;
          anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }
      return [
        {
          edge,
          d: sections
            .map((section) =>
              [section.startPoint, ...(section.bendPoints || []), section.endPoint]
                .map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`)
                .join(' '),
            )
            .join(' '),
          x: anchor.x,
          y: anchor.y,
        },
      ];
    }),
    width: Math.max(320, result.width || 0),
    height: Math.max(260, result.height || 0),
  };
}
