// 岗位目标与激励的输入规则(frontend-spec 6.16),从 v1 src/modules/position-drivers.ts 迁移;
// rawId / attachmentId 改名 evidenceId / attachmentEvidenceId。
import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.union([z.iso.date(), z.literal('')]).default('');
export const driverKinds = ['okr', 'kpi', 'incentive'] as const;
export const driverKindLabels = { okr: 'OKR', kpi: 'KPI', incentive: 'Incentive' };
export const driverBasisLabels = {
  contact_report: 'Reported by contact',
  team_report: 'Reported by team',
  document: 'Source document',
  public_source: 'Public source',
};
export const driverTargetSchema = z
  .object({
    audience: text(300),
    metric: text(200),
    comparison: z.enum(['increase_by', 'at_least', 'at_most', 'equals']),
    value: z.number().finite().nonnegative(),
    unit: optionalText(60),
    baseline: optionalText(300),
  })
  .strict();
export const positionDriverDataSchema = z
  .object({
    kind: z.enum(driverKinds),
    title: text(160),
    summary: text(4000),
    applicability: z.enum(['personal', 'role_policy', 'unknown']),
    pressure: z.enum(['unknown', 'none_reported', 'target_reported']).default('unknown'),
    period: optionalText(100),
    observedOn: z.iso.date(),
    validUntil: date,
    state: z.enum(['active', 'retired']).default('active'),
    basis: z.enum(['contact_report', 'team_report', 'document', 'public_source']),
    attribution: text(300),
    uncertainty: optionalText(4000),
    targets: z.array(driverTargetSchema).max(10).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.validUntil && v.validUntil < v.observedOn)
      ctx.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'Review date must not precede observation date.',
      });
    if (v.pressure === 'none_reported' && v.targets.length)
      ctx.addIssue({
        code: 'custom',
        path: ['targets'],
        message: 'A no-target report cannot include numeric targets.',
      });
  });
export const positionDriverInputSchema = z
  .object({
    data: positionDriverDataSchema,
    rawText: z
      .string()
      .min(1)
      .max(100000)
      .refine((v) => !!v.trim()),
    sourceUrl: z
      .string()
      .max(2000)
      .default('')
      .refine((v) => !v || (/^https?:\/\//.test(v) && URL.canParse(v))),
    attachment: z
      .object({
        filename: text(200),
        base64: z
          .string()
          .max(7000000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .strict()
      .optional(),
    revision: z.number().int().positive().optional(),
  })
  .strict();
export type PositionDriverData = z.infer<typeof positionDriverDataSchema>;
export type DriverTarget = z.infer<typeof driverTargetSchema>;
export interface PositionDriver extends PositionDriverData {
  id: string;
  positionId: string;
  personName: string;
  roleTitle: string;
  organizationId: string;
  organizationName: string;
  revision: number;
  evidenceId: string;
  attachmentEvidenceId: string | null;
  updatedAt: string;
}
export function driverReviewState(driver: PositionDriverData, today: string) {
  return driver.state === 'retired'
    ? 'Retired'
    : driver.validUntil && driver.validUntil < today
      ? 'Review due'
      : 'Reported';
}
