// 最近筛选自动记忆的键(frontend-spec 2.11),从 v1 src/modules/filter-preferences.ts 迁移。
// Only filters belong in preferences. Selected records, tasks and pages are navigation state.
export const rememberedFilterKeys = {
  work: ['organizationId', 'ownerId', 'lane', 'state', 'search', 'layout'],
  organizations: ['tag', 'sort', 'direction', 'unit', 'year', 'basis', 'columns', 'q'],
  talent: ['q', 'organizationId', 'duplicates', 'contact', 'sort'],
} as const;
export type FilterScope = keyof typeof rememberedFilterKeys;
export function filterPreferenceKey(userId: string, scope: FilterScope) {
  return `omniboard.last-filters.${userId}.${scope}`;
}
export function filterValues(scope: FilterScope, input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const values = input as Record<string, unknown>;
  return Object.fromEntries(
    rememberedFilterKeys[scope].flatMap((key) =>
      typeof values[key] === 'string' && values[key].length <= 1000 ? [[key, values[key]]] : [],
    ),
  );
}
export const defaultWorkFilters = () => ({
  organizationId: '',
  ownerId: '',
  lane: '',
  state: 'actionable',
  search: '',
});
export function workFiltersFromQuery(query: Record<string, unknown>) {
  const input = filterValues('work', query);
  return {
    organizationId: input.organizationId || '',
    ownerId: input.ownerId || '',
    search: input.search || '',
    lane: ['', 'business', 'engineering', 'compliance', 'research'].includes(input.lane || '')
      ? input.lane || ''
      : '',
    state: [
      '',
      'actionable',
      'open',
      'ready',
      'active',
      'waiting',
      'blocked',
      'done',
      'skipped',
    ].includes(input.state ?? 'actionable')
      ? (input.state ?? 'actionable')
      : 'actionable',
  };
}
