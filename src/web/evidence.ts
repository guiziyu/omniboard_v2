import { ref } from 'vue';
// 证据抽屉是全局单例(frontend-spec 5.10):任何「Reference / Original source」按钮都调用 openEvidence。
export const evidenceId = ref<string | null>(null);
export const openEvidence = (id: string | null | undefined) => {
  if (id) evidenceId.value = id;
};
