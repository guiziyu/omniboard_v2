// 从 v1 src/shared/verification-contract.ts 迁移。
import { z } from 'zod';
/**
 * quant `connector/docs/verification-contract.md` 的词表(§9,quant a146cd9b)。契约写明 v2 不钉词表的哈希,
 * 按文本读 `verification.v_*`;这里只作为界面与请求校验用的副本,契约改词表时同步。
 */
export const CONTRACT_VOCABULARY_JSON =
  '{"contract_version":1,"faces":["market","wallet","wallet_action","trading","transfer","asset_network"],"transports":["ws","rest","sbe","fix"],"environments":["dev-us","dev-cred","colo-live"],"account_kinds":["test","production"],"case_status":["passed","failed","skipped"],"run_status":["passed","failed","aborted"],"leaf_status":["passed","failed","skipped","no_result","stale","awaiting_resource"],"request_status":["queued","running","passed","failed"],"constraint_kinds":["whitelist","rate_limit","protocol","endpoint","account_model","network_route","entitlement"],"resource_types":["api_credentials","whitelist","low_latency_stream","vip_tier","credit_line","colocation","market_data_rights","general_access"],"suites":["market-event","place-order","cancel-order","adjust-order","wallet-event","wallet-api","request-limit","common-error","asset-network"],"stale_days":30}';
export interface ContractVocabulary {
  contract_version: number;
  faces: readonly string[];
  transports: readonly string[];
  environments: readonly string[];
  account_kinds: readonly string[];
  case_status: readonly string[];
  run_status: readonly string[];
  leaf_status: readonly string[];
  request_status: readonly string[];
  constraint_kinds: readonly string[];
  resource_types: readonly string[];
  suites: readonly string[];
  stale_days: number;
}
export const contractVocabulary = JSON.parse(CONTRACT_VOCABULARY_JSON) as ContractVocabulary;
export const CONTRACT_VERSION = contractVocabulary.contract_version;
export const faces = [
  'market',
  'wallet',
  'wallet_action',
  'trading',
  'transfer',
  'asset_network',
] as const;
export type Face = (typeof faces)[number];
export const environments = ['dev-us', 'dev-cred', 'colo-live'] as const;
export type Environment = (typeof environments)[number];
export const accountKinds = ['test', 'production'] as const;
export type AccountKind = (typeof accountKinds)[number];
export const caseStatuses = ['passed', 'failed', 'skipped'] as const;
export const runStatuses = ['passed', 'failed', 'aborted'] as const;
export const leafStatuses = [
  'passed',
  'failed',
  'skipped',
  'no_result',
  'stale',
  'awaiting_resource',
] as const;
export type LeafStatus = (typeof leafStatuses)[number];
export const requestStatuses = ['queued', 'running', 'passed', 'failed'] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export const constraintKinds = [
  'whitelist',
  'rate_limit',
  'protocol',
  'endpoint',
  'account_model',
  'network_route',
  'entitlement',
] as const;
export type ConstraintKind = (typeof constraintKinds)[number];
export const resourceTypes = [
  'api_credentials',
  'whitelist',
  'low_latency_stream',
  'vip_tier',
  'credit_line',
  'colocation',
  'market_data_rights',
  'general_access',
] as const;
export type ResourceType = (typeof resourceTypes)[number];
export const suites = [
  'market-event',
  'place-order',
  'cancel-order',
  'adjust-order',
  'wallet-event',
  'wallet-api',
  'request-limit',
  'common-error',
  'asset-network',
] as const;
export const STALE_DAYS_DEFAULT = contractVocabulary.stale_days;
/** Capability codes used by Onboarding records, mapped to the face wildcard they request. */
export const capabilityWildcards: Record<string, string> = {
  market: 'market.*',
  wallet: 'wallet.*',
  trading: 'trading.*',
  wallet_actions: 'wallet_action.*',
  transfer: 'transfer.*',
  asset_network: 'asset_network.catalog',
};
/** Default code owner directories by face (scaffold-layout file ownership). */
export const faceOwnerPaths: Record<Face, string> = {
  market: 'src/market/',
  wallet: 'src/wallet/',
  wallet_action: 'src/wallet/actions',
  trading: 'src/actions/',
  transfer: 'src/transfer/',
  asset_network: 'src/asset_network/',
};
export const constraintEnforcement: Record<ConstraintKind, 'code' | 'config' | 'operational'> = {
  whitelist: 'code',
  rate_limit: 'config',
  protocol: 'code',
  endpoint: 'config',
  account_model: 'code',
  network_route: 'operational',
  entitlement: 'operational',
};
export const featureKeyPattern = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
export const featureKeyWildcardPattern = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*(?:\.\*)?$/;
export const sourceIdPattern = /^SRC-[a-z0-9][a-z0-9-]*$/;
export const isFace = (value: string): value is Face =>
  (faces as readonly string[]).includes(value);
export function faceOf(featureKey: string): Face | undefined {
  const head = featureKey.split('.')[0] || '';
  return isFace(head) ? head : undefined;
}
/** Exact key or a `.*` subtree prefix; a bare face name is treated as `<face>.*`. */
export function matchesPattern(featureKey: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return featureKey === prefix || featureKey.startsWith(prefix + '.');
  }
  if (isFace(pattern) && !featureKey.includes('.')) return featureKey === pattern;
  if (isFace(pattern)) return featureKey === pattern || featureKey.startsWith(pattern + '.');
  return featureKey === pattern;
}
export type LeafColor = 'red' | 'amber' | 'green' | 'grey';
/**
 * Contract §2 colours. Red = latest result failed; amber = declared without a result, stale or
 * awaiting a resource; green = passed and fresh; grey = not declared.
 */
export function leafColor(input: {
  declared: boolean;
  status?: string | null;
  observedAt?: string | null;
  awaiting?: readonly string[];
  now?: string;
  staleDays?: number;
}): LeafColor {
  if (!input.declared) return 'grey';
  if (input.status === 'failed') return 'red';
  if (input.status === 'passed' && !isStale(input.observedAt, input.now, input.staleDays))
    return 'green';
  return 'amber';
}
export function isStale(
  observedAt: string | null | undefined,
  now = new Date().toISOString(),
  staleDays = STALE_DAYS_DEFAULT,
): boolean {
  if (!observedAt) return true;
  const age = Date.parse(now) - Date.parse(observedAt);
  return !Number.isFinite(age) || age > staleDays * 86400000;
}
/** Contract §6: public `market.*` channels need no account; every other face needs a Test account. */
export function leafRequiresCredentials(featureKey: string): boolean {
  return faceOf(featureKey) !== 'market';
}
export const worstColor = (colors: readonly LeafColor[]): LeafColor =>
  colors.includes('red')
    ? 'red'
    : colors.includes('amber')
      ? 'amber'
      : colors.includes('green')
        ? 'green'
        : 'grey';
const isoTimestamp = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), 'Expected an ISO timestamp.');
const uuid = z.string().min(1).max(64);
const positiveInt = z.number().int().nonnegative();
const identifier = z.string().regex(/^[A-Za-z0-9_./:-]+$/);
const url = z.url().max(2000);
/** Contract §4 request file. */
export const featureKeySchema = z
  .string()
  .regex(featureKeyPattern, 'Use a lowercase dotted feature key.');
export const featureKeyOrWildcardSchema = z
  .string()
  .regex(featureKeyWildcardPattern, 'Use a feature key or a subtree ending in .*');
export const requestedLeafSchema = z
  .object({
    feature_key: featureKeyOrWildcardSchema,
    prerequisites: z.array(z.enum(resourceTypes)),
    awaiting: z.array(z.enum(resourceTypes)),
  })
  .strict();
export const constraintValueSchemas: Record<ConstraintKind, z.ZodType> = {
  whitelist: z
    .object({
      required: z.boolean(),
      max_ips: positiveInt.optional(),
      applies_to: z.array(z.enum(['rest', 'ws', 'ws_private', 'sbe', 'fix'])).default([]),
      registration: z.enum(['portal', 'account_manager', 'api', 'none']).optional(),
    })
    .strict(),
  rate_limit: z
    .object({
      unit: z.enum(['requests', 'orders', 'weight', 'messages', 'connections']),
      limit: positiveInt,
      window_ms: z.number().int().positive(),
      scope: z.enum(['ip', 'account', 'endpoint']),
      tier: identifier.max(60).optional(),
      endpoint_group: identifier.max(120).optional(),
    })
    .strict(),
  protocol: z
    .object({
      transport: z.enum(['ws', 'rest', 'sbe', 'fix']),
      endpoint: url.optional(),
      auth: z.enum(['none', 'api_key', 'hmac', 'ed25519', 'rsa', 'session']).optional(),
      availability: z.enum(['public', 'vip', 'institutional', 'private']).optional(),
    })
    .strict(),
  endpoint: z
    .object({
      kind: z.enum(['rest', 'ws']),
      url,
      private: z.boolean(),
      purpose: z
        .enum(['market', 'trading', 'wallet', 'transfer', 'asset_network', 'auth'])
        .optional(),
    })
    .strict(),
  account_model: z
    .object({
      model: z.enum([
        'standard',
        'portfolio_margin',
        'portfolio_margin_pro',
        'unified',
        'contract',
        'multi',
      ]),
      products: z.array(identifier.max(60)).default([]),
    })
    .strict(),
  network_route: z
    .object({
      route: z.enum(['public_cdn', 'public_direct', 'private_link', 'colocation']),
      region: identifier.max(60).optional(),
      zone_id: identifier.max(60).optional(),
      provider: identifier.max(60).optional(),
      resource_type: z.enum(['whitelist', 'colocation', 'low_latency_stream']).optional(),
    })
    .strict(),
  entitlement: z
    .object({
      feature_keys: z.array(featureKeyOrWildcardSchema).default([]),
      status: z.enum(['unknown', 'not_requested', 'requested', 'granted', 'rejected', 'expired']),
      expires_on: z.iso.date().optional(),
      resource_type: z.enum(['vip_tier', 'market_data_rights', 'credit_line']).optional(),
    })
    .strict(),
};
/** Expected keys per kind, for editor hints. */
export const constraintValueKeys: Record<ConstraintKind, string[]> = {
  whitelist: ['required', 'max_ips', 'applies_to[]', 'registration'],
  rate_limit: ['unit', 'limit', 'window_ms', 'scope', 'tier', 'endpoint_group'],
  protocol: ['transport', 'endpoint', 'auth', 'availability'],
  endpoint: ['kind', 'url', 'private', 'purpose'],
  account_model: ['model', 'products[]'],
  network_route: ['route', 'region', 'zone_id', 'provider', 'resource_type'],
  entitlement: ['feature_keys[]', 'status', 'expires_on', 'resource_type'],
};
export const constraintOriginSchema = z
  .object({ record_id: z.string().min(1), revision: z.number().int().positive() })
  .strict();
export const exportedConstraintSchema = z
  .object({
    id: z.string().regex(sourceIdPattern),
    kind: z.enum(constraintKinds),
    scope: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    value: z.record(z.string(), z.unknown()),
    evidence: z.enum(['REPORTED', 'OFFICIAL', 'CONTRACTED', 'VERIFIED', 'ENFORCED']),
    sensitivity: z.enum(['PUBLIC', 'INTERNAL', 'NDA']),
    collected_at: z.iso.date(),
    origin: constraintOriginSchema,
    affects: z
      .object({ feature_keys: z.array(featureKeyOrWildcardSchema), files: z.array(z.string()) })
      .strict(),
    enforcement: z.enum(['code', 'config', 'operational']),
    exportable: z.literal(true),
  })
  .strict();
export const redactedConstraintSchema = z
  .object({
    id: z.string().regex(sourceIdPattern),
    kind: z.enum(constraintKinds),
    origin: constraintOriginSchema,
  })
  .strict();
export const constraintSchema = z.union([exportedConstraintSchema, redactedConstraintSchema]);
export const requestFileSchema = z
  .object({
    schema_version: z.literal(1),
    request_id: uuid,
    venue_key: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    crate_path: z.string().min(1),
    environment: z.enum(environments),
    account: z.object({ name: z.string().min(1), kind: z.literal('test') }).strict(),
    requested: z.array(requestedLeafSchema),
    constraints: z.array(constraintSchema),
  })
  .strict();
export type RequestFile = z.infer<typeof requestFileSchema>;
export type RequestedLeaf = z.infer<typeof requestedLeafSchema>;
export type ExportedConstraint = z.infer<typeof constraintSchema>;
/** Contract §4 result.json (written by the quant skill; informational only). */
export const resultFileSchema = z
  .object({
    schema_version: z.literal(1),
    request_id: uuid,
    build_revision: z.string().min(1),
    build_dirty: z.boolean(),
    run_ids: z.array(uuid),
    leaves: z.array(
      z
        .object({
          feature_key: featureKeySchema,
          status: z.enum(['passed', 'failed', 'skipped', 'not_built']),
          reason: z.string(),
        })
        .strict(),
    ),
    notes: z.string(),
  })
  .strict();
export type ResultFile = z.infer<typeof resultFileSchema>;
/** Contract §5 read-only view rows, after timestamps are normalised to ISO strings. */
export const declaredFeatureSchema = z
  .object({ feature_key: featureKeySchema, declared_by: z.enum(['descriptor']) })
  .strict();
export const declaredRowSchema = z.object({
  venue_key: z.string().min(1),
  source_id: z.string().min(1),
  crate_path: z.string().min(1),
  build_revision: z.string().min(1),
  build_dirty: z.boolean(),
  observed_at: isoTimestamp,
  factory_flags: z.record(z.string(), z.boolean()),
  declared_features: z.array(declaredFeatureSchema),
  schema_version: z.number().int(),
});
export const leafRowSchema = z.object({
  venue_key: z.string().min(1),
  feature_key: featureKeySchema,
  environment: z.enum(environments),
  account_kind: z.enum(accountKinds),
  status: z.enum(caseStatuses),
  skip_reason: z.string().nullable(),
  error_text: z.string().nullable(),
  observed_at: isoTimestamp,
  run_id: uuid,
  build_revision: z.string().min(1),
  build_dirty: z.boolean(),
  request_id: uuid.nullable(),
  schema_version: z.number().int().optional(),
});
export const blockerSchema = z
  .object({ key: z.string(), reason: z.string(), next_step: z.string() })
  .partial({ key: true, reason: true })
  .loose();
export const runRowSchema = z.object({
  request_id: uuid,
  run_id: uuid,
  venue_key: z.string().min(1),
  suite: z.string().min(1),
  environment: z.enum(environments),
  account_name: z.string().min(1),
  account_kind: z.enum(accountKinds),
  build_revision: z.string().min(1),
  build_dirty: z.boolean(),
  started_at: isoTimestamp,
  finished_at: isoTimestamp.nullable(),
  status: z.enum(runStatuses),
  blockers: z.array(blockerSchema),
  passed_count: positiveInt,
  failed_count: positiveInt,
  skipped_count: positiveInt,
  schema_version: z.number().int().optional(),
});
export type DeclaredRow = z.infer<typeof declaredRowSchema>;
export type LeafRow = z.infer<typeof leafRowSchema>;
export type RunRow = z.infer<typeof runRowSchema>;
export type Blocker = z.infer<typeof blockerSchema>;
