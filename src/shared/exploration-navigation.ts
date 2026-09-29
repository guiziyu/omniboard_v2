// 从 v1 src/modules/exploration-navigation.ts 迁移,内容保持一致。
import type { ExplorationNode } from './exploration';

/** Use stable identity/record IDs; a matching display name is never an identity decision. */
export function explorationDestination(node: ExplorationNode): string | undefined {
  if (node.kind === 'organization' && node.origin === 'organization') {
    const id = node.id.slice('organization:'.length);
    if (node.id.startsWith('organization:') && id)
      return `/w/internal/organizations/${encodeURIComponent(id)}/overview`;
  }
  if (node.kind !== 'person') return undefined;
  const person =
    node.origin === 'object'
      ? 'identity:' + node.id
      : node.origin === 'record' && node.recordIds.length === 1
        ? 'record:' + node.recordIds[0]
        : undefined;
  if (person) return '/w/internal/talent?person=' + encodeURIComponent(person);
}
