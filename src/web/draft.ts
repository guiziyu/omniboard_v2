import { onUnmounted, ref, watch } from 'vue';
import { session } from './api';
import { tr } from './i18n';
/**
 * 表单草稿(frontend-spec 2.12、5.6):本标签页的 sessionStorage,按账号 + 作用域;附件不存。
 * 回到初始值时删除草稿;字段类型与当前表单不符的旧草稿丢弃;有未保存修改时离开页面弹出浏览器提示。
 * 从 v1 src/web/composables/useDraft.ts 迁移。
 */
export function useDraft<T extends object>(
  scope: string,
  read: () => T,
  apply: (value: T) => void,
) {
  const key = `omniboard.draft.${session.user?.id}.${scope}`;
  const storageError = ref('');
  let saved: T | undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const candidate = JSON.parse(raw);
      if (
        candidate &&
        typeof candidate === 'object' &&
        Object.entries(read()).every(([k, v]) => typeof candidate[k] === typeof v)
      )
        saved = candidate as T;
    }
  } catch {
    // 损坏或过期的草稿不妨碍编辑。
  }
  const hasDraft = ref(!!saved);
  let baseline = JSON.stringify(read());
  const stop = watch(
    read,
    (value) => {
      try {
        if (JSON.stringify(value) === baseline) {
          sessionStorage.removeItem(key);
          return;
        }
        sessionStorage.setItem(key, JSON.stringify(value));
        storageError.value = '';
      } catch {
        storageError.value = tr(
          'Draft storage is unavailable. Keep this page open until you save.',
        );
      }
    },
    { deep: true, flush: 'sync' },
  );
  function restore() {
    if (saved) {
      apply(saved);
      hasDraft.value = false;
    }
  }
  function clear() {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // 没有草稿要保留。
    }
    saved = undefined;
    hasDraft.value = false;
    baseline = JSON.stringify(read());
  }
  function leaving(event: BeforeUnloadEvent) {
    if (JSON.stringify(read()) !== baseline) event.preventDefault();
  }
  window.addEventListener('beforeunload', leaving);
  onUnmounted(() => {
    stop();
    window.removeEventListener('beforeunload', leaving);
  });
  return { hasDraft, restore, clear, storageError };
}
