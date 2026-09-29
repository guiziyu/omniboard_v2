// 从 v1 src/modules/constraints.ts 迁移,内容保持一致。
import {
  constraintKinds,
  constraintValueSchemas,
  featureKeyWildcardPattern,
  sourceIdPattern,
  type ConstraintKind,
} from './verification-contract';
/** Structured constraint fields shared by API Optimization and Tech Stack records. */
export const constraintKindOptions = ['none', ...constraintKinds];
export const isConstraintKind = (value: string): value is ConstraintKind =>
  (constraintKinds as readonly string[]).includes(value);
export function parseAffects(value: string | undefined): string[] {
  return [
    ...new Set(
      (value || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}
/** Returns the parsed value or a readable message for the editor. */
export function parseConstraintValue(
  kind: string,
  text: string | undefined,
): { value?: Record<string, unknown>; error?: string } {
  if (!isConstraintKind(kind)) return { error: 'Choose a valid structured constraint.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || '');
  } catch {
    return { error: 'Constraint value must be a JSON object, for example {"required": true}.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { error: 'Constraint value must be a JSON object.' };
  const result = constraintValueSchemas[kind].safeParse(parsed);
  if (!result.success)
    return {
      error:
        'Constraint value (' +
        kind +
        '): ' +
        result.error.issues
          .map((issue) => (issue.path.length ? issue.path.join('.') + ' ' : '') + issue.message)
          .join('; '),
    };
  return { value: result.data as Record<string, unknown> };
}
/** Validates the constraint fields of a saved record; throws a 422 with a readable message. */
export function validateConstraintFields(
  value: Record<string, string>,
  fail: (message: string) => never,
) {
  if (value.sourceId && !sourceIdPattern.test(value.sourceId))
    fail('Source ID must look like SRC-<venue>-<slug> in lowercase letters, digits and dashes.');
  const kind = value.constraintKind || 'none';
  const affects = parseAffects(value.affectsFeatureKeys);
  for (const pattern of affects)
    if (!featureKeyWildcardPattern.test(pattern))
      fail(
        'Affected feature keys must be dotted lowercase keys or subtrees ending in .* (' +
          pattern +
          ').',
      );
  if (kind === 'none') {
    if ((value.constraintValue || '').trim())
      fail('Choose a structured constraint kind, or clear the constraint value.');
    return;
  }
  if (!value.sourceId)
    fail('A structured constraint needs a Source ID so engineering can reference it.');
  const parsed = parseConstraintValue(kind, value.constraintValue);
  if (parsed.error) fail(parsed.error);
  if (value.sensitivity === 'NDA' && value.constraintExportable !== 'no')
    fail('NDA material cannot be exported; set the constraint export option to no.');
}
