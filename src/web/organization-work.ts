// 机构的我方工作摘要数据(frontend-spec 4.8、10.9),从 v1 src/web/composables/useOrganizationWork.ts 迁移。
import { onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { OrganizationWork } from '../shared/integration';
import { api, errorText } from './api';

/** revision 变了(记录的 id 或版本变化)就重新拉取。 */
export function useOrganizationWork(id: () => string, revision: () => string = () => '') {
  const work = ref<OrganizationWork>();
  const loading = ref(false);
  const error = ref('');
  let serial = 0;
  async function load() {
    const current = ++serial;
    loading.value = true;
    error.value = '';
    try {
      const result = await api<OrganizationWork>(`/api/organizations/${id()}/work-summary`);
      if (current === serial) work.value = result;
    } catch (e) {
      if (current === serial) error.value = errorText(e);
    } finally {
      if (current === serial) loading.value = false;
    }
  }
  watch(() => [id(), revision()], load, { immediate: true });
  onUnmounted(() => {
    serial++;
  });
  return { work, loading, error, load };
}
/** 本机构某个 tab(可带 ?record=)的链接,保留当前查询参数。 */
export function useOrganizationTab(id: () => string) {
  const route = useRoute();
  return (tab: string, recordId?: string) => {
    const query = { ...route.query };
    delete query.record;
    if (recordId) query.record = recordId;
    return { path: `/w/internal/organizations/${id()}/${tab}`, query };
  };
}
