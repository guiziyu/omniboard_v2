import { tr } from './i18n';
import { roadmapTypes, roadmapStates } from '../shared/roadmap';
/** Display vocabulary only: stored enums, references and original notes stay unchanged. */
export type StatusPresentation = { label: string; hint: string; icon: string; tone: string };

const evidence: Record<string, StatusPresentation> = {
  REPORTED: {
    label: 'Reported information',
    hint: 'A source reported this. Supporting confirmation is still needed.',
    icon: 'file',
    tone: 'reported',
  },
  OFFICIAL: {
    label: 'Official source',
    hint: 'Supported by an official publication. This does not confirm access for our account.',
    icon: 'link',
    tone: 'official',
  },
  CONTRACTED: {
    label: 'Written approval',
    hint: 'Supported by a contract or formal authorization for the stated scope.',
    icon: 'file',
    tone: 'contracted',
  },
  VERIFIED: {
    label: 'Verified with evidence',
    hint: 'The stated claim was checked and the supporting evidence was saved.',
    icon: 'check',
    tone: 'verified',
  },
  ENFORCED: {
    label: 'Control in place',
    hint: 'The stated rule is implemented through an actual control.',
    icon: 'lock',
    tone: 'enforced',
  },
};
const reviews: Record<string, StatusPresentation> = {
  unverified: {
    label: 'Needs review',
    hint: 'The team has not confirmed this record yet.',
    icon: 'clock',
    tone: 'pending',
  },
  confirmed: {
    label: 'Marked confirmed',
    hint: 'This record is marked confirmed. Account access and testing are tracked separately.',
    icon: 'check',
    tone: 'reviewed',
  },
  in_progress: {
    label: 'Follow-up in progress',
    hint: 'Someone is working on this record or its next steps.',
    icon: 'refresh',
    tone: 'progress',
  },
  done: {
    label: 'Follow-up complete',
    hint: 'The follow-up work on this record is complete.',
    icon: 'check',
    tone: 'complete',
  },
};
const handoffs: Record<string, StatusPresentation> = {
  blocked: {
    label: 'Action required',
    hint: 'Resolve the missing items below before engineering can test the connection.',
    icon: 'lock',
    tone: 'blocked',
  },
  ready_for_validation: {
    label: 'Ready for engineering review',
    hint: 'Required information is present. Connection tests have not been run by this app.',
    icon: 'clock',
    tone: 'ready',
  },
  // Derived request states (contract §2); the app never writes them.
  queued: {
    label: 'Queued for verification',
    hint: 'The request is saved for quant. No live-test run has been recorded for it yet.',
    icon: 'clock',
    tone: 'pending',
  },
  running: {
    label: 'Verification running',
    hint: 'A live-test run for this request has started and has not finished.',
    icon: 'refresh',
    tone: 'progress',
  },
  passed: {
    label: 'Verification passed',
    hint: 'The latest live-test runs for this request passed on a clean build.',
    icon: 'check',
    tone: 'verified',
  },
  failed: {
    label: 'Verification failed',
    hint: 'A leaf failed or a run aborted. Read the next steps from the run blockers.',
    icon: 'lock',
    tone: 'blocked',
  },
};
const fallbackStatus = (value: string): StatusPresentation => ({
  label: value.replaceAll('_', ' '),
  hint: '',
  icon: 'info',
  tone: 'neutral',
});
const localize = (status: StatusPresentation): StatusPresentation => ({
  ...status,
  label: tr(status.label),
  hint: tr(status.hint),
});
export const evidencePresentation = (value: string) =>
  localize(evidence[value] || fallbackStatus(value));
export const reviewPresentation = (value: string) =>
  localize(reviews[value] || fallbackStatus(value));
export const handoffPresentation = (value: string) =>
  localize(handoffs[value] || fallbackStatus(value));

const values: Record<string, Record<string, string>> = {
  planType: roadmapTypes,
  roadmapStatus: Object.fromEntries(
    Object.entries(roadmapStates).map(([key, state]) => [key, state.label]),
  ),
  evidenceLevel: Object.fromEntries(
    Object.entries(evidence).map(([key, value]) => [key, value.label]),
  ),
  sensitivity: {
    PUBLIC: 'Public information',
    INTERNAL: 'Internal information',
    NDA: 'Confidential · NDA',
  },
  sourceKind: {
    user_report: 'Team or contact report',
    public_directory: 'Public directory',
    public_social: 'Public social profile',
    repository_code: 'Connector code',
    repository_document: 'Connector documentation',
    official_website: 'Official website',
    provider_agreement: 'Provider agreement',
    measurement: 'Test or measurement results',
  },
  integrationStage: {
    unknown: 'Progress not recorded',
    docs_only: 'Documentation reviewed',
    implemented: 'Code available · testing not recorded',
    unit_tested: 'Automated code tests passed',
    sandbox_verified: 'Test account connection verified',
    production_verified: 'Live account connection verified',
  },
  resourceStage: {
    unknown: 'Access not confirmed',
    requested: 'Requested from provider',
    negotiating: 'Terms under discussion',
    granted: 'Access granted',
    expired: 'Access expired',
    rejected: 'Request declined',
  },
  entitlement: {
    unknown: 'Access not confirmed',
    not_requested: 'Not requested yet',
    requested: 'Requested from provider',
    granted: 'Access granted',
    rejected: 'Request declined',
    expired: 'Access expired',
  },
  resourceType: {
    api_credentials: 'API account access',
    whitelist: 'Special access approval',
    low_latency_stream: 'Faster market data',
    vip_tier: 'VIP tier',
    credit_line: 'Credit line',
    colocation: 'Nearby server hosting',
    market_data_rights: 'Market data usage rights',
    general_access: 'General account access',
  },
  nextAction: {
    none: 'No engineering request',
    validate_readonly: 'Request a connection check',
    prepare_config: 'Request connection setup',
    propose_adapter_change: 'Request a connector change',
  },
  accountModel: {
    standard: 'Standard account',
    portfolio_margin: 'Portfolio Margin',
    portfolio_margin_pro: 'Portfolio Margin Pro',
    unified: 'Unified account',
    contract: 'Contract account',
    multi: 'Multiple account types',
  },
  relationship: {
    public_channel: 'Public contact channel',
    not_contacted: 'Not contacted yet',
    contacted: 'Contacted · awaiting progress',
    active: 'Active relationship',
    inactive: 'Inactive relationship',
  },
  channel: {
    email: 'Email',
    telegram: 'Telegram',
    wechat: 'WeChat',
    x: 'X / Twitter',
    linkedin: 'LinkedIn',
    website: 'Website',
    phone: 'Phone',
  },
  decision: {
    unknown: 'Access rules not confirmed',
    whitelist: 'Only listed users / products allowed',
    blacklist: 'Listed users / products restricted',
    conditional: 'Access depends on conditions',
  },
  mechanism: {
    depth_stream: 'Order book data',
    trade_stream: 'Trade data',
    whitelist: 'Special access approval',
    account_routing: 'Account type and order routing',
    rate_limit: 'API request limits',
    protocol: 'Connection protocol',
    fee_query: 'Account fee lookup',
    vip_qualification: 'VIP qualification',
    collateral_financing: 'Collateral financing',
    fee_discount: 'Trading fee discount',
    borrow_cost: 'Borrowing cost',
    rebate: 'Rebates',
    strategy_economics: 'Strategy costs and returns',
  },
  holdingMethod: {
    owned: 'Purchased holdings',
    borrowed: 'Borrowed holdings',
    mixed: 'Purchased and borrowed holdings',
  },
  layer: {
    network_edge: 'CDN and network edge',
    api_gateway: 'API gateway',
    matching_engine: 'Matching engine',
    client_deployment: 'Our trading servers',
  },
  route: {
    public_cdn: 'Public connection through a CDN',
    public_direct: 'Direct public connection',
    private_link: 'Private network connection',
    colocation: 'Servers near the exchange',
  },
  allocation: {
    standard: 'Standard placement',
    sample_and_measure: 'Try hosts and measure latency',
    guaranteed: 'Guaranteed placement',
  },
  constraintKind: {
    none: 'No structured constraint',
    whitelist: 'IP whitelist',
    rate_limit: 'Rate limit',
    protocol: 'Connection protocol',
    endpoint: 'Endpoint',
    account_model: 'Account model',
    network_route: 'Network route',
    entitlement: 'Entitlement',
  },
  constraintExportable: {
    yes: 'Yes, export the value',
    no: 'No, export only the id',
  },
};
const capabilityLabels: Record<string, string> = {
  market: 'Market data',
  wallet: 'Balances',
  trading: 'Order placement',
  wallet_actions: 'Deposits and withdrawals',
  transfer: 'Transfers',
  asset_network: 'Supported assets and networks',
};
export function fieldOptionLabel(fieldId: string, value: string): string {
  return tr(
    values[fieldId]?.[value] || (value === 'unknown' ? 'Not recorded' : value.replaceAll('_', ' ')),
  );
}
export function fieldValueLabel(field: { id: string; type?: string }, value?: string): string {
  if (!value) return tr('Not recorded');
  if (field.id === 'capabilities')
    return value
      .split(',')
      .map((part) => tr(capabilityLabels[part.trim()] || part.trim()))
      .join(', ');
  if (['verification', 'blockers'].includes(field.id)) return readableNote(value);
  return field.type === 'select' ? fieldOptionLabel(field.id, value) : value;
}
export function fieldHint(fieldId: string, value: string): string {
  if (fieldId === 'evidenceLevel') return evidencePresentation(value).hint;
  if (fieldId === 'integrationStage')
    return tr(
      (
        {
          implemented:
            'A connector exists in quant. No build, test-account check or live-account check is recorded here.',
          unit_tested: 'Code tests passed. Exchange account access still needs to be checked.',
          sandbox_verified:
            'The connection worked with a test account. Live account access is a separate step.',
          production_verified:
            'A live account connection was checked for the recorded scope. This does not enable trading automatically.',
        } as Record<string, string>
      )[value] || '',
    );
  return '';
}

const notes: Record<string, string> = {
  'P2 entity/identity and resource grants unresolved; P4 account validation and P5 operational approval not supplied.':
    'Confirm the legal entity and account owner, obtain the exchange approval, test the account connection, and get sign-off before going live.',
  'The source dossier is a 2026-07-10 baseline. Refresh primary regulator/provider sources and obtain the account-specific decision before activation.':
    'These notes were compiled on 10 July 2026. Check the latest regulator and exchange rules, then confirm whether our specific account can use the product.',
  'Published by the linked official site. Public listing only; no contact, relationship or account entitlement has been established.':
    'This contact is listed on the linked official website. We have not contacted them or established a business relationship or account access.',
  'ProviderEntry declares these interfaces. Source inspection is not a compilation, account probe or production-readiness test.':
    'The connector code lists these features. Engineering still needs to build and test it, then check access with the intended exchange account.',
  'Validate applicability to the actual entity, product and account before use.':
    'Confirm which exchange entity, product and account this applies to before using it.',
};
export function readableNote(value: string): string {
  // Translate only known legacy boilerplate. Free-form source notes are never paraphrased.
  return notes[value] ? tr(notes[value]) : value;
}
export function readableBlocker(value: string): string {
  const labels: Record<string, string> = {
    'No imported connector implementation for this venue.':
      'Engineering: add this provider’s connector to the inventory.',
    'Resource evidence is not contracted or verified.':
      'Business team: attach written approval or evidence that access works.',
    'The resource has not been granted.':
      'Business team: confirm that the provider has granted access.',
    'A provider approval / resource reference is required.':
      'Business team: add the provider’s approval or agreement reference.',
    'The resource review or entitlement has expired.':
      'Business team: renew the access approval or review the expired information.',
    'An account reference is required.': 'Business team: identify the provider account to connect.',
    'A secret-store reference is required for private capabilities.':
      'Engineering: link the API credentials from the secret store.',
    'Connector inventory changed; save a new validation request.':
      'Engineering: the connector changed. Save a new request to use the latest version.',
  };
  const missingPrefix = 'Missing declared capabilities: ';
  if (value.startsWith(missingPrefix))
    return tr('Engineering: add support for {0}.', [
      value
        .slice(missingPrefix.length)
        .split(',')
        .map((item) => tr(capabilityLabels[item.trim()] || item.trim()).toLowerCase())
        .join(', '),
    ]);
  return labels[value] ? tr(labels[value]) : value;
}

export function readableTitle(value: string): string {
  if (value === 'Entity, product and customer access gate')
    return tr('Account eligibility needs confirmation');
  return value === 'Connector implemented; account resources unresolved'
    ? tr('Connection code available; exchange access needs confirmation')
    : value;
}
