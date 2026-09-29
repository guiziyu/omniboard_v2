// 从 v1 src/shared/locale.ts 迁移,内容保持一致。
export const locales = ['en', 'zh-CN', 'ko'] as const;
export type Locale = (typeof locales)[number];
export const localeNames: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ko: '한국어',
};
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
