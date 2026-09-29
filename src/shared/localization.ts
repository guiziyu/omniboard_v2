// 从 v1 src/shared/localization.ts 迁移,内容保持一致。
import { messages } from '../locales';
import type { Locale } from './locale';
export const messageKey = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const translated = new Map(
  messages.map(([english, chinese, korean]) => [
    messageKey(english),
    { 'zh-CN': chinese, ko: korean },
  ]),
);
export function translate(
  locale: Locale,
  message: string | null | undefined,
  values: readonly unknown[] = [],
): string {
  if (!message) return '';
  const text = locale === 'en' ? message : translated.get(messageKey(message))?.[locale] || message;
  return text.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : placeholder,
  );
}
export const dateLocale = (locale: Locale) =>
  locale === 'en' ? 'en-US' : locale === 'ko' ? 'ko-KR' : 'zh-CN';
