// 工作台数据(frontend-spec 10.1 刷新规则),从 v1 src/web/composables/useWorkFeed.ts 迁移:
// 页面可见且没有弹窗时每 30 秒刷新,窗口重新获得焦点时刷新;较慢返回的旧请求结果丢弃。
import { onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { WorkFeed } from '../shared/operations';
import { api, errorText } from './api';

export function useWorkFeed(
  organizationId: MaybeRefOrGetter<string>,
  paused: MaybeRefOrGetter<boolean>,
) {
  const feed = ref<WorkFeed>();
  const loading = ref(false);
  const error = ref('');
  let serial = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function load() {
    const request = ++serial;
    loading.value = true;
    error.value = '';
    const org = toValue(organizationId);
    try {
      const result = await api<WorkFeed>(
        '/api/work' + (org ? '?organizationId=' + encodeURIComponent(org) : ''),
      );
      if (request === serial) feed.value = result;
    } catch (e) {
      if (request === serial) error.value = errorText(e);
    } finally {
      if (request === serial) loading.value = false;
    }
  }
  const refreshVisible = () => {
    if (!toValue(paused) && !document.hidden) void load();
  };
  watch(
    () => toValue(organizationId),
    () => void load(),
    { immediate: true },
  );
  onMounted(() => {
    timer = setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible);
  });
  onUnmounted(() => {
    serial++;
    clearInterval(timer);
    window.removeEventListener('focus', refreshVisible);
  });
  return { feed, loading, error, load };
}
