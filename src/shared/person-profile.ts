// 个人履历的来源键与输入规则(frontend-spec 6.13),从 v1 src/modules/person-profile.ts 与
// src/shared/person-profile.ts 迁移;类型里的 rawId 改名 evidenceId。
import { z } from 'zod';
import { movementDateSchema } from './movement-date';

export function personSourceKey(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Use an HTTPS personal profile URL.');
  const host = url.hostname.toLowerCase();
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const match = /^\/in\/([^/]+)(?:\/.*)?$/.exec(url.pathname);
    if (!match) throw new Error('Use a LinkedIn personal profile URL, not a post or company page.');
    const key = decodeURIComponent(match[1]!).normalize('NFKC').toLowerCase();
    if (!/^[\p{L}\p{N}_-]+$/u.test(key)) throw new Error('Invalid personal profile URL.');
    return {
      provider: 'linkedin',
      key,
      url: `https://www.linkedin.com/in/${encodeURIComponent(key)}/`,
    };
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith('utm_')) url.searchParams.delete(key);
  return { provider: host, key: url.toString(), url: url.toString() };
}
export const careerDateSchema = z
  .string()
  .refine(
    (value) => /^\d{4}$/.test(value) || movementDateSchema.safeParse(value).success,
    'Use YYYY, YYYY-MM, YYYY-MM-DD, or leave the date unknown.',
  );
export const careerPositionSchema = z
  .object({
    key: z.string().trim().min(1).max(160),
    organizationId: z.string().max(100).default(''),
    organizationName: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(300),
    start: careerDateSchema.default(''),
    end: careerDateSchema.default(''),
    tenure: z.enum(['current', 'former', 'unknown']).default('unknown'),
    changeType: z.enum(['joined', 'role_change', 'unknown']).default('unknown'),
    endedEmployment: z.boolean().default(false),
    previousPositionKey: z.string().trim().max(160).optional(),
    note: z.string().trim().max(4000).default(''),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.start && v.end && v.start.slice(0, Math.min(v.start.length, v.end.length)) > v.end)
      ctx.addIssue({ code: 'custom', message: 'The end date must not be before the start date.' });
    if (v.tenure === 'current' && (v.end || v.endedEmployment))
      ctx.addIssue({
        code: 'custom',
        message: 'A current role cannot have an end date or departure event.',
      });
    if (v.endedEmployment && v.tenure !== 'former')
      ctx.addIssue({ code: 'custom', message: 'A departure requires a former role.' });
  });
export const personProfileSchema = z
  .object({
    url: z
      .string()
      .max(2000)
      .refine((v) => {
        try {
          personSourceKey(v);
          return true;
        } catch {
          return false;
        }
      }, 'Use an HTTPS personal profile URL.'),
    name: z.string().trim().min(1).max(160),
    identityId: z.string().max(100).default(''),
    reason: z.string().trim().max(4000).default(''),
    visibility: z.enum(['team', 'admin']).default('team'),
    revision: z.number().int().positive().optional(),
    observedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      ),
    rawText: z.string().min(1).max(200000),
    note: z.string().trim().max(4000).default(''),
    positions: z.array(careerPositionSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.positions.map((p) => p.key)).size === v.positions.length,
    'Each career entry needs a unique source key.',
  );
export type CareerPositionInput = z.infer<typeof careerPositionSchema>;
export type PersonProfileInput = z.infer<typeof personProfileSchema>;

/** Validate against the complete saved career, including entries omitted by partial updates. */
export function careerTransitionProblem(positions: CareerPositionInput[]): string | undefined {
  const byKey = new Map(positions.map((p) => [p.key, p]));
  const used = new Set<string>();
  for (const p of positions) {
    if (!p.previousPositionKey) continue;
    const prior = byKey.get(p.previousPositionKey);
    if (!prior || prior.key === p.key) return 'Choose a different existing previous position.';
    if (used.has(prior.key))
      return 'A previous position cannot lead to multiple linked transitions.';
    used.add(prior.key);
    if (!p.organizationId || !prior.organizationId || prior.tenure !== 'former')
      return 'Map both organizations and mark the previous position as former.';
    if (
      p.changeType === 'unknown' ||
      (p.changeType === 'joined' &&
        (prior.organizationId === p.organizationId || !prior.endedEmployment)) ||
      (p.changeType === 'role_change' &&
        (prior.organizationId !== p.organizationId || prior.endedEmployment))
    )
      return 'The linked positions must agree with the arrival, departure or internal role change.';
    const visited = new Set([p.key]);
    let cursor: CareerPositionInput | undefined = prior;
    while (cursor) {
      if (visited.has(cursor.key)) return 'Career transitions cannot form a cycle.';
      visited.add(cursor.key);
      cursor = cursor.previousPositionKey ? byKey.get(cursor.previousPositionKey) : undefined;
    }
  }
}
export interface PersonCareer extends CareerPositionInput {
  id: string;
  profileId: string;
  evidenceId: string;
  updatedAt: string;
  provider: string;
}
export interface PersonSourceProfile {
  id: string;
  objectId: string;
  provider: string;
  url: string;
  revision: number;
  visibility: 'team' | 'admin';
  updatedAt: string;
  note: string;
  captures: {
    id: string;
    evidenceId: string;
    observedOn: string;
    createdAt: string;
    author: string;
    note: string;
  }[];
}
export interface PersonDuplicate {
  id: string;
  name: string;
  revision: number;
  organizations: string[];
  roles: string[];
  sources: string[];
  recordCount: number;
  reason: 'same_name';
  deferred: boolean;
}
