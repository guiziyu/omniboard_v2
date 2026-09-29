// 列注册表(frontend-spec 3.4)。定义文字从 v1 src/modules/columns.ts 逐字迁移,列说明、排名口径与录入观测共用。
import { effectiveTags, type OrganizationTag as Tag } from './tags';
export interface ColumnDefinition {
  id: string;
  title: string;
  units: string[];
  period: 'annual' | 'current' | '24h';
  tags: Tag[];
  description: string;
  helpUrl?: string;
  defaultVisible: boolean;
  kind: 'metric' | 'count';
}
export const columns: ColumnDefinition[] = [
  {
    id: 'research_budget',
    title: 'Research budget',
    units: ['USD'],
    period: 'annual',
    tags: ['think_tank'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Annual research budget in USD. State the fiscal year and whether the figure covers the whole institution or one program.',
  },
  {
    id: 'research_publications',
    title: 'Publications',
    units: ['publications'],
    period: 'annual',
    tags: ['think_tank'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Published research outputs in the selected year. Specify whether reports, papers and commentary are included; different definitions are not directly comparable.',
  },
  {
    id: 'operating_markets',
    title: 'Operating markets',
    units: ['markets'],
    period: 'current',
    tags: ['trading_company'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Reported geographic markets served by the trading company. Preserve the source definition; this is not an exchange or trading-pair count.',
  },
  {
    id: 'fund_aum',
    title: 'Assets under management',
    units: ['USD'],
    period: 'current',
    tags: ['hedge_fund'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Reported assets under management in USD at the stated observation date. Specify the fund or manager, net or gross basis, and avoid mixing regulatory AUM with net asset value.',
  },
  {
    id: 'investment_strategies',
    title: 'Investment strategies',
    units: ['strategies'],
    period: 'current',
    tags: ['hedge_fund'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Distinct investment strategies explicitly described by the fund manager. This is not a count of funds, accounts or individual trading models.',
  },
  {
    id: 'coverage_regions',
    title: 'Coverage regions',
    units: ['regions'],
    period: 'current',
    tags: ['connectivity_provider'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Documented coverage across six geographic groups: North America, Latin America, Europe, Middle East, Africa and Asia-Pacific. Partial coverage lists are lower bounds. These are not cloud regions, countries or PoPs.',
  },
  {
    id: 'network_routes',
    title: 'Network routes',
    units: ['routes'],
    period: 'current',
    tags: ['connectivity_provider'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Documented point-to-point transport routes, counting a bidirectional corridor once. This is not the number of customer circuits, PoPs or possible endpoint pairs. Partial published lists retain a lower-bound qualifier.',
  },
  {
    id: 'network_pops',
    title: 'Network PoPs',
    units: ['PoPs'],
    period: 'current',
    tags: ['connectivity_provider'],
    kind: 'metric',
    defaultVisible: true,
    description:
      'Provider-reported network points of presence. A PoP is a network access site, not a route, a geographic region or necessarily an owned data center.',
  },
  {
    id: 'network_markets',
    title: 'Network markets',
    units: ['markets'],
    period: 'current',
    tags: ['connectivity_provider'],
    kind: 'metric',
    defaultVisible: false,
    description:
      'Provider-reported markets reached by the connectivity service. Open the source definition; countries, cities and trading venues are not interchangeable.',
  },
  {
    id: 'connected_platforms',
    title: 'Connected platforms',
    units: ['platforms'],
    period: 'current',
    tags: ['broker'],
    description:
      'Provider-reported connected application or platform partners, not trading venues. Click a value for scope and source.',
    defaultVisible: false,
    kind: 'metric',
  },
  {
    id: 'settlement_volume_monthly',
    title: 'Monthly settlement',
    units: ['USD'],
    period: 'current',
    tags: ['custodian'],
    description:
      'Provider-reported monthly settlement volume. This is not assets under custody; reporting windows and covered services can differ.',
    defaultVisible: false,
    kind: 'metric',
  },
  {
    id: 'volume_24h',
    title: '24h volume',
    units: ['USD', 'BTC'],
    period: '24h',
    tags: ['exchange'],
    description:
      'Provider-reported 24-hour spot trading volume. Currencies are ranked separately, without conversion.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'liquidity',
    title: 'Liquidity',
    units: ['score'],
    period: 'current',
    tags: ['exchange'],
    description:
      'CoinMarketCap’s average liquidity score across an exchange’s trading pairs. Higher scores mean trades are expected to move prices less.',
    helpUrl:
      'https://support.coinmarketcap.com/hc/en-us/articles/360043836931-Liquidity-Score-Market-Pair-Exchange',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'trust_score',
    title: 'Trust score',
    units: ['/10'],
    period: 'current',
    tags: ['exchange'],
    description:
      'CoinGecko’s exchange rating out of 10. It considers liquidity, cybersecurity, regulation, incident history and reserve disclosures. Higher means a stronger rating in its model.',
    helpUrl:
      'https://support.coingecko.com/hc/en-us/articles/36442561461657-Trust-Score-Methodology',
    defaultVisible: false,
    kind: 'metric',
  },
  {
    id: 'markets',
    title: 'Markets',
    units: ['markets'],
    period: 'current',
    tags: ['exchange'],
    description:
      'The number of trading pairs reported by the source, such as BTC/USDT. One coin can trade in several markets.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'coins',
    title: 'Coins',
    units: ['coins'],
    period: 'current',
    tags: ['exchange'],
    description: 'Number of listed coins reported by the source.',
    defaultVisible: false,
    kind: 'metric',
  },
  {
    id: 'weekly_visits',
    title: 'Weekly visits',
    units: ['visits'],
    period: 'current',
    tags: ['exchange'],
    description:
      'The source’s estimate of website visits in a week. Repeat visits can be counted, so this is not the number of individual users.',
    defaultVisible: false,
    kind: 'metric',
  },
  {
    id: 'revenue',
    title: 'Revenue',
    units: ['USD'],
    period: 'annual',
    tags: ['company', 'trading_company'],
    description:
      'Annual revenue in USD. Use the same fiscal year; explain reporting entity and consolidation in the assumptions.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'headcount',
    title: 'Headcount',
    units: ['people'],
    period: 'current',
    tags: ['company', 'think_tank', 'trading_company', 'hedge_fund'],
    description:
      'Reported number of employees. Explain full-time, contractor or group coverage in the assumptions.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'gdp',
    title: 'GDP',
    units: ['USD'],
    period: 'annual',
    tags: ['government'],
    description:
      'Annual nominal GDP in USD for the represented economy. State the jurisdiction and measurement basis.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'population',
    title: 'Population',
    units: ['people'],
    period: 'annual',
    tags: ['government'],
    description:
      'Population of the represented jurisdiction for the selected year. State the estimate date and coverage.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'execution_venues',
    title: 'Execution venues',
    units: ['venues'],
    period: 'current',
    tags: ['broker', 'market_maker'],
    description:
      'Provider-reported exchange or execution-venue coverage. Scope and snapshot date differ; open the value for the exact coverage and any lower-bound qualifier.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'supported_currencies',
    title: 'Supported currencies',
    units: ['currencies'],
    period: 'current',
    tags: ['broker', 'bank'],
    description:
      'Provider-reported trading, funding or payment currency coverage. Inspect the value for which service is counted; payment reach is not account eligibility.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'instruments',
    title: 'Instruments',
    units: ['instruments'],
    period: 'current',
    tags: ['broker'],
    description:
      'Number of instruments reported for the specified brokerage product. Instrument types and regional eligibility are preserved in the source assumptions.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'liquidity_assets',
    title: 'Liquidity assets',
    units: ['assets'],
    period: 'current',
    tags: ['market_maker'],
    description:
      'Digital assets for which the provider reports liquidity. Asset coverage does not guarantee a quote size, spread, or approved credit line.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'trading_counterparties',
    title: 'Trading counterparties',
    units: ['counterparties'],
    period: 'current',
    tags: ['market_maker'],
    description:
      'Provider-reported counterparties within the stated scope. This is a scale indicator, not a credit or execution-quality score.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'payment_markets',
    title: 'Payment markets',
    units: ['markets'],
    period: 'current',
    tags: ['bank'],
    description:
      'Provider-reported countries or markets reachable through the stated payment service. Availability is subject to entity, currency and customer eligibility.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'bank_assets',
    title: 'Total assets',
    units: ['USD', 'EUR', 'GBP'],
    period: 'annual',
    tags: ['bank'],
    description:
      'Reported bank balance-sheet assets for the selected fiscal year and original currency. Compare the same currency and consolidation scope; no conversion is applied.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'custody_assets',
    title: 'Supported assets',
    units: ['assets'],
    period: 'current',
    tags: ['custodian'],
    description:
      'Provider-reported supported assets or tokens within the specified custody service. Token counts and native network counts are different measures.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'custody_networks',
    title: 'Supported networks',
    units: ['networks'],
    period: 'current',
    tags: ['custodian'],
    description:
      'Blockchain networks reported for custody or staking, as identified in the source assumptions. Product scope and network availability may differ.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'assets_under_custody',
    title: 'Assets under custody',
    units: ['USD'],
    period: 'current',
    tags: ['custodian'],
    description:
      'Provider-reported assets held in custody at the cited date. This does not include assets under administration unless the source explicitly uses that definition.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'data_venues',
    title: 'Data venues',
    units: ['venues'],
    period: 'current',
    tags: ['data_provider'],
    description:
      'Trading venues covered by the cited data product. Coverage varies by dataset, historical date and subscription.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'data_history_start',
    title: 'History starts',
    units: ['year'],
    period: 'current',
    tags: ['data_provider'],
    description:
      'Earliest history advertised for the stated dataset. A smaller year means deeper history; it does not mean every instrument is available from that year.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'data_instruments',
    title: 'Data instruments',
    units: ['instruments'],
    period: 'current',
    tags: ['data_provider'],
    description:
      'Provider-reported instruments, assets or symbols for the specific dataset. Check the definition before comparing providers.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'cloud_regions',
    title: 'Cloud regions',
    units: ['regions'],
    period: 'current',
    tags: ['infrastructure_provider'],
    description:
      'Operational cloud regions reported by the provider. Regions, availability zones, edge sites and planned locations are different units.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'datacenter_locations',
    title: 'Data center locations',
    units: ['locations'],
    period: 'current',
    tags: ['infrastructure_provider'],
    description:
      'Operational data centers or hosting locations in the cited service. The assumptions specify whether this is a facility, metro or exchange-hosting count.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'availability_sla',
    title: 'Availability SLA',
    units: ['%'],
    period: 'current',
    tags: ['infrastructure_provider'],
    description:
      'Contractual or advertised availability target for a named service and deployment configuration. This is not observed uptime; inspect exclusions and prerequisites.',
    defaultVisible: true,
    kind: 'metric',
  },
  {
    id: 'record_count',
    title: 'Records',
    units: ['records'],
    period: 'current',
    tags: [],
    description:
      'The number of saved research entries you can access for this organization, including people, contacts, notes and records in other tabs.',
    defaultVisible: true,
    kind: 'count',
  },
];
export function columnsFor(tag: Tag | ''): ColumnDefinition[] {
  const tags = tag ? effectiveTags([tag]) : [];
  return columns
    .filter((c) => !c.tags.length || c.tags.some((t) => tags.includes(t)))
    .map((c) => ({
      ...c,
      defaultVisible: c.defaultVisible && !(tag === 'exchange' && c.tags.includes('company')),
    }));
}
export function organizationColumns(tags: Tag[]): ColumnDefinition[] {
  const effective = effectiveTags(tags);
  return columns.filter((c) => c.kind === 'metric' && c.tags.some((t) => effective.includes(t)));
}
export function defaultSort(tag: Tag | ''): string {
  return (
    (
      {
        exchange: 'volume_24h',
        company: 'revenue',
        government: 'gdp',
        broker: 'execution_venues',
        market_maker: 'execution_venues',
        bank: 'payment_markets',
        custodian: 'custody_assets',
        data_provider: 'data_venues',
        infrastructure_provider: 'datacenter_locations',
        connectivity_provider: 'coverage_regions',
      } as Record<string, string>
    )[tag] || 'record_count'
  );
}
export const reportingYear = (now = Date.now()) => String(new Date(now).getUTCFullYear() - 1);
export function metricPeriod(column: ColumnDefinition, year: string): string {
  return column.period === 'annual' ? year : column.period;
}
export const metricLabel = (key: string, fallback = key) =>
  columns.find((c) => c.id === key)?.title || fallback;
export const qualifiers = ['exact', 'at_least', 'at_most', 'more_than', 'approximately'] as const;
export type Qualifier = (typeof qualifiers)[number];
export const metricBases = ['preferred', 'cmc_web', 'coingecko_web', 'manual'] as const;
export type MetricBasis = (typeof metricBases)[number];
/** 一个机构在某列的一条候选值:采集观测或团队观测(frontend-spec 9.1)。 */
export interface MetricPoint {
  id: string;
  organizationId: string;
  columnId: string;
  value: string;
  unit: string;
  period: string;
  source: string;
  sourceName: string;
  sourceUrl: string;
  evidenceId: string;
  capturedAt: string;
  assumptions: string;
  sequence: number;
  qualifier: Qualifier;
}
export interface DirectoryOrganization {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  tags: Tag[];
  recordCount: number;
  createdAt: string;
  rank: number | null;
  values: Record<string, MetricPoint | null>;
}
const sourcePriority = (source: string) =>
  source === 'cmc_web' ? 0 : source === 'coingecko_web' ? 1 : 2;
/** 值选择(9.1):同列、同单位、同期间;优先 CMC → CoinGecko → 团队观测,其次最新。 */
export function choosePoint(
  points: MetricPoint[],
  column: ColumnDefinition,
  unit: string,
  year: string,
  basis: MetricBasis,
): MetricPoint | null {
  return (
    points
      .filter(
        (p) =>
          p.columnId === column.id &&
          p.unit === unit &&
          p.period === metricPeriod(column, year) &&
          (basis === 'preferred' || p.source === basis),
      )
      .sort(
        (a, b) =>
          sourcePriority(a.source) - sourcePriority(b.source) ||
          b.capturedAt.localeCompare(a.capturedAt) ||
          b.sequence - a.sequence ||
          b.id.localeCompare(a.id),
      )[0] || null
  );
}
export function selectionPolicy(column: ColumnDefinition, basis: MetricBasis): string {
  if (!column.tags.includes('exchange') || basis === 'manual')
    return 'Use the latest saved observation with the selected unit and reporting period. Inspect its original source and scope.';
  return basis === 'preferred'
    ? 'Prefer CoinMarketCap, then CoinGecko, then team observations.'
    : 'Use ' + (basis === 'cmc_web' ? 'CoinMarketCap' : 'CoinGecko') + ' only.';
}
