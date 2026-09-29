// 从 v1 src/modules/record-summary.ts 迁移,内容保持一致。
import type { ModuleRecord } from './types';

/** Business meaning comes only from structured fields, never guessed from prose or review status. */
export function recordBusinessState(record: Pick<ModuleRecord, 'tabId' | 'structured'>) {
  const s = record.structured;
  if (record.tabId === 'contacts')
    return { field: 'relationship', value: s.relationship || 'unknown' };
  if (record.tabId === 'compliance') return { field: 'decision', value: s.decision || 'unknown' };
  if (record.tabId === 'api_optimization')
    return { field: 'entitlement', value: s.entitlement || 'unknown' };
  return { field: 'sourceKind', value: s.sourceKind || 'unknown' };
}
export const summaryFields: Record<string, string[]> = {
  api_optimization: ['product', 'accountModel', 'intervalMs', 'entitlement'],
  capital_optimization: ['product', 'vipTier', 'holdingMethod', 'borrowAprBps'],
  tech_stack: ['cloud', 'region', 'zoneId', 'instanceType'],
  compliance: ['jurisdiction', 'legalEntity', 'product', 'effectiveOn'],
  services: ['coverage', 'delivery'],
  market_access: ['coverage', 'delivery'],
  payments: ['coverage', 'delivery'],
  custody: ['coverage', 'delivery'],
  data_coverage: ['coverage', 'delivery'],
  infrastructure: ['coverage', 'delivery'],
};
export function contactGroup(record: Pick<ModuleRecord, 'personName' | 'structured'>) {
  if (record.personName.trim()) return 'People';
  return record.structured.relationship === 'public_channel'
    ? 'Official channels'
    : 'Team channels';
}
export function reviewDue(record: Pick<ModuleRecord, 'structured'>, today: string) {
  const expires = record.structured.expiresOn;
  return !!expires && expires < today;
}

/** Intelligence is read as a sourced note; optional attributes are supporting detail. */
export function isNarrativeIntelligence(tab: string) {
  return ['api_optimization', 'capital_optimization', 'tech_stack'].includes(tab);
}
export function hasRecordedValue(value: string | undefined) {
  return (
    !!value?.trim() &&
    !['unknown', 'not_recorded', 'unverified'].includes(value.trim().toLowerCase())
  );
}
