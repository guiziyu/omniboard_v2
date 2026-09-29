// 从 v1 src/modules/roadmap.ts 迁移,内容保持一致。
import type { ModuleRecord } from './types';

export const roadmapTypes = {
  organization: 'Organization plans',
  collaboration: 'Our collaboration',
};
export const roadmapStates = {
  planned: { label: 'Planned', icon: 'clock' },
  in_progress: { label: 'In progress', icon: 'refresh' },
  on_hold: { label: 'On hold', icon: 'lock' },
  delivered: { label: 'Delivered', icon: 'check' },
  cancelled: { label: 'Cancelled', icon: 'close' },
};

/** Bounds are for ordering and elapsed-window checks; display preserves source precision. */
export function roadmapPeriod(value: string): { start: string; end: string } | undefined {
  if (!/^\d{4}(?:-Q[1-4]|-\d{2}(?:-\d{2})?)?$/.test(value)) return;
  const year = Number(value.slice(0, 4));
  if (year < 1000 || year > 9999) return;
  if (value.length === 4) return { start: value + '-01-01', end: value + '-12-31' };
  const quarter = value.includes('-Q');
  const month = quarter ? (Number(value.slice(-1)) - 1) * 3 + 1 : Number(value.slice(5, 7));
  if (month < 1 || month > 12) return;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  if (value.length === 10) {
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return;
    return { start: value, end: value };
  }
  const endMonth = quarter ? month + 2 : month;
  const day = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return { start: prefix + '-01', end: `${year}-${String(endMonth).padStart(2, '0')}-${day}` };
}
export function roadmapFinished(record: Pick<ModuleRecord, 'structured'>) {
  return ['delivered', 'cancelled'].includes(record.structured.roadmapStatus || '');
}
export function roadmapWindowPassed(record: Pick<ModuleRecord, 'structured'>, today: string) {
  const period = roadmapPeriod(record.structured.targetPeriod || '');
  return !!period && !roadmapFinished(record) && period.end < today;
}
export function compareRoadmap(
  a: Pick<ModuleRecord, 'id' | 'title' | 'structured'>,
  b: Pick<ModuleRecord, 'id' | 'title' | 'structured'>,
) {
  const aDate = roadmapPeriod(a.structured.targetPeriod || '')?.start || '9999-99-99';
  const bDate = roadmapPeriod(b.structured.targetPeriod || '')?.start || '9999-99-99';
  return aDate.localeCompare(bDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}
