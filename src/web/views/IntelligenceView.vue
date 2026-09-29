<script setup lang="ts">
// 情报收件箱页(frontend-spec 8.1、8.3),从 v1 IntelligencePage.vue 迁移。
// 页面级提醒(Evidence to review)与关注状态来自工作台接口,按同样的规则刷新。
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { useWorkFeed } from '../work-feed';
import IntelligenceInbox from '../components/IntelligenceInbox.vue';
import type { WorkFeed } from '../../shared/operations';
const route = useRoute();
const router = useRouter();
const organizationId = computed(() => String(route.query.organizationId || ''));
const { feed, error, load } = useWorkFeed(organizationId, false);
const refreshVersion = ref(0);
const followError = ref('');
const reviewAlerts = computed(() => feed.value?.alerts.filter((a) => a.kind === 'claim') || []);
const following = computed(
  () => !!feed.value?.followedOrganizationIds.includes(organizationId.value),
);
function scopeTo(value: string) {
  const { record: _record, ...query } = route.query;
  void router.replace({ query: { ...query, organizationId: value || undefined } });
}
async function follow() {
  followError.value = '';
  try {
    await api(`/api/organizations/${encodeURIComponent(organizationId.value)}/follow`, {
      method: 'POST',
      body: { follow: !following.value },
    });
    await load();
    refreshVersion.value++;
  } catch (e) {
    followError.value = errorText(e);
  }
}
function closeRecord() {
  if (!route.query.record) return;
  const { record: _record, ...query } = route.query;
  void router.replace({ query });
}
const openTask = (task: string, org: string) =>
  void router.push({ path: '/w/internal/work', query: { task, organizationId: org || undefined } });
const createTask = (org: string, sourceRecord: string) =>
  void router.push({ path: '/w/internal/work', query: { organizationId: org, sourceRecord } });
const review = (alert: WorkFeed['alerts'][number]) =>
  void router.push({
    path: `/w/internal/organizations/${alert.organizationId}/relationships`,
    query: { object: alert.targetId },
  });
</script>
<template>
  <section class="page intelligence-page">
    <header class="page-head">
      <div>
        <h1>{{ tr('Intelligence inbox') }}</h1>
        <p class="hint">{{ tr('Read updates, review evidence and decide what needs action.') }}</p>
      </div>
      <div class="page-actions">
        <select
          :value="organizationId"
          :aria-label="tr('Organization')"
          @change="scopeTo(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ tr('All organizations') }}</option>
          <option v-for="org in feed?.organizations" :key="org.id" :value="org.id">
            {{ org.name }}
          </option>
        </select>
        <button
          v-if="organizationId"
          type="button"
          class="ghost"
          :aria-pressed="following"
          @click="follow"
        >
          {{ following ? tr('Following organization') : tr('Follow organization') }}
        </button>
      </div>
    </header>
    <p v-if="error || followError" class="error" role="alert">
      {{ tr(error || followError) }}
      <button type="button" class="link" @click="load">{{ tr('Retry') }}</button>
    </p>
    <IntelligenceInbox
      :organization-id="organizationId"
      :initial-record-id="String(route.query.record || '')"
      :review-alerts="reviewAlerts"
      :refresh-version="refreshVersion"
      @task="openTask"
      @create="createTask"
      @review="review"
      @close="closeRecord"
    />
  </section>
</template>
