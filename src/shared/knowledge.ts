// 从 v1 src/modules/knowledge.ts 迁移,内容保持一致。
import { z } from 'zod';
import { roadmapPeriod, roadmapTypes, roadmapStates } from './roadmap';
import { environments } from './verification-contract';
import { constraintKindOptions, validateConstraintFields } from './constraints';
export type Field = {
  id: string;
  label: string;
  type?: 'select' | 'date' | 'number' | 'textarea' | 'url';
  options?: string[];
  required?: boolean;
  hint?: string;
  /** Initial value for new records; defaults to the first option. */
  defaultValue?: string;
};
const select = (
  id: string,
  label: string,
  options: string[],
  required = true,
  defaultValue?: string,
): Field => ({
  id,
  label,
  type: 'select',
  options,
  required,
  defaultValue,
});
const field = (
  id: string,
  label: string,
  required = false,
  type: Field['type'] = undefined,
  hint?: string,
): Field => ({ id, label, required, type, hint });
export const evidenceLevels = ['REPORTED', 'OFFICIAL', 'CONTRACTED', 'VERIFIED', 'ENFORCED'];
const common: Field[] = [
  select('evidenceLevel', 'What supports this information?', evidenceLevels),
  select('sensitivity', 'Information sensitivity', ['PUBLIC', 'INTERNAL', 'NDA']),
  select('sourceKind', 'Source type', [
    'user_report',
    'public_directory',
    'public_social',
    'repository_code',
    'repository_document',
    'official_website',
    'provider_agreement',
    'measurement',
  ]),
  field('sourceRef', 'Source link or document reference'),
  field('owner', 'Person or team responsible', true),
  field('reviewedOn', 'Reviewed on', true, 'date'),
  field('expiresOn', 'Review or access expiry date', false, 'date'),
  field(
    'verification',
    'What has been checked, and what happens next?',
    true,
    'textarea',
    'Describe the check or next action in plain language. Name the person or team to follow up with.',
  ),
];
// Structured technical constraints travel to engineering in the request JSON (contract §4).
const constraintFields: Field[] = [
  field(
    'sourceId',
    'Source ID for engineering',
    false,
    undefined,
    'SRC-<venue>-<slug> in lowercase, e.g. SRC-bitget-ip-whitelist. Unique within this organization.',
  ),
  select('constraintKind', 'Structured constraint', constraintKindOptions),
  field(
    'constraintValue',
    'Constraint value (JSON)',
    false,
    'textarea',
    'A JSON object holding only enumerations, numbers, URLs and identifiers. Leave empty when no structured constraint applies.',
  ),
  select('constraintExportable', 'Export the constraint value to engineering', ['yes', 'no']),
  field(
    'affectsFeatureKeys',
    'Affected feature keys',
    false,
    undefined,
    'Comma-separated feature keys or subtrees ending in .*, e.g. trading.unified.*, wallet.unified.*',
  ),
];
const serviceFields: Field[] = [
  field('product', 'Product / service', true),
  field('coverage', 'Coverage and availability', true, 'textarea'),
  field('delivery', 'Delivery / access method'),
  field('conditions', 'Conditions and limitations', true, 'textarea'),
  ...common,
];
export const knowledgeFields: Record<string, Field[]> = {
  roadmap: [
    select('planType', 'Plan belongs to', Object.keys(roadmapTypes)),
    select('roadmapStatus', 'Milestone status', Object.keys(roadmapStates)),
    field(
      'targetPeriod',
      'Target window',
      false,
      undefined,
      'Use YYYY, YYYY-Q1 to Q4, YYYY-MM or YYYY-MM-DD. Leave empty if no date is known.',
    ),
    field('owner', 'Person or team responsible'),
    field('successCriteria', 'Expected outcome', true, 'textarea'),
    field('impact', 'Why this matters', false, 'textarea'),
    field('nextStep', 'Next step', false, 'textarea'),
    field('reviewedOn', 'Reviewed on', true, 'date'),
  ],
  services: serviceFields,
  market_access: serviceFields,
  payments: serviceFields,
  custody: serviceFields,
  data_coverage: serviceFields,
  infrastructure: serviceFields,
  api_optimization: [
    select('mechanism', 'Mechanism', [
      'depth_stream',
      'trade_stream',
      'whitelist',
      'account_routing',
      'rate_limit',
      'protocol',
      'fee_query',
    ]),
    field('product', 'Product scope', true),
    select('accountModel', 'Account model', [
      'unknown',
      'standard',
      'portfolio_margin',
      'portfolio_margin_pro',
      'unified',
      'contract',
      'multi',
    ]),
    select('entitlement', 'Our access', [
      'unknown',
      'not_requested',
      'requested',
      'granted',
      'rejected',
      'expired',
    ]),
    field('endpoint', 'Endpoint / stream name'),
    field('intervalMs', 'Advertised update interval (ms)', false, 'number'),
    field('p50Us', 'Measured p50 latency (µs)', false, 'number'),
    field('p99Us', 'Measured p99 latency (µs)', false, 'number'),
    field('prerequisites', 'Eligibility and prerequisites', true, 'textarea'),
    field('environment', 'Measurement environment'),
    ...constraintFields,
    ...common,
  ],
  capital_optimization: [
    select('mechanism', 'Mechanism', [
      'vip_qualification',
      'collateral_financing',
      'fee_discount',
      'borrow_cost',
      'rebate',
      'strategy_economics',
    ]),
    field('product', 'Product / account scope', true),
    field('vipTier', 'VIP tier'),
    field('holdingAsset', 'Qualifying asset'),
    field('holdingAmount', 'Required holding amount', false, 'number'),
    select('holdingMethod', 'Holding method', ['unknown', 'owned', 'borrowed', 'mixed']),
    field('borrowAprBps', 'Borrow APR (basis points)', false, 'number'),
    field('makerFeeBps', 'Maker fee (basis points; negative = rebate)', false, 'number'),
    field('capitalUsd', 'Applicable capital (USD)', false, 'number'),
    field('qualificationCostUsd', 'Qualification cost budget (USD)', false, 'number'),
    field('conditions', 'Qualifying balance, costs and obligations', true, 'textarea'),
    field('economics', 'Economic assumptions / break-even method', true, 'textarea'),
    ...common,
  ],
  tech_stack: [
    select('layer', 'Infrastructure layer', [
      'unknown',
      'network_edge',
      'api_gateway',
      'matching_engine',
      'client_deployment',
    ]),
    field('cloud', 'Cloud / CDN providers'),
    field('region', 'Region'),
    field('zoneLabel', 'Account-specific availability-zone label'),
    field('zoneId', 'Stable availability-zone ID'),
    field('instanceType', 'Instance family / type'),
    select('route', 'Route class', [
      'unknown',
      'public_cdn',
      'public_direct',
      'private_link',
      'colocation',
    ]),
    select('allocation', 'Host placement / allocation', [
      'unknown',
      'standard',
      'sample_and_measure',
      'guaranteed',
    ]),
    field('endpoint', 'Endpoint'),
    field('constraints', 'Scope, routing and placement constraints', true, 'textarea'),
    ...constraintFields,
    ...common,
  ],
  compliance: [
    select('decision', 'Who can use this?', ['unknown', 'whitelist', 'blacklist', 'conditional']),
    field('jurisdiction', 'Jurisdiction', true),
    field('legalEntity', 'Exact legal entity', true),
    field('product', 'Product and customer scope', true),
    field('authority', 'Regulator / policy authority'),
    field('license', 'Licence / registration / policy reference'),
    field('effectiveOn', 'Effective on', false, 'date'),
    field('control', 'How the rule is applied, or what still needs checking', true, 'textarea'),
    ...common,
  ],
  onboarding: [
    field(
      'venueKey',
      'Provider connection ID',
      true,
      undefined,
      'Engineering reference, e.g. cex.binance',
    ),
    select('integrationStage', 'API connection progress', [
      'unknown',
      'docs_only',
      'implemented',
      'unit_tested',
      'sandbox_verified',
      'production_verified',
    ]),
    select('resourceType', 'Resource', [
      'api_credentials',
      'whitelist',
      'low_latency_stream',
      'vip_tier',
      'credit_line',
      'colocation',
      'market_data_rights',
      'general_access',
    ]),
    select('resourceStage', 'Provider approval progress', [
      'unknown',
      'requested',
      'negotiating',
      'granted',
      'expired',
      'rejected',
    ]),
    field(
      'capabilities',
      'Features to connect',
      true,
      undefined,
      'Engineering codes: market = market data; wallet = balances; trading = orders; wallet_actions = deposits/withdrawals; transfer = transfers; asset_network = assets/networks. Separate codes with commas.',
    ),
    field('accountRef', 'Provider account name or ID'),
    field(
      'credentialRef',
      'Saved API credential reference',
      false,
      undefined,
      'Ask engineering for the secret:// reference. Keep the API key in the secret store.',
    ),
    field('resourceRef', 'Provider approval or agreement reference'),
    field('product', 'Product / environment scope', true),
    select('environment', 'Verification environment', [...environments], true, 'dev-cred'),
    select('nextAction', 'Request engineering help', [
      'none',
      'validate_readonly',
      'prepare_config',
      'propose_adapter_change',
    ]),
    field(
      'businessOwner',
      'Business owner',
      false,
      undefined,
      'Person or team responsible for provider access and commercial terms.',
    ),
    field(
      'technicalOwner',
      'Technical owner',
      false,
      undefined,
      'Person or team responsible for connection development and testing.',
    ),
    field(
      'nextStep',
      'Next step',
      false,
      'textarea',
      'One concrete action to take next. Keep verification results in the evidence section.',
    ),
    field('blockers', 'What is still needed?', true, 'textarea'),
    ...common,
  ],
  contacts: [
    select('channel', 'Channel', [
      'email',
      'telegram',
      'wechat',
      'x',
      'linkedin',
      'website',
      'phone',
    ]),
    field('value', 'Address / profile URL', true),
    field('role', 'Business contact for / role', true),
    select('relationship', 'Relationship', [
      'public_channel',
      'not_contacted',
      'contacted',
      'active',
      'inactive',
    ]),
    ...common,
  ],
};
export function defaultsFor(tab: string): Record<string, string> {
  return Object.fromEntries(
    (knowledgeFields[tab] || []).map((f) => [
      f.id,
      f.defaultValue ?? (f.type === 'select' ? f.options![0]! : ''),
    ]),
  );
}
export function validateKnowledge(tab: string, input: unknown): Record<string, string> {
  if (tab === 'comments') {
    return z
      .object({
        replyTo: z.string().max(100).default(''),
        relatedRecord: z.string().max(100).default(''),
        occurredOn: z.union([z.literal(''), z.iso.date()]).default(''),
      })
      .strict()
      .parse(input);
  }
  if (!knowledgeFields[tab]) {
    if (input && Object.keys(input as object).length)
      throw Object.assign(new Error('Structured fields are not available in this tab.'), {
        statusCode: 422,
      });
    return {};
  }
  const fields = knowledgeFields[tab]!;
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s = z
      .string()
      .trim()
      .max(f.type === 'textarea' ? 4000 : 500);
    if (f.required) s = s.min(1, f.label + ' is required.');
    if (f.options)
      s = s.refine((v) => f.options!.includes(v), 'Choose a valid ' + f.label.toLowerCase() + '.');
    if (f.type === 'number')
      s = s.refine(
        (v) => !v || /^-?\d{1,24}(?:\.\d{1,12})?$/.test(v),
        'Enter a decimal without separators.',
      );
    if (f.type === 'number' && f.id !== 'makerFeeBps')
      s = s.refine((v) => !v || !v.startsWith('-'), 'This value cannot be negative.');
    if (f.type === 'date')
      s = s.refine(
        (v) =>
          !v ||
          (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
            !Number.isNaN(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v),
        'Enter a valid date.',
      );
    shape[f.id] = f.required ? s : s.default('');
  }
  const value = z.object(shape).strict().parse(input) as Record<string, string>;
  const fail = (m: string) => {
    throw Object.assign(new Error(m), { statusCode: 422 });
  };
  if (tab === 'roadmap' && value.targetPeriod && !roadmapPeriod(value.targetPeriod))
    fail('Enter a valid year, quarter, month or date for the target window.');
  if (tab === 'contacts') {
    if (value.channel === 'email' && !z.email().safeParse(value.value).success)
      fail('Enter a valid email address.');
    if (
      ['telegram', 'x', 'linkedin', 'website'].includes(value.channel!) &&
      (!/^https:\/\//.test(value.value!) || !URL.canParse(value.value!))
    )
      fail('Use an HTTPS profile or channel URL.');
  }
  if (tab === 'onboarding') {
    if (!/^[a-z][a-z0-9_-]*\.[a-z0-9_-]+$/.test(value.venueKey!))
      fail('Use a canonical connector key such as cex.binance.');
    if (value.credentialRef && !/^secret:\/\/[a-zA-Z0-9_./-]+$/.test(value.credentialRef))
      fail(
        'Only a secret:// reference is accepted; keep credentials in the execution secret store.',
      );
    const allowed = ['market', 'wallet', 'trading', 'wallet_actions', 'transfer', 'asset_network'];
    if (value.capabilities!.split(',').some((c) => !allowed.includes(c.trim())))
      fail('Unknown connector capability.');
  }
  if (value.sensitivity === 'NDA' && value.evidenceLevel === 'OFFICIAL')
    fail('Use an appropriate internal or contracted evidence level for NDA material.');
  if (tab === 'api_optimization' || tab === 'tech_stack') validateConstraintFields(value, fail);
  return value;
}
export function contactHref(data: Record<string, string>) {
  if (data.channel === 'wechat') return ''; // An account ID is not a navigable URL.
  return data.channel === 'email'
    ? 'mailto:' + data.value
    : data.channel === 'phone'
      ? 'tel:' + data.value
      : data.value;
}
