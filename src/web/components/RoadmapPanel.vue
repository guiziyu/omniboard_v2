<script setup lang="ts">
// 路线图标签页(frontend-spec 10.11、10.12),从 v1 RoadmapPanel.vue 迁移。
// 里程碑就是通用记录;执行任务以 sourceRecordId 关联,状态实时读工作台接口,不另存进度。
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { ModuleRecord, Organization } from '../../shared/types';
import { taskStates, type WorkFeed, type WorkTask } from '../../shared/operations';
import {
  compareRoadmap,
  roadmapFinished,
  roadmapStates,
  roadmapTypes,
  roadmapWindowPassed,
} from '../../shared/roadmap';
import { api, atLeast, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { taskText } from '../task-text';
import { reviewPresentation } from '../presentation';
import Icon from './Icon.vue';
const props = defineProps<{
  organization: Organization;
  records: ModuleRecord[];
  compact?: boolean;
}>();
const emit = defineEmits<{
  edit: [record?: ModuleRecord, planType?: string];
  history: [id: string];
}>();
const route = useRoute();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
// 过滤只存在当前页面,不写 URL(10.11)。
const planType = ref('');
const state = ref('');

const tasks = ref<WorkTask[]>([]);
const taskError = ref(false);
let serial = 0;
async function loadTasks() {
  const request = ++serial;
  taskError.value = false;
  if (!props.records.length) {
    tasks.value = [];
    return;
  }
  try {
    const feed = await api<WorkFeed>(
      '/api/work?organizationId=' + encodeURIComponent(props.organization.id),
    );
    if (request === serial) tasks.value = feed.tasks;
  } catch {
    if (request === serial) taskError.value = true;
  }
}
watch(() => [props.organization.id, props.records], loadTasks, { immediate: true });

const milestones = computed(() =>
  props.records
    .filter(
      (r) =>
        (!planType.value || r.structured.planType === planType.value) &&
        (!state.value || r.structured.roadmapStatus === state.value),
    )
    .sort(compareRoadmap),
);
const open = computed(() => props.records.filter((r) => !roadmapFinished(r)).length);
const delivered = computed(
  () => props.records.filter((r) => r.structured.roadmapStatus === 'delivered').length,
);
const undated = computed(
  () => props.records.filter((r) => !r.structured.targetPeriod && !roadmapFinished(r)).length,
);
const presentation = (record: ModuleRecord) =>
  roadmapStates[record.structured.roadmapStatus as keyof typeof roadmapStates] ??
  roadmapStates.planned;
const planLabel = (record: ModuleRecord) =>
  roadmapTypes[record.structured.planType as keyof typeof roadmapTypes] ??
  roadmapTypes.organization;
function target(record: ModuleRecord) {
  const value = record.structured.targetPeriod || '';
  if (!value) return tr('Date not scheduled');
  return value.includes('-Q') ? tr('{0} · Q{1}', [value.slice(0, 4), value.slice(-1)]) : value;
}
const linkedTasks = (record: ModuleRecord) =>
  tasks.value.filter((t) => t.sourceRecordId === record.id);
const passed = (record: ModuleRecord) =>
  roadmapWindowPassed(record, new Date().toISOString().slice(0, 10));
const workLink = (query: Record<string, string>) => ({
  path: '/w/internal/work',
  query: { organizationId: props.organization.id, ...query },
});

// ?record=<id>:展开并滚动到对应里程碑;被过滤掉时先清空过滤。
watch(
  () => [route.query.record, props.records],
  async () => {
    const target = String(route.query.record || '');
    if (!props.records.some((r) => r.id === target)) return;
    if (!milestones.value.some((r) => r.id === target)) {
      planType.value = '';
      state.value = '';
    }
    await nextTick();
    const element = document.getElementById(`record-${target}`);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: 'start' });
  },
  { immediate: true },
);
</script>
<template>
  <section class="roadmap" :class="{ compact }" :aria-label="tr('Roadmap')">
    <header class="roadmap-heading">
      <div>
        <h3>
          <Icon name="roadmap" :size="20" />
          {{ tr('Roadmap') }}
        </h3>
        <p class="hint">
          {{
            tr('Milestones, target dates and progress for the organization and our collaboration.')
          }}
        </p>
      </div>
      <button v-if="canEdit" type="button" class="ghost" @click="emit('edit')">
        <Icon name="plus" :size="16" />
        {{ tr('Add milestone') }}
      </button>
    </header>
    <template v-if="records.length">
      <div class="roadmap-summary" :aria-label="tr('Milestone summary')">
        <span>
          <strong>{{ open }}</strong>
          {{ tr('Open milestones') }}
        </span>
        <span>
          <strong>{{ delivered }}</strong>
          {{ tr('Delivered milestones') }}
        </span>
        <span>
          <strong>{{ undated }}</strong>
          {{ tr('Awaiting a date') }}
        </span>
      </div>
      <div class="roadmap-toolbar">
        <div class="segmented" :aria-label="tr('Plan belongs to')">
          <button type="button" :aria-pressed="planType === ''" @click="planType = ''">
            {{ tr('All plans') }}
          </button>
          <button
            v-for="(label, key) in roadmapTypes"
            :key="key"
            type="button"
            :aria-pressed="planType === key"
            @click="planType = key"
          >
            {{ tr(label) }}
          </button>
        </div>
        <label>
          {{ tr('Milestone status') }}
          <select v-model="state">
            <option value="">{{ tr('All milestone statuses') }}</option>
            <option v-for="(value, key) in roadmapStates" :key="key" :value="key">
              {{ tr(value.label) }}
            </option>
          </select>
        </label>
      </div>
      <p class="hint roadmap-guide">
        {{
          tr(
            'Dates keep their original precision. A target date is a plan, not a confirmed delivery.',
          )
        }}
      </p>
      <p v-if="taskError" role="alert" class="error">
        {{ tr('Linked tasks could not be loaded.') }}
        <button type="button" class="link" @click="loadTasks">{{ tr('Retry') }}</button>
      </p>
      <p v-if="!milestones.length" class="empty">{{ tr('No milestones match these filters.') }}</p>
      <ol v-else class="roadmap-timeline">
        <li
          v-for="record in milestones"
          :key="record.id"
          class="roadmap-row"
          :class="'roadmap-' + (record.structured.roadmapStatus || 'planned')"
        >
          <div class="roadmap-date">
            <Icon name="clock" :size="15" />
            <strong>{{ target(record) }}</strong>
          </div>
          <details :id="'record-' + record.id" class="roadmap-card">
            <summary>
              <div class="roadmap-card-main">
                <small>{{ tr(planLabel(record)) }}</small>
                <h4>{{ record.title }}</h4>
                <p>{{ record.structured.successCriteria }}</p>
                <span class="roadmap-owner">
                  <Icon name="users" :size="14" />
                  {{ record.structured.owner || tr('Owner not recorded') }}
                </span>
              </div>
              <div class="roadmap-state">
                <span class="roadmap-badge">
                  <Icon :name="presentation(record).icon" :size="14" />
                  {{ tr(presentation(record).label) }}
                </span>
                <span v-if="passed(record)" class="roadmap-elapsed">
                  {{ tr('Target window passed') }}
                </span>
                <span v-if="linkedTasks(record).length" class="hint">
                  {{ tr('{0} linked tasks', [linkedTasks(record).length]) }}
                </span>
                <Icon class="roadmap-chevron" name="chevron" :size="16" />
              </div>
            </summary>
            <div class="roadmap-details">
              <p class="preserve-lines">{{ record.body }}</p>
              <dl>
                <div v-if="record.structured.impact">
                  <dt>{{ tr('Why this matters') }}</dt>
                  <dd>{{ record.structured.impact }}</dd>
                </div>
                <div v-if="record.structured.nextStep">
                  <dt>{{ tr('Next step') }}</dt>
                  <dd>{{ record.structured.nextStep }}</dd>
                </div>
                <div>
                  <dt>{{ tr('Scope') }}</dt>
                  <dd>
                    {{
                      record.scope === 'Organization-wide' ? tr('Organization-wide') : record.scope
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ tr('Evidence review') }}</dt>
                  <dd>
                    {{ reviewPresentation(record.status).label }} ·
                    {{ record.structured.reviewedOn }}
                  </dd>
                </div>
              </dl>
              <div v-if="linkedTasks(record).length" class="roadmap-tasks">
                <strong>{{ tr('Execution tasks') }}</strong>
                <RouterLink
                  v-for="task in linkedTasks(record)"
                  :key="task.id"
                  :to="workLink({ task: task.id })"
                >
                  <span>{{ taskText(task) }}</span>
                  <span class="task-state" :class="'state-' + task.displayState">
                    {{ tr(taskStates[task.displayState]) }}
                  </span>
                </RouterLink>
              </div>
              <footer class="record-footer">
                <span>{{ record.author }} · {{ dateTime(record.updatedAt) }}</span>
                <span>
                  <button type="button" class="link" @click="openEvidence(record.evidenceId)">
                    {{ tr('Original source') }}
                  </button>
                  <button
                    v-if="record.attachmentEvidenceId"
                    type="button"
                    class="link"
                    @click="openEvidence(record.attachmentEvidenceId)"
                  >
                    {{ tr('Attachment') }}
                  </button>
                  <button type="button" class="link" @click="emit('history', record.id)">
                    {{ tr('Edit history') }}
                  </button>
                  <template v-if="canEdit">
                    <RouterLink class="link" :to="workLink({ sourceRecord: record.id })">
                      {{ tr('Create follow-up task') }}
                    </RouterLink>
                    <button type="button" class="link" @click="emit('edit', record)">
                      {{ tr('Edit milestone') }}
                    </button>
                  </template>
                </span>
              </footer>
            </div>
          </details>
        </li>
      </ol>
    </template>
    <div v-else class="roadmap-empty-lanes">
      <section v-for="(label, key) in roadmapTypes" :key="key">
        <Icon name="roadmap" :size="24" />
        <h3>{{ tr(label) }}</h3>
        <p>
          {{
            tr(
              key === 'organization'
                ? 'Product launches, market expansion and publicly announced plans.'
                : 'Our relationship goals, agreed milestones and next commitments.',
            )
          }}
        </p>
        <button v-if="canEdit" type="button" class="ghost" @click="emit('edit', undefined, key)">
          {{ tr('Add milestone') }}
        </button>
        <p v-else class="hint">{{ tr('The team has not recorded a roadmap yet.') }}</p>
      </section>
    </div>
  </section>
</template>
