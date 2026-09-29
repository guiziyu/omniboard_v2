// 从 v1 src/modules/movement-date.ts 迁移,内容保持一致。
import { z } from 'zod';
export const movementDateBasisSchema = z.enum(['announcement', 'effective', 'reported', 'unknown']);

export const movementDateSchema = z.string().refine((value) => {
  if (!value) return true;
  if (/^\d{4}$/.test(value)) return true;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}, 'Use YYYY-MM-DD, YYYY-MM, YYYY, or leave the date unknown.');

const metadataSchema = z
  .object({
    eventDatePrecision: z.enum(['day', 'month', 'year', 'unknown']).optional(),
    dateBasis: movementDateBasisSchema.optional(),
    dateLabel: z.string().trim().max(500).default(''),
    fromRole: z.string().trim().max(200).optional(),
    toRole: z.string().trim().max(200).optional(),
    fromOrganization: z.string().trim().max(200).optional(),
    toOrganization: z.string().trim().max(200).optional(),
    movementGroupId: z.string().trim().max(300).optional(),
  })
  .strict();
export function datePrecision(date: string): 'day' | 'month' | 'year' | 'unknown' {
  return !date ? 'unknown' : date.length === 4 ? 'year' : date.length === 7 ? 'month' : 'day';
}
export function validateMovementDate(date: string, input: unknown = {}): Record<string, string> {
  movementDateSchema.parse(date);
  const metadata = metadataSchema.parse(input);
  const precision = metadata.eventDatePrecision || datePrecision(date);
  if (precision !== datePrecision(date))
    throw Object.assign(new Error('Date precision must match the recorded date.'), {
      statusCode: 422,
    });
  return { ...metadata, eventDatePrecision: precision } as Record<string, string>;
}
export function movementDateLabel(date: string): string {
  return !date
    ? 'Date not published'
    : date.length === 4
      ? date + ' · Year only'
      : date.length === 7
        ? date + ' · Month only'
        : date;
}
export function compareMovementDates(
  a: { eventDate: string; id: string },
  b: { eventDate: string; id: string },
): number {
  // Known dates first; month-only entries follow exact days within that month.
  // The visible precision label prevents the grouping from implying an exact day.
  return (
    Number(!a.eventDate) - Number(!b.eventDate) ||
    b.eventDate.localeCompare(a.eventDate) ||
    a.id.localeCompare(b.id)
  );
}
