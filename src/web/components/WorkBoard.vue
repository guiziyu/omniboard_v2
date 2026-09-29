<script setup lang="ts">
// 工作台(frontend-spec 10.1、10.5、10.7)与机构页的 "Next actions"(10.10,embedded),
// 从 v1 WorkBoard.vue 迁移。
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import {
  laneNames,
  onboardingTemplate,
  type TaskActionResult,
  type WorkTask,
} from '../../shared/operations';
import { tabsFor } from '../../shared/registry';
import type { Tag } from '../../shared/types';
import { actionableTask, matchesWorkState, orderWorkTasks } from '../../shared/work-queue';
import { defaultWorkFilters, workFiltersFromQuery } from '../../shared/filter-preferences';
import { useWorkFeed } from '../work-feed';
import { useRememberedFilters } from '../remembered-filters';
import { openEvidence } from '../evidence';
import { taskText } from '../task-text';
import AppDialog from './AppDialog.vue';
import Icon from './Icon.vue';
import TaskInspector from './TaskInspector.vue';
import TaskMap from './TaskMap.vue';
import TaskPlanDialog from './TaskPlanDialog.vue';
import WorkTaskCollection from './WorkTaskCollection.vue';

const props = defineProps<{ organizationId?: string; embedded?: boolean }>();
const router = useRouter();
const route = useRoute();
const dialog = ref<'' | 'task' | 'plan' | 'create' | 'start'>('');
if (!props.embedded) useRememberedFilters('work');
const layout = ref<'list' | 'board'>('list');
const expanded = ref(false);
const dependencyOpen = ref(false);
const dependencyFocus = ref('');
const dependencyOrg = ref('');
const filters = reactive({ ...defaultWorkFilters(), organizationId: props.organizationId || '' });
watch(
  () => route.query,
  (query) => {
    if (!props.embedded) {
      Object.assign(filters, workFiltersFromQuery(query));
      layout.value = query.layout === 'board' ? 'board' : 'list';
    }
  },
  { immediate: true },
);
watch([() => ({ ...filters }), layout], () => {
  if (props.embedded || route.path !== '/w/internal/work') return;
  const values = { ...filters, layout: layout.value };
  if (Object.entries(values).some(([key, value]) => route.query[key] !== value))
    void router.replace({ query: { ...route.query, ...values } });
});
function resetFilters() {
  Object.assign(filters, defaultWorkFilters());
  layout.value = 'list';
}
const currentOrg = computed(() => props.organizationId || filters.organizationId);
const { feed, loading, error, load } = useWorkFeed(
  currentOrg,
  () => !!dialog.value || dependencyOpen.value,
);
const selectedId = ref('');
const planSourceId = ref('');
const selected = computed(() => feed.value?.tasks.find((t) => t.id === selectedId.value));
const showFilters = ref(false);
const busy = ref(false);
const formError = ref('');
const actionResult = ref<TaskActionResult>();
const startAccess = ref<'team' | 'admin'>('team');
const editable = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const filterCount = computed(
  () =>
    [
      filters.ownerId,
      filters.lane,
      filters.state === 'actionable' ? '' : filters.state || 'all',
      filters.search,
    ].filter(Boolean).length,
);

watch(
  () => props.organizationId,
  (value) => {
    selectedId.value = '';
    dialog.value = '';
    expanded.value = false;
    dependencyOpen.value = false;
    if (value) filters.organizationId = value;
  },
);
watch(
  () => route.query.task,
  (value) => {
    if (value && !props.embedded) select(String(value));
  },
  { immediate: true },
);
let handledSource = '';
watch(
  () => [currentOrg.value, route.query.sourceRecord],
  () => {
    const id = String(route.query.sourceRecord || '');
    if (!props.embedded && currentOrg.value && id && handledSource !== id && editable.value) {
      handledSource = id;
      createFromInformation(currentOrg.value, id);
    }
  },
  { immediate: true },
);

const canStart = computed(() => {
  const org = feed.value?.organizations.find((o) => o.id === currentOrg.value);
  return (
    !!org &&
    tabsFor(org.tags as Tag[]).some((t) => t.id === 'onboarding') &&
    !feed.value?.tasks.some((t) => t.organizationId === org.id && t.origin === 'standard')
  );
});
const scopedTasks = computed(() =>
  (feed.value?.tasks || []).filter(
    (t) => !currentOrg.value || t.organizationId === currentOrg.value,
  ),
);
const visible = computed(() =>
  orderWorkTasks(
    scopedTasks.value.filter(
      (t) =>
        (!filters.ownerId ||
          (filters.ownerId === '__unassigned' ? !t.ownerId : t.ownerId === filters.ownerId)) &&
        (!filters.lane || t.lane === filters.lane) &&
        matchesWorkState(t, filters.state) &&
        (!filters.search ||
          [taskText(t), t.title, t.organizationName, taskText(t, 'description'), t.ownerName]
            .join(' ')
            .toLowerCase()
            .includes(filters.search.toLowerCase())),
    ),
  ),
);
const displayed = computed(() =>
  props.embedded
    ? orderWorkTasks(scopedTasks.value.filter((t) => expanded.value || actionableTask(t))).slice(
        0,
        expanded.value ? undefined : 5,
      )
    : visible.value,
);
const remainingCount = computed(() => scopedTasks.value.length - displayed.value.length);
const diagramTasks = computed(() =>
  (feed.value?.tasks || []).filter((t) => t.organizationId === dependencyOrg.value),
);
function showDependencies(task?: WorkTask) {
  dependencyFocus.value = task?.id || '';
  dependencyOrg.value = task?.organizationId || currentOrg.value;
  dependencyOpen.value = true;
}
const columns = [
  { id: 'ready', title: 'Ready to start' },
  { id: 'active', title: 'In progress' },
  { id: 'waiting', title: 'Waiting for a response' },
  { id: 'blocked', title: 'Waiting for prerequisites' },
  { id: 'done', title: 'Completed' },
  { id: 'skipped', title: 'Not needed' },
];
function select(id: string) {
  dependencyOpen.value = false;
  selectedId.value = id;
  dialog.value = 'task';
  formError.value = '';
}
function openPlan() {
  selectedId.value = '';
  planSourceId.value = '';
  dialog.value = 'create';
}
function editPlan(task: WorkTask) {
  selectedId.value = task.id;
  planSourceId.value = '';
  dialog.value = 'plan';
}
function createFromInformation(orgId: string, sourceId: string) {
  filters.organizationId = orgId;
  openPlan();
  planSourceId.value = sourceId;
}
function closeDialog() {
  dialog.value = '';
  if (!props.embedded && (route.query.task || route.query.sourceRecord)) {
    const { task: _task, sourceRecord: _source, ...query } = route.query;
    void router.replace({ query });
  }
}
async function startPlan() {
  if (busy.value) return;
  busy.value = true;
  formError.value = '';
  try {
    await api(`/api/organizations/${currentOrg.value}/work/start`, {
      method: 'POST',
      body: { visibility: startAccess.value },
    });
    await load();
    dialog.value = '';
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const planOrganization = computed(() => selected.value?.organizationId || currentOrg.value);
</script>
<template>
  <section class="work-board" :class="{ embedded }">
    <div class="work-heading">
      <div>
        <component :is="embedded ? 'h3' : 'h1'">
          {{ embedded ? tr('Next actions') : tr('Work') }}
        </component>
        <p class="hint">
          {{
            embedded
              ? tr('Move this organization forward. Open a task to update its progress.')
              : tr('Move tasks forward, follow up on responses and resolve blockers.')
          }}
        </p>
      </div>
      <div class="work-actions">
        <template v-if="editable">
          <button
            v-if="canStart"
            type="button"
            @click="
              dialog = 'start';
              formError = '';
            "
          >
            {{ tr('Start standard onboarding') }}
          </button>
          <button type="button" class="ghost" :disabled="!currentOrg" @click="openPlan()">
            <Icon name="plus" :size="14" />
            {{ tr('Add from new information') }}
          </button>
        </template>
        <RouterLink
          v-if="embedded"
          :to="{ path: '/w/internal/work', query: { organizationId: currentOrg } }"
        >
          {{ tr('Open in workbench') }}
          <Icon name="arrow" :size="14" />
        </RouterLink>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">
      {{ tr(error) }}
      <button type="button" class="link" @click="load">{{ tr('Retry') }}</button>
    </p>
    <template v-if="!embedded">
      <div class="work-viewbar work-task-tools">
        <div class="work-actions">
          <label>
            <span class="sr-only">{{ tr('Organization') }}</span>
            <select v-model="filters.organizationId" :aria-label="tr('Organization')">
              <option value="">{{ tr('All organizations') }}</option>
              <option v-for="org in feed?.organizations" :key="org.id" :value="org.id">
                {{ org.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="sr-only">{{ tr('Owner') }}</span>
            <select v-model="filters.ownerId" :aria-label="tr('Owner')">
              <option value="">{{ tr('Everyone') }}</option>
              <option v-if="session.user" :value="session.user.id">{{ tr('My work') }}</option>
              <option value="__unassigned">{{ tr('Unassigned') }}</option>
              <option
                v-for="member in feed?.members.filter((m) => m.id !== session.user?.id)"
                :key="member.id"
                :value="member.id"
              >
                {{ member.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="sr-only">{{ tr('Status') }}</span>
            <select v-model="filters.state" :aria-label="tr('Status')">
              <option value="actionable">{{ tr('Work to move forward') }}</option>
              <option value="open">{{ tr('All open tasks') }}</option>
              <option value="">{{ tr('All tasks') }}</option>
              <option v-for="column in columns" :key="column.id" :value="column.id">
                {{ tr(column.title) }}
              </option>
            </select>
          </label>
          <button
            type="button"
            class="link"
            :aria-expanded="showFilters"
            @click="showFilters = !showFilters"
          >
            <Icon name="filter" :size="14" />
            {{ tr('Filters{0}', [filterCount ? ' · ' + filterCount : '']) }}
          </button>
        </div>
        <div class="work-actions">
          <button type="button" class="link" @click="resetFilters">
            {{ tr('Reset filters') }}
          </button>
          <button
            v-if="currentOrg && scopedTasks.length"
            type="button"
            class="link"
            @click="showDependencies()"
          >
            {{ tr('View dependencies') }}
          </button>
          <div class="segmented" :aria-label="tr('Task layout')">
            <button
              v-for="option in ['list', 'board'] as const"
              :key="option"
              type="button"
              :aria-pressed="layout === option"
              @click="layout = option"
            >
              {{ tr(option === 'list' ? 'List' : 'Board') }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="showFilters" class="filters">
        <label>
          {{ tr('Track') }}
          <select v-model="filters.lane">
            <option value="">{{ tr('All tracks') }}</option>
            <option v-for="(label, key) in laneNames" :key="key" :value="key">
              {{ tr(label) }}
            </option>
          </select>
        </label>
        <label>
          {{ tr('Search') }}
          <input v-model="filters.search" :placeholder="tr('Task, organization or owner')" />
        </label>
      </div>
    </template>
    <p v-if="loading && !feed" class="hint">{{ tr('Loading work…') }}</p>
    <template v-else-if="feed">
      <WorkTaskCollection
        v-if="displayed.length"
        :tasks="displayed"
        :layout="embedded ? 'list' : layout"
        :embedded="embedded"
        @select="select"
      />
      <div v-else class="work-empty">
        <h3>
          {{
            scopedTasks.length
              ? tr('No tasks to move forward in this scope')
              : tr('No active plan yet')
          }}
        </h3>
        <p class="hint">
          {{
            scopedTasks.length
              ? tr('Waiting and completed tasks remain available under All tasks.')
              : tr('Choose an organization to start its standard onboarding plan.')
          }}
        </p>
        <button
          v-if="!embedded && scopedTasks.length"
          type="button"
          class="link"
          @click="filters.state = ''"
        >
          {{ tr('All tasks') }}
        </button>
      </div>
      <div v-if="embedded && scopedTasks.length" class="work-viewbar">
        <button type="button" class="link" :aria-expanded="expanded" @click="expanded = !expanded">
          {{
            expanded
              ? tr('Show next actions')
              : tr('Show full plan ({0} tasks)', [scopedTasks.length])
          }}
        </button>
        <small v-if="!expanded && remainingCount">
          {{ tr('{0} more tasks in the plan', [remainingCount]) }}
        </small>
        <button type="button" class="link" @click="showDependencies()">
          {{ tr('View dependencies') }}
        </button>
      </div>
    </template>
    <TaskInspector
      v-if="dialog === 'task' && selected"
      v-show="!dependencyOpen"
      :task="selected"
      :tasks="feed?.tasks || []"
      :visible="displayed"
      :refresh="load"
      @close="closeDialog"
      @select="select"
      @edit="editPlan"
      @dependencies="showDependencies"
      @evidence="openEvidence"
      @changed="actionResult = $event"
    />
    <AppDialog
      v-if="dependencyOpen"
      :title="tr('Task dependencies')"
      wide
      class="work-dependency-dialog"
      @close="dependencyOpen = false"
    >
      <small>{{ tr('Dependencies include prerequisites outside your task filters.') }}</small>
      <TaskMap
        :tasks="diagramTasks"
        :initial-focus="dependencyFocus"
        :highlighted="actionResult?.unlocked.map((t) => t.id)"
        @select="select"
      />
    </AppDialog>
    <TaskPlanDialog
      v-if="dialog === 'create' || (dialog === 'plan' && selected)"
      :organization-id="planOrganization"
      :task="dialog === 'plan' ? selected : undefined"
      :tasks="feed?.tasks || []"
      :members="feed?.members || []"
      :source-record-id="planSourceId"
      :refresh="load"
      @close="closeDialog"
      @saved="closeDialog"
    />
    <AppDialog
      v-if="dialog === 'start'"
      :title="tr('Start standard onboarding')"
      wide
      :busy="busy"
      @close="closeDialog"
    >
      <form @submit.prevent="startPlan">
        <p>
          {{
            tr(
              'These {0} tasks are planned together. Business, research and engineering can progress independently wherever no prerequisite is listed.',
              [onboardingTemplate.length],
            )
          }}
        </p>
        <article v-for="t in onboardingTemplate" :key="t.key" class="template-task">
          <strong>{{ tr(t.title) }}</strong>
          <small>
            {{ tr(laneNames[t.lane]) }} ·
            {{
              t.dependencies.length
                ? tr('After: {0}', [
                    t.dependencies
                      .map((d) => tr(onboardingTemplate.find((x) => x.key === d)?.title))
                      .join('; '),
                  ])
                : tr('Can start independently')
            }}
          </small>
        </article>
        <label>
          {{ tr('Access') }}
          <select v-model="startAccess">
            <option value="team">{{ tr('Internal team') }}</option>
            <option v-if="session.user?.role === 'admin'" value="admin">
              {{ tr('Administrators only') }}
            </option>
          </select>
        </label>
        <small>
          {{
            tr(
              'All tasks start as planned. Existing notes do not automatically prove approval or completed testing.',
            )
          }}
        </small>
        <p v-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
        <div class="actions">
          <button type="submit" :disabled="busy">{{ tr('Create onboarding plan') }}</button>
        </div>
      </form>
    </AppDialog>
    <AppDialog
      v-if="dialog === 'task' && feed && !selected"
      :title="tr('Task')"
      @close="closeDialog"
    >
      <p class="hint">{{ tr('This task is not available in the current scope.') }}</p>
    </AppDialog>
  </section>
</template>
