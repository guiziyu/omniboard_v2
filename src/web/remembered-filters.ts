import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { filterPreferenceKey, filterValues, type FilterScope } from '../shared/filter-preferences';
import { session } from './api';
/**
 * 最近筛选自动记忆(frontend-spec 2.11):从别的页面进入或换了账号时,URL 不带任何 query 就用记忆恢复;
 * 带任何 query 就以链接为准。每次变化都写回记忆。存储不可用时不影响筛选。
 */
export function useRememberedFilters(scope: FilterScope) {
  const route = useRoute();
  const router = useRouter();
  const path = `/w/internal/${scope}`;
  let previousPath = '';
  let previousUser = '';
  watch(
    () => [route.fullPath, session.user?.id],
    () => {
      const user = session.user;
      if (!user) return;
      const entering = previousPath !== path || previousUser !== user.id;
      previousPath = route.path;
      previousUser = user.id;
      if (route.path !== path) return;
      const key = filterPreferenceKey(user.id, scope);
      try {
        if (entering && !Object.keys(route.query).length) {
          const saved = filterValues(scope, JSON.parse(localStorage.getItem(key) || '{}'));
          if (Object.keys(saved).length) {
            void router.replace({ path, query: saved });
            return;
          }
        }
        localStorage.setItem(key, JSON.stringify(filterValues(scope, route.query)));
      } catch {
        // 存储是可选的;URL 与筛选照常可用。
      }
    },
    { immediate: true },
  );
}
