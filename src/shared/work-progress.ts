// 接入记录的商务与技术进度(frontend-spec 4.8、10.9),从 v1 src/modules/work-progress.ts 迁移。
import type { ModuleRecord } from './types';
import type { WorkRequest } from './integration';

export type ProgressState = { value: string; label: string; tone: string; hint: string };
export const businessSteps = [
  { value: 'requested', label: 'Requested' },
  { value: 'negotiating', label: 'In discussion' },
  { value: 'granted', label: 'Access granted' },
];
export const technicalSteps = [
  { value: 'docs_only', label: 'Docs reviewed' },
  { value: 'implemented', label: 'Code available' },
  { value: 'unit_tested', label: 'Code tested' },
  { value: 'sandbox_verified', label: 'Test account' },
  { value: 'production_verified', label: 'Live account' },
];
export function expiryPassed(record: ModuleRecord, asOf: string): boolean {
  const date = record.structured.expiresOn || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < asOf.slice(0, 10);
}
export function businessProgress(record: ModuleRecord, asOf: string): ProgressState {
  const value = record.structured.resourceStage || 'unknown';
  if (value === 'granted' && expiryPassed(record, asOf))
    return {
      value: 'expiry_review',
      label: 'Expiry needs review',
      tone: 'pending',
      hint: `Access was recorded as granted, but the review or access expiry date (${record.structured.expiresOn}) has passed. Confirm whether it is still valid.`,
    };
  const states: Record<string, Omit<ProgressState, 'value'>> = {
    unknown: {
      label: 'Access not confirmed',
      tone: 'neutral',
      hint: 'No approval is recorded for this resource and account.',
    },
    requested: {
      label: 'Access requested',
      tone: 'progress',
      hint: 'A request is recorded; approval has not been recorded.',
    },
    negotiating: {
      label: 'Terms in discussion',
      tone: 'progress',
      hint: 'Commercial terms or access conditions are being discussed.',
    },
    granted: {
      label: 'Access recorded as granted',
      tone: 'complete',
      hint: 'Approval is recorded for this scope. Technical testing is tracked separately.',
    },
    expired: {
      label: 'Access expired',
      tone: 'blocked',
      hint: 'This resource is recorded as expired.',
    },
    rejected: {
      label: 'Request declined',
      tone: 'blocked',
      hint: 'The provider declined this request.',
    },
  };
  return { value: states[value] ? value : 'unknown', ...(states[value] || states.unknown!) };
}
export function technicalProgress(record: ModuleRecord): ProgressState {
  const value = record.structured.integrationStage || 'unknown';
  const states: Record<string, Omit<ProgressState, 'value'>> = {
    unknown: {
      label: 'Progress not recorded',
      tone: 'neutral',
      hint: 'No connection stage is recorded for this scope.',
    },
    docs_only: {
      label: 'Documentation reviewed',
      tone: 'progress',
      hint: 'The API documentation has been reviewed.',
    },
    implemented: {
      label: 'Code available · tests not recorded',
      tone: 'progress',
      hint: 'Connection code is available. Build, account and live checks have not been recorded.',
    },
    unit_tested: {
      label: 'Automated code tests passed',
      tone: 'progress',
      hint: 'Code tests passed. Provider account access still needs checking.',
    },
    sandbox_verified: {
      label: 'Test account verified',
      tone: 'ready',
      hint: 'Testing is recorded for a test account. Live account verification is a separate step.',
    },
    production_verified: {
      label: 'Live account verified',
      tone: 'complete',
      hint: 'A live connection check is recorded for this scope. This does not activate trading.',
    },
  };
  return { value: states[value] ? value : 'unknown', ...(states[value] || states.unknown!) };
}
export function recordNeedsAttention(
  record: ModuleRecord,
  requests: readonly Pick<WorkRequest, 'recordId' | 'state' | 'blockers'>[],
  asOf: string,
) {
  return (
    ['expired', 'rejected', 'expiry_review'].includes(businessProgress(record, asOf).value) ||
    requests.some(
      (request) =>
        request.recordId === record.id &&
        (request.state === 'failed' || request.blockers.length > 0),
    )
  );
}
export const trackOwner = (record: ModuleRecord, track: 'business' | 'technical') =>
  record.structured[track === 'business' ? 'businessOwner' : 'technicalOwner'] || '';

// Display substitutions for known imported boilerplate only; original notes remain intact.
export function workScope(record: ModuleRecord): string {
  const product = record.structured.product;
  return product === 'Product, account, entity and environment to confirm'
    ? 'Account and product scope not confirmed'
    : product || record.title;
}
export function contactRolePreview(role: string): string {
  return role.split(' Suggested outreach purpose (inferred):')[0]!.replace(/^Published role: /, '');
}
