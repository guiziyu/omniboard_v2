// 机构 tag(frontend-spec 4.2),从 v1 src/modules/tags.ts 迁移。
export const tagIds = [
  'exchange',
  'broker',
  'market_maker',
  'bank',
  'custodian',
  'data_provider',
  'infrastructure_provider',
  'connectivity_provider',
  'think_tank',
  'trading_company',
  'hedge_fund',
  'company',
  'government',
] as const;
export type OrganizationTag = (typeof tagIds)[number];
export const tagDefinitions: Record<OrganizationTag, { title: string; plural: string }> = {
  exchange: { title: 'Exchange', plural: 'Exchanges' },
  broker: { title: 'Broker', plural: 'Brokers' },
  market_maker: { title: 'Market Maker', plural: 'Market Makers' },
  bank: { title: 'Bank', plural: 'Banks' },
  custodian: { title: 'Custodian', plural: 'Custodians' },
  data_provider: { title: 'Data Provider', plural: 'Data Providers' },
  infrastructure_provider: { title: 'Infrastructure Provider', plural: 'Infrastructure Providers' },
  connectivity_provider: { title: 'Connectivity Provider', plural: 'Connectivity Providers' },
  think_tank: { title: 'Think Tank', plural: 'Think Tanks' },
  trading_company: { title: 'Trading Company', plural: 'Trading Companies' },
  hedge_fund: { title: 'Hedge Fund', plural: 'Hedge Funds' },
  company: { title: 'Company', plural: 'Companies' },
  government: { title: 'Government', plural: 'Governments' },
};
export const isTag = (value: unknown): value is OrganizationTag =>
  tagIds.includes(value as OrganizationTag);

export function effectiveTags(tags: readonly OrganizationTag[]): OrganizationTag[] {
  return [...new Set([...tags, ...(tags.includes('exchange') ? ['company' as const] : [])])];
}
