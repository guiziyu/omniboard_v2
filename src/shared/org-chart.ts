// 从 v1 src/modules/org-chart.ts 迁移,内容保持一致。
import type { ModuleRecord } from './types';
export const cardWidth = 232;
export const cardHeight = 184;
const horizontalGap = 32;
const verticalGap = 76;
export function descendants(records: Pick<ModuleRecord, 'id' | 'reportsTo'>[], id: string) {
  const found = new Set<string>([id]);
  const children = new Map<string, string[]>();
  for (const record of records) {
    const list = children.get(record.reportsTo) || [];
    list.push(record.id);
    children.set(record.reportsTo, list);
  }
  const queue = [id];
  while (queue.length)
    for (const child of children.get(queue.pop()!) || []) {
      if (!found.has(child)) {
        found.add(child);
        queue.push(child);
      }
    }
  return found;
}
export function layoutChart(records: ModuleRecord[], collapsed: Set<string>) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const children = new Map<string, ModuleRecord[]>();
  for (const record of records) {
    const parent =
      byId.has(record.reportsTo) && record.reportsTo !== record.id ? record.reportsTo : '';
    const list = children.get(parent) || [];
    list.push(record);
    children.set(parent, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.personName.localeCompare(b.personName, 'en') || a.id.localeCompare(b.id));
  const widths = new Map<string, number>();
  const visiting = new Set<string>();
  function measure(record: ModuleRecord): number {
    if (visiting.has(record.id)) return cardWidth;
    visiting.add(record.id);
    const list = collapsed.has(record.id) ? [] : children.get(record.id) || [];
    const width = Math.max(
      cardWidth,
      list.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, list.length - 1) * horizontalGap,
    );
    widths.set(record.id, width);
    visiting.delete(record.id);
    return width;
  }
  const roots = children.get('') || [];
  roots.forEach(measure);
  const nodes: { record: ModuleRecord; x: number; y: number; childCount: number }[] = [];
  const edges: {
    id: string;
    parentId: string;
    kind: ModuleRecord['relationshipKind'];
    path: string;
  }[] = [];
  const placed = new Set<string>();
  function place(record: ModuleRecord, left: number, depth: number) {
    if (placed.has(record.id)) return;
    placed.add(record.id);
    const x = left + (widths.get(record.id)! - cardWidth) / 2;
    const y = 24 + depth * (cardHeight + verticalGap);
    const list = children.get(record.id) || [];
    nodes.push({ record, x, y, childCount: list.length });
    if (collapsed.has(record.id)) return;
    let next = left;
    for (const child of list) {
      const childX = next + (widths.get(child.id)! - cardWidth) / 2;
      const childY = y + cardHeight + verticalGap;
      const fromX = x + cardWidth / 2,
        toX = childX + cardWidth / 2,
        midY = y + cardHeight + verticalGap / 2;
      edges.push({
        id: child.id,
        parentId: record.id,
        kind: child.relationshipKind,
        path: `M ${fromX} ${y + cardHeight} V ${midY} H ${toX} V ${childY}`,
      });
      place(child, next, depth + 1);
      next += widths.get(child.id)! + horizontalGap;
    }
  }
  let left = 24;
  for (const root of roots) {
    place(root, left, 0);
    left += widths.get(root.id)! + horizontalGap;
  }
  return {
    nodes,
    edges,
    width: Math.max(cardWidth + 48, left - horizontalGap + 24),
    height: Math.max(cardHeight + 48, ...nodes.map((n) => n.y + cardHeight + 32)),
  };
}
