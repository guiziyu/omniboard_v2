import type { Client } from './db';
import type { WebSourceId } from '../shared/sources';
// 来源身份(frontend-spec 9.4),从 v1 src/server/exchange-identities.ts 迁移。

// 人工核对过的现货交易所档案对:[名称, CMC slug, CoinGecko slug]。不按名称合并,地区实体和衍生品场所
// 不合并;只有两边的档案都核对过才加一对。
export const exchangeIdentities = [
  ['Binance', 'binance', 'binance'],
  // 两边的档案都链接到 https://www.binance.us/,与全球 Binance 不是同一实体。
  ['Binance.US', 'binance-us', 'binance_us'],
  ['Coinbase Exchange', 'coinbase-exchange', 'coinbase-exchange'],
  ['Upbit', 'upbit', 'upbit'],
  ['OKX', 'okx', 'okx'],
  ['Bybit', 'bybit', 'bybit_spot'],
  ['Bitget', 'bitget', 'bitget'],
  ['Gate', 'gate', 'gate'],
  ['KuCoin', 'kucoin', 'kucoin'],
  ['MEXC', 'mexc', 'mexc'],
  ['Crypto.com Exchange', 'crypto-com-exchange', 'crypto_com'],
  ['Bitfinex', 'bitfinex', 'bitfinex'],
  ['BingX', 'bingx', 'bingx'],
  ['Kraken', 'kraken', 'kraken'],
  ['LBank', 'lbank', 'lbank'],
  ['Bitstamp by Robinhood', 'bitstamp', 'bitstamp'],
  ['Bithumb', 'bithumb', 'bithumb'],
  ['Gemini', 'gemini', 'gemini'],
  ['Pionex', 'pionex', 'pionex'],
  ['Toobit', 'toobit', 'toobit'],
  ['Ourbit', 'ourbit', 'ourbit'],
  ['CoinW', 'coinw', 'coinw'],
  ['WhiteBIT', 'whitebit', 'whitebit'],
  ['WEEX', 'weex', 'weex'],
  ['Bitunix', 'bitunix', 'bitunix'],
  ['Bitvavo', 'bitvavo', 'bitvavo'],
] as const;

/**
 * 新出现的 slug 在对照表里有另一来源的配对档案时,返回那份档案所属的(规范)机构。
 * 另一来源的档案已被管理员改过映射、或那个机构已经有本来源的链接时不配对:管理员的决定优先,
 * 同一机构对同一来源只有一个链接。
 */
export async function knownExchangeOrganization(
  client: Client,
  source: WebSourceId,
  slug: string,
): Promise<string | undefined> {
  const pair = exchangeIdentities.find((p) => p[source === 'cmc_web' ? 1 : 2] === slug);
  if (!pair) return undefined;
  const otherSource = source === 'cmc_web' ? 'coingecko_web' : 'cmc_web';
  const otherSlug = pair[source === 'cmc_web' ? 2 : 1];
  const result = await client.query<{ id: string }>(
    `SELECT org.id
       FROM omniboard.source_entity_links l
       LEFT JOIN omniboard.organization_aliases a ON a.alias_id = l.organization_id
       CROSS JOIN LATERAL (SELECT COALESCE(a.organization_id, l.organization_id) AS id) org
       JOIN omniboard.organization_tags t ON t.organization_id = org.id AND t.tag = 'exchange'
      WHERE l.source = $1 AND l.slug = $2 AND l.mapped_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM omniboard.source_entity_links existing
                         WHERE existing.organization_id = org.id AND existing.source = $3)`,
    [otherSource, otherSlug, source],
  );
  return result.rows[0]?.id;
}
