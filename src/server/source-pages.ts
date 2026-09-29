import { load } from 'cheerio';
import { parse } from 'lossless-json';
import { z } from 'zod';
import type { SourceMetric, SourceRow, WebSourceId } from '../shared/sources';
// CMC / CoinGecko 公开排行页的解析(frontend-spec 9.7),从 v1 src/collectors/parsers.ts 迁移。
// 数字保留页面上的十进制字符串;任何一条校验不过就整批拒收,上一次成功批次继续生效。
export const sources = {
  cmc_web: {
    name: 'CoinMarketCap',
    url: 'https://coinmarketcap.com/rankings/exchanges/',
    parserVersion: 'cmc-html-v1',
  },
  coingecko_web: {
    name: 'CoinGecko',
    url: 'https://www.coingecko.com/en/exchanges',
    parserVersion: 'coingecko-html-v1',
  },
} satisfies Record<WebSourceId, { name: string; url: string; parserVersion: string }>;
const clean = (v: string) => v.replace(/\s+/g, ' ').trim();
export function metric(key: string, label: string, text: string, unit: string): SourceMetric {
  const rawText = clean(text);
  const numeric = rawText.replace(/^(?:\$|BTC)\s*/, '').replace(/,/g, '');
  const value = /^\d+(?:\.\d+)?$/.test(numeric) ? numeric : null;
  return {
    key,
    label,
    value,
    unit,
    rawText,
    precision: value === null ? null : value.split('.')[1]?.length || 0,
  };
}
const embeddedRow = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  rank: z.string().regex(/^\d+$/),
  spotVol24h: z.string().optional(),
  liquidity: z.string().optional(),
  visits: z.string().optional(),
  numMarkets: z.string().optional(),
  numCoins: z.string().optional(),
});
const cmcMetrics = (
  volume: string,
  liquidity: string,
  visits: string,
  markets: string,
  coins: string,
) => [
  metric('volume_24h', '24h spot volume', volume, 'USD'),
  metric('liquidity', 'Liquidity', liquidity, 'score'),
  metric('weekly_visits', 'Weekly visits', visits, 'visits'),
  metric('markets', 'Markets', markets, 'markets'),
  metric('coins', 'Coins', coins, 'coins'),
];
export function parsePage(source: WebSourceId, html: string, limit = 50): SourceRow[] {
  const $ = load(html);
  const title = $('title').text();
  if (/just a moment|access denied|verify you are human|attention required/i.test(title))
    throw new Error('The source returned a challenge page. The last successful batch is retained.');
  const table = $('table')
    .filter((_, el) => /Exchange/.test($(el).find('thead').text()))
    .first();
  const header = clean(table.find('thead').text());
  if (
    !/Exchange/.test(header) ||
    !(source === 'cmc_web' ? /Liquidity/.test(header) : /Trust Score/.test(header))
  )
    throw new Error('Page headers changed. Metric definitions could not be verified.');
  const rows: SourceRow[] = [];
  table.find('tbody tr').each((_, el) => {
    const cells = $(el).find('td');
    const a = cells.eq(1).find('a[href*="/exchanges/"]').first();
    const name = clean(a.text());
    const href = a.attr('href');
    const rank = Number(clean(cells.eq(0).text()));
    if (!name || !href || !Number.isInteger(rank) || rank < 1) return;
    const url = new URL(href, sources[source].url);
    if (url.origin !== new URL(sources[source].url).origin)
      throw new Error('Unexpected exchange link domain.');
    const slug = url.pathname.split('/').filter(Boolean).at(-1)!;
    if (!/^[a-z0-9_-]+$/.test(slug)) return;
    const volume = clean(cells.eq(source === 'cmc_web' ? 2 : 3).text());
    const metrics =
      source === 'cmc_web'
        ? cmcMetrics(
            volume,
            cells.eq(3).text(),
            cells.eq(4).text(),
            cells.eq(5).text(),
            cells.eq(6).text(),
          )
        : [
            metric(
              'trust_score',
              'Trust Score',
              clean(cells.eq(2).text()).replace('/10', ''),
              '/10',
            ),
            // 按页面显示的币种与精度,不取页面里隐藏的换算值。
            metric(
              'volume_24h',
              '24h volume',
              volume,
              /^BTC/.test(volume) ? 'BTC' : /^\$/.test(volume) ? 'USD' : 'unknown',
            ),
          ];
    if (metrics.find((m) => m.key === 'volume_24h')?.unit === 'unknown')
      throw new Error('The volume currency could not be verified.');
    rows.push({ slug, name, url: url.href, rank, metrics });
  });
  if (source === 'cmc_web' && $('#__NEXT_DATA__').length) {
    // CMC 只在服务端渲染前 10 行,其余在 __NEXT_DATA__ 里。先用可见行核对内嵌数据的身份、名次和现货量,
    // 核对通过才采用其余内嵌行。lossless-json 让数字保持原始字符串。
    const next = parse($('#__NEXT_DATA__').text(), null, (v) => v) as {
      props?: { pageProps?: { initialData?: { exchanges?: unknown[] } } };
    };
    const embedded = z.array(embeddedRow).parse(next.props?.pageProps?.initialData?.exchanges);
    for (const visible of rows.slice(0, 10)) {
      const e = embedded.find((e) => e.slug === visible.slug);
      const v = visible.metrics[0]?.value;
      if (
        !e ||
        e.name !== visible.name ||
        Number(e.rank) !== visible.rank ||
        (v !== null && v !== undefined && Math.abs(Number(v) - Number(e.spotVol24h)) > 1)
      )
        throw new Error('Embedded data does not match the visible table.');
    }
    for (const e of embedded) {
      if (rows.some((r) => r.slug === e.slug)) continue;
      rows.push({
        slug: e.slug,
        name: e.name,
        rank: Number(e.rank),
        url: `https://coinmarketcap.com/exchanges/${e.slug}/`,
        metrics: cmcMetrics(
          e.spotVol24h || '',
          e.liquidity || '',
          e.visits || '',
          e.numMarkets || '',
          e.numCoins || '',
        ),
      });
    }
  }
  const selected = rows.sort((a, b) => a.rank - b.rank).slice(0, limit);
  if (
    selected.length < Math.min(limit, 10) ||
    new Set(selected.map((r) => r.slug)).size !== selected.length ||
    new Set(selected.map((r) => r.rank)).size !== selected.length
  )
    throw new Error('Insufficient valid rows or duplicate entity identifiers/ranks.');
  if (
    selected.filter((r) => r.metrics.some((m) => m.key === 'volume_24h' && m.value !== null))
      .length <
    selected.length * 0.8
  )
    throw new Error('Insufficient volume coverage. Batch rejected.');
  return selected;
}
