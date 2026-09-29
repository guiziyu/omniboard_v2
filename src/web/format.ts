// 日期时间(frontend-spec 0.4):按界面语言,「年-月-日 时:分」,24 小时制,附时区缩写。
const intlLocale: Record<string, string> = { en: 'en-US', 'zh-CN': 'zh-CN', ko: 'ko-KR' };
export function formatTime(value: string | Date | null | undefined, locale = 'en'): string {
  if (!value) return '—';
  const parts = new Intl.DateTimeFormat(intlLocale[locale] ?? 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}
const qualifierPrefix: Record<string, string> = {
  at_least: '≥',
  at_most: '≤',
  more_than: '>',
  approximately: '≈',
};
/**
 * 指标数值(frontend-spec 0.4,v1 displayMetric):缺值「—」;限定符前缀;USD 加 $、/10 加后缀;
 * 完整显示千分位、小数截断到 2 位(BTC 4 位);紧凑显示 ≥1e6 时用 M/B/T。
 */
export function displayMetric(
  metric: { value: string | null; unit: string; qualifier?: string } | null | undefined,
  compact = false,
): string {
  if (!metric || metric.value === null) return '—';
  const prefix =
    (qualifierPrefix[metric.qualifier ?? ''] ?? '') + (metric.unit === 'USD' ? '$' : '');
  if (compact && Number(metric.value) >= 1_000_000) {
    const value = Number(metric.value);
    const [divisor, suffix] = value >= 1e12 ? [1e12, 'T'] : value >= 1e9 ? [1e9, 'B'] : [1e6, 'M'];
    return prefix + (value / divisor).toFixed(2) + suffix;
  }
  const [whole, decimal] = metric.value.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    prefix +
    grouped +
    (decimal ? `.${decimal.slice(0, metric.unit === 'BTC' ? 4 : 2)}` : '') +
    (metric.unit === '/10' ? '/10' : '')
  );
}
