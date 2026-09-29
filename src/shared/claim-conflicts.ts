// 从 v1 src/modules/claim-conflicts.ts 迁移,内容保持一致。
import type { KnowledgeClaim } from './operations';

type ComparableClaim = Pick<
  KnowledgeClaim,
  'id' | 'objectId' | 'field' | 'scope' | 'value' | 'current' | 'organizationId'
>;
// Exact scope matching is intentional. Different spellings are not inferred to be equivalent.
// JSON tuples avoid collisions when user-authored fields contain separators.
const keyOf = (c: ComparableClaim) =>
  JSON.stringify([c.objectId, c.organizationId || '', c.field, c.scope]);

export function conflictingClaimIds(claims: readonly ComparableClaim[]): Set<string> {
  const groups = new Map<string, { value: string; conflict: boolean }>();
  for (const claim of claims) {
    if (!claim.current) continue;
    const key = keyOf(claim);
    const group = groups.get(key);
    if (group) group.conflict ||= group.value !== claim.value;
    else groups.set(key, { value: claim.value, conflict: false });
  }
  return new Set(
    claims.filter((c) => c.current && groups.get(keyOf(c))?.conflict).map((c) => c.id),
  );
}
