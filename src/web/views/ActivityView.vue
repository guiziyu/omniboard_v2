<script setup lang="ts">
// 活动历史(frontend-spec 8.4),从 v1 ActivityHistory.vue 迁移:工作台接口里最近 100 条可见事件。
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { useWorkFeed } from '../work-feed';
import type { WorkFeed } from '../../shared/operations';
const route = useRoute();
const router = useRouter();
const organizationId = computed(() => String(route.query.organizationId || ''));
const { feed, loading, error, load } = useWorkFeed(organizationId, false);
const orgName = (id: string) => feed.value?.organizations.find((org) => org.id === id)?.name || '';
// task → 工作台;scenario → 资金优化 tab;其余(对象、结论、关系、身份)→ 关系 tab。
function target(event: WorkFeed['events'][number]) {
  if (event.kind === 'task')
    return {
      path: '/w/internal/work',
      query: { organizationId: event.organizationId, task: event.targetId },
    };
  const tab = event.kind === 'scenario' ? 'capital_optimization' : 'relationships';
  return {
    path: `/w/internal/organizations/${event.organizationId}/${tab}`,
    query: { object: event.targetId },
  };
}
</script>
<template>
  <section class="page activity-page">
    <header class="page-head">
      <div>
        <h1>{{ tr('Activity history') }}</h1>
        <p class="hint">{{ tr('Task, object and evidence changes') }}</p>
      </div>
      <div class="page-actions">
        <select
          :value="organizationId"
          :aria-label="tr('Organization')"
          @change="
            router.replace({
              query: { organizationId: ($event.target as HTMLSelectElement).value || undefined },
            })
          "
        >
          <option value="">{{ tr('All organizations') }}</option>
          <option v-for="org in feed?.organizations" :key="org.id" :value="org.id">
            {{ org.name }}
          </option>
        </select>
        <button type="button" class="ghost" :disabled="loading" @click="load">
          {{ tr('Refresh') }}
        </button>
      </div>
    </header>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p class="hint">
      {{ tr('Shows the latest 100 changes you can access in the selected scope.') }}
    </p>
    <p v-if="loading && !feed" class="hint">{{ tr('Loading…') }}</p>
    <template v-else-if="feed">
      <p v-if="!feed.events.length" class="empty">{{ tr('No activity in this scope.') }}</p>
      <ul v-else class="activity-list">
        <li v-for="event in feed.events" :key="event.id">
          <RouterLink class="attention-row" :to="target(event)">
            <strong>{{ event.title }}</strong>
            <span class="hint">
              {{ orgName(event.organizationId) }} · {{ event.author }} ·
              {{ dateTime(event.createdAt) }}
            </span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>
