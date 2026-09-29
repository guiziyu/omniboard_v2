// 从 v1 src/modules/registry.ts 迁移,内容保持一致。
import type { TabDefinition, Tag } from './types';
// Read from organization context, to relationships, evaluation, integration, then discussion.
export const tabs: TabDefinition[] = [
  {
    id: 'roadmap',
    title: 'Roadmap',
    shortTitle: 'Roadmap',
    order: 115,
    kind: 'records',
    description:
      'Milestones, target dates and progress for the organization and our collaboration.',
  },
  {
    id: 'relationships',
    title: 'Relationships',
    shortTitle: 'Relationships',
    order: 55,
    kind: 'records',
    description: 'Shared objects, connections and evidence across the organization.',
  },
  {
    id: 'services',
    title: 'Services',
    shortTitle: 'Services',
    order: 25,
    kind: 'records',
    description: 'Products, service scope and commercial capabilities, with original references.',
  },
  {
    id: 'market_access',
    title: 'Market Access',
    shortTitle: 'Market Access',
    order: 26,
    kind: 'records',
    description: 'Asset classes, venues, trading channels and customer eligibility.',
  },
  {
    id: 'payments',
    title: 'Payments & Settlement',
    shortTitle: 'Payments',
    order: 27,
    kind: 'records',
    description: 'Payment rails, currencies, settlement access and treasury services.',
  },
  {
    id: 'custody',
    title: 'Custody',
    shortTitle: 'Custody',
    order: 28,
    kind: 'records',
    description: 'Safekeeping, asset support, control models and settlement services.',
  },
  {
    id: 'data_coverage',
    title: 'Data Coverage',
    shortTitle: 'Data Coverage',
    order: 29,
    kind: 'records',
    description: 'Datasets, historical coverage, delivery formats and licensing scope.',
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    shortTitle: 'Infrastructure',
    order: 30,
    kind: 'records',
    description: 'Hosting, connectivity, deployment locations and service conditions.',
  },
  {
    id: 'contacts',
    title: 'Contacts',
    shortTitle: 'Contacts',
    order: 40,
    kind: 'records',
    description: 'Official channels, people, email addresses and relationship progress.',
  },
  {
    id: 'overview',
    title: 'Overview',
    shortTitle: 'Overview',
    order: 10,
    kind: 'overview',
    description: 'Organization profile, key figures and useful links.',
  },
  {
    id: 'org_chart',
    title: 'Org Chart',
    shortTitle: 'Org Chart',
    order: 50,
    kind: 'chart',
    description: 'People, roles and reporting lines, backed by original references.',
  },
  {
    id: 'people_movements',
    title: 'People Movements',
    shortTitle: 'People Movements',
    order: 60,
    kind: 'timeline',
    description: 'Track arrivals, departures and role changes.',
  },
  {
    id: 'stats',
    title: 'Stats',
    shortTitle: 'Stats',
    order: 20,
    kind: 'stats',
    description: 'Explore metrics with their sources, units and observation dates.',
  },
  {
    id: 'comments',
    title: 'Comments',
    shortTitle: 'Comments',
    order: 120,
    kind: 'comments',
    description: 'Team discussions and handover notes.',
  },
  {
    id: 'api_optimization',
    title: 'API Optimization',
    shortTitle: 'API Optimization',
    order: 100,
    kind: 'records',
    description: 'Connections, rate limits, latency and order constraints.',
  },
  {
    id: 'capital_optimization',
    title: 'Capital Optimization',
    shortTitle: 'Capital Optimization',
    order: 80,
    kind: 'records',
    description: 'Fees, margin, collateral and funding terms in context.',
  },
  {
    id: 'tech_stack',
    title: 'Tech Stack',
    shortTitle: 'Tech Stack',
    order: 90,
    kind: 'records',
    description: 'Provider technology and internal integration knowledge.',
  },
  {
    id: 'compliance',
    title: 'Compliance',
    shortTitle: 'Compliance',
    order: 70,
    kind: 'records',
    description: 'Who can access each product, which regional rules apply, and what supports them.',
  },
  {
    id: 'onboarding',
    title: 'Onboarding',
    shortTitle: 'Onboarding',
    order: 110,
    kind: 'records',
    description:
      'Track the provider connection, account approvals and next steps for business and engineering.',
  },
];
// Availability is independent of navigation order. Keep shared modules available to every tag.
export const baseTabIds = [
  'overview',
  'stats',
  'contacts',
  'org_chart',
  'relationships',
  'people_movements',
  'roadmap',
  'comments',
];
export const tagBundles: Record<Tag, string[]> = {
  exchange: ['api_optimization', 'capital_optimization', 'tech_stack', 'compliance', 'onboarding'],
  broker: [
    'services',
    'market_access',
    'api_optimization',
    'capital_optimization',
    'tech_stack',
    'compliance',
    'onboarding',
  ],
  // Research subjects: no provider-access workflow unless another tag supplies it.
  market_maker: ['services', 'tech_stack'],
  hedge_fund: ['services'],
  trading_company: ['services', 'market_access'],
  think_tank: ['services', 'data_coverage'],
  // Service providers: capabilities belong in their specialist module.
  bank: ['services', 'payments', 'capital_optimization', 'compliance', 'onboarding'],
  custodian: ['services', 'custody', 'compliance', 'onboarding'],
  data_provider: ['services', 'data_coverage', 'onboarding'],
  infrastructure_provider: ['services', 'infrastructure', 'onboarding'],
  connectivity_provider: ['services', 'infrastructure', 'onboarding'],
  company: [],
  government: [],
};
export function tabsFor(tags: Tag[]): TabDefinition[] {
  const ids = new Set([...baseTabIds, ...tags.flatMap((tag) => tagBundles[tag])]);
  return tabs.filter((t) => ids.has(t.id)).sort((a, b) => a.order - b.order);
}
export function unionTabs(a: Tag[], b: Tag[]): TabDefinition[] {
  const ids = new Set([...tabsFor(a), ...tabsFor(b)].map((t) => t.id));
  return tabs.filter((t) => ids.has(t.id)).sort((a, b) => a.order - b.order);
}
/**
 * v2 移植中:这些模块的专用面板与写入规则还没迁过来(路线图)。
 * 期间界面显示「正在迁移」,服务端拒绝写入,移植完成后从这里删除。
 */
export const pendingModules = ['roadmap'];
