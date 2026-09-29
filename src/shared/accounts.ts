// 交易账户规则(data-model 5.1):与 quant `auth_model_to_auth` 的解析一致,另加 v2 规则。前端表单与服务端共用;
// 库上不加约束,账户只通过 v2 维护(proposal §4)。任一行不合规,quant 读取时整张快照拒收。

/** 可新建的交易所(`ExchangeName` 变体名,大小写精确)。 */
export const exchanges = [
  'Aster',
  'Binance',
  'BinanceUS',
  'Bitget',
  'Bithumb',
  'Bybit',
  'Coinbase',
  'Deribit',
  'Gate',
  'HTX',
  'Hyperliquid',
  'Kalshi',
  'KuCoin',
  'Lighter',
  'Okx',
  'Polymarket',
  'Upbit',
  'XT',
] as const;
/** 已退役:历史行仍合法,不开放新建。 */
export const retiredExchanges = ['CoinEx'] as const;
export type Exchange = (typeof exchanges)[number];

/** `AccountTag` 的无值变体(serde 写成字符串)。 */
export const flagTags = [
  'Unified',
  'ReadOnly',
  'Terminated',
  'Initializing',
  'Test',
  'LowLatencyAccount',
  'AdditionalLeverageRiskLimits',
  'ArbitrageAccount',
] as const;
/** 带值变体(serde 写成单键对象)。后两种结构复杂,v2 不编辑,原样保留。 */
export const valueTags = [
  'PortfolioGroup',
  'VipLevel',
  'MarketMakerLevel',
  'Client',
  'ListingTagBlocklist',
  'WalletBlocked',
] as const;
export type AccountTag = string | Record<string, unknown>;

export const authIdOf = (exchange: string, accountName: string) => `${exchange}_${accountName}`;
export const tagName = (tag: AccountTag) => (typeof tag === 'string' ? tag : Object.keys(tag)[0]!);
export const hasTag = (tags: AccountTag[], name: string) => tags.some((t) => tagName(t) === name);
const byte = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255;

/** 单个标签不合规的原因;合规返回 null。 */
export function tagProblem(tag: unknown): string | null {
  if (typeof tag === 'string')
    return (flagTags as readonly string[]).includes(tag) ? null : `unknown tag ${tag}`;
  if (!tag || typeof tag !== 'object' || Array.isArray(tag))
    return 'a tag must be a string or an object';
  const keys = Object.keys(tag);
  if (keys.length !== 1) return 'a tag object must have exactly one key';
  const [name] = keys as [string];
  const value = (tag as Record<string, unknown>)[name];
  switch (name) {
    case 'PortfolioGroup':
      return typeof value === 'string' ? null : 'PortfolioGroup must be a string';
    case 'VipLevel':
    case 'MarketMakerLevel':
      return byte(value) ? null : `${name} must be an integer from 0 to 255`;
    case 'Client': {
      const clientName = (value as { client_name?: unknown } | null)?.client_name;
      return value && typeof value === 'object' && typeof clientName === 'string'
        ? null
        : 'Client must have a client_name';
    }
    case 'ListingTagBlocklist':
      return Array.isArray(value) ? null : 'ListingTagBlocklist must be a list';
    case 'WalletBlocked':
      return null;
    default:
      return `unknown tag ${name}`;
  }
}
/** 解析 `account_tags` 文本;不合规时抛出原因。 */
export function parseTags(text: string | null): AccountTag[] {
  if (text === null) throw new Error('account_tags is NULL');
  let tags: unknown;
  try {
    tags = JSON.parse(text);
  } catch {
    throw new Error('account_tags is not valid JSON');
  }
  if (!Array.isArray(tags)) throw new Error('account_tags must be a JSON list');
  for (const tag of tags) {
    const problem = tagProblem(tag);
    if (problem) throw new Error(problem);
  }
  return tags as AccountTag[];
}

const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/** Rust `IpAddr` 能解析的地址:IPv4 点分十进制(不带前导零)或 IPv6;不接受 CIDR 与 zone。 */
export function isIp(value: string): boolean {
  if (ipv4.test(value)) return true;
  if (!value.includes(':') || /[^0-9a-fA-F:.]/.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname !== '';
  } catch {
    return false;
  }
}

export type AccountStatus = 'terminated' | 'read-only' | 'test' | 'initializing' | 'live';
/** 12.7:按优先级取第一个。 */
export function accountStatus(tags: AccountTag[]): AccountStatus {
  if (hasTag(tags, 'Terminated')) return 'terminated';
  if (hasTag(tags, 'ReadOnly')) return 'read-only';
  if (hasTag(tags, 'Test')) return 'test';
  if (hasTag(tags, 'Initializing')) return 'initializing';
  return 'live';
}

/** 表单里的账户设置(12.7);`ListingTagBlocklist`、`WalletBlocked`、`Terminated` 不在表单里,写回时原样保留。 */
export type AccountSettings = {
  type: 'live' | 'test' | 'read-only';
  portfolioGroup: string;
  initializing: boolean;
  unified: boolean;
  lowLatency: boolean;
  arbitrage: boolean;
  additionalLeverage: boolean;
  vipLevel: number | null;
  marketMakerLevel: number | null;
  clientName: string;
};
export const flagLabels = {
  unified: ['Unified', 'Unified'],
  lowLatency: ['LowLatencyAccount', 'Low-latency account'],
  arbitrage: ['ArbitrageAccount', 'Arbitrage account'],
  additionalLeverage: ['AdditionalLeverageRiskLimits', 'Additional leverage risk limits'],
  initializing: ['Initializing', 'Initializing'],
} as const;
const valueOf = (tags: AccountTag[], name: string) =>
  (tags.find((t) => typeof t === 'object' && name in t) as Record<string, unknown> | undefined)?.[
    name
  ];
export function settingsOf(tags: AccountTag[]): AccountSettings {
  const level = (name: string) => {
    const v = valueOf(tags, name);
    return typeof v === 'number' ? v : null;
  };
  return {
    type: hasTag(tags, 'ReadOnly') ? 'read-only' : hasTag(tags, 'Test') ? 'test' : 'live',
    portfolioGroup: String(valueOf(tags, 'PortfolioGroup') ?? ''),
    initializing: hasTag(tags, 'Initializing'),
    unified: hasTag(tags, 'Unified'),
    lowLatency: hasTag(tags, 'LowLatencyAccount'),
    arbitrage: hasTag(tags, 'ArbitrageAccount'),
    additionalLeverage: hasTag(tags, 'AdditionalLeverageRiskLimits'),
    vipLevel: level('VipLevel'),
    marketMakerLevel: level('MarketMakerLevel'),
    clientName: String((valueOf(tags, 'Client') as { client_name?: string })?.client_name ?? ''),
  };
}
/** 写回的顺序按 quant `AccountTag` 的变体顺序;不在表单里的标签从 `current` 原样保留。 */
const order = [
  'Unified',
  'ReadOnly',
  'Terminated',
  'Initializing',
  'Test',
  'ListingTagBlocklist',
  'LowLatencyAccount',
  'PortfolioGroup',
  'WalletBlocked',
  'AdditionalLeverageRiskLimits',
  'VipLevel',
  'MarketMakerLevel',
  'ArbitrageAccount',
  'Client',
];
const kept = ['Terminated', 'ListingTagBlocklist', 'WalletBlocked'];
export function tagsOf(settings: AccountSettings, current: AccountTag[] = []): AccountTag[] {
  const tags: AccountTag[] = current.filter((t) => kept.includes(tagName(t)));
  if (settings.unified) tags.push('Unified');
  if (settings.type === 'read-only') tags.push('ReadOnly');
  if (settings.initializing) tags.push('Initializing');
  if (settings.type === 'test') tags.push('Test');
  if (settings.lowLatency) tags.push('LowLatencyAccount');
  if (settings.portfolioGroup) tags.push({ PortfolioGroup: settings.portfolioGroup });
  if (settings.additionalLeverage) tags.push('AdditionalLeverageRiskLimits');
  if (settings.vipLevel !== null) tags.push({ VipLevel: settings.vipLevel });
  if (settings.marketMakerLevel !== null)
    tags.push({ MarketMakerLevel: settings.marketMakerLevel });
  if (settings.arbitrage) tags.push('ArbitrageAccount');
  if (settings.clientName) tags.push({ Client: { client_name: settings.clientName } });
  return sortTags(tags);
}
/** 按变体顺序的稳定排序:同名标签维持原来的相对顺序。 */
export const sortTags = (tags: AccountTag[]) =>
  tags
    .map((tag, i) => [tag, i] as const)
    .sort(([a, i], [b, j]) => order.indexOf(tagName(a)) - order.indexOf(tagName(b)) || i - j)
    .map(([tag]) => tag);
/** serde_json 的紧凑写法,quant 与 DBeaver 看到的就是这个文本。 */
export const tagsText = (tags: AccountTag[]) => JSON.stringify(tags);

/** 白名单每行的问题(下标 → 提示);另返回整体问题。与 DB 约束同规则。 */
export function whitelistProblems(ips: string[], type: AccountSettings['type']) {
  const lines = new Map<number, string>();
  ips.forEach((ip, i) => {
    if (!isIp(ip)) lines.set(i, 'Not a valid IP address.');
  });
  const empty = type !== 'test' && ips.length === 0;
  return {
    lines,
    empty: empty ? 'Add at least one IP address. Only test accounts can omit it.' : '',
  };
}
export function settingsProblem(settings: AccountSettings): string {
  for (const [label, value] of [
    ['Portfolio group', settings.portfolioGroup],
    ['Client name', settings.clientName],
  ] as const)
    if (value !== value.trim()) return `${label} must not start or end with a space.`;
  for (const [label, value] of [
    ['VIP level', settings.vipLevel],
    ['Market maker level', settings.marketMakerLevel],
  ] as const)
    if (value !== null && !byte(value)) return `${label} must be a whole number from 0 to 255.`;
  return '';
}

export const statusLabel: Record<AccountStatus, string> = {
  terminated: 'Terminated',
  'read-only': 'Read-only',
  test: 'Test',
  initializing: 'Initializing',
  live: 'Live',
};
export type Account = {
  authId: string;
  exchange: string;
  accountName: string;
  /** 原文;解析失败时 tags 为空、tagsError 给出原因(owner 约束执行前的旧行可能如此)。 */
  accountTags: string | null;
  tags: AccountTag[];
  tagsError: string | null;
  ipWhitelist: string[] | null;
  owner: string | null;
  status: AccountStatus;
  keyFingerprint: string | null;
  lastChange: string | null;
};
export type OnboardingLink = {
  recordId: string;
  organizationId: string;
  organizationName: string;
  title: string;
  venueKey: string;
  resourceStage: string;
};
export type AccountDetail = Account & {
  verifiedAuthTags: string | null;
  verifiedAt: string | null;
  onboarding: OnboardingLink[];
  audit: {
    id: string;
    at: string;
    actorName: string;
    action: string;
    before: unknown;
    after: unknown;
  }[];
};
export type EgressIp = { ip: string; label: string };
export type AccountOptions = {
  egressIps: EgressIp[];
  portfolioGroups: string[];
  onboarding: OnboardingLink[];
};
