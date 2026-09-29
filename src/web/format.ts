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
