// 界面语言(frontend-spec 2.10):登录后以账号偏好为准;本地另存一份,只用于登录前按上次语言显示。
// 译文表从 v1 src/locales 迁移;缺译文时显示英文原文。
import { computed, watch } from 'vue';
import { isLocale, type Locale } from '../shared/locale';
import { translate } from '../shared/localization';
import { session } from './api';
function remembered(): Locale {
  try {
    const value = localStorage.getItem('omniboard.locale');
    return isLocale(value) ? value : 'en';
  } catch {
    return 'en';
  }
}
const fallback = remembered();
export const locale = computed<Locale>(() =>
  isLocale(session.user?.locale) ? session.user.locale : fallback,
);
watch(
  locale,
  (value) => {
    if (typeof document !== 'undefined') document.documentElement.lang = value;
    try {
      localStorage.setItem('omniboard.locale', value);
    } catch {
      // 存储被禁用时不影响账号偏好。
    }
  },
  { immediate: true },
);
export const tr = (message: string | null | undefined, values: readonly unknown[] = []) =>
  translate(locale.value, message, values);
