<script setup lang="ts">
// 新建任务 / 编辑任务计划(frontend-spec 10.6),从 v1 TaskPlanDialog.vue 迁移。
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { api, errorText, session } from '../api';
import { tr } from '../i18n';
import {
  laneNames,
  type KnowledgeGraph,
  type TaskLane,
  type WorkFeed,
  type WorkTask,
} from '../../shared/operations';
import { taskText } from '../task-text';
import AppDialog from './AppDialog.vue';
const props = defineProps<{
  organizationId: string;
  task?: WorkTask;
  tasks: WorkTask[];
  members: WorkFeed['members'];
  sourceRecordId?: string;
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const create = computed(() => !props.task);
const busy = ref(false);
const loading = ref(false);
const formError = ref('');
const graph = ref<KnowledgeGraph>();
const blankPlan = () => ({
  title: '',
  lane: 'business' as TaskLane,
  ownerId: '',
  description: '',
  dueOn: '',
  nextStep: '',
  completionCriteria: '',
  followUpOn: '',
  visibility: 'team' as 'team' | 'admin',
  dependencies: [] as string[],
  objectIds: [] as string[],
  sourceRecordId: '',
  rawText: '',
  sourceUrl: '',
});
const plan = reactive(blankPlan());
let revision = 0;
let serial = 0;
const prerequisites = computed(() =>
  props.tasks.filter(
    (t) =>
      t.organizationId === props.organizationId &&
      t.id !== props.task?.id &&
      (plan.visibility === 'admin' || t.visibility === 'team'),
  ),
);
watch(
  [() => props.organizationId, () => props.task?.id, () => props.sourceRecordId],
  async () => {
    const request = ++serial;
    Object.assign(plan, blankPlan());
    formError.value = '';
    graph.value = undefined;
    loading.value = true;
    if (props.task) {
      const t = props.task;
      Object.assign(plan, {
        title: t.title,
        lane: t.lane,
        ownerId: t.ownerId,
        description: t.description,
        dueOn: t.dueOn,
        nextStep: t.nextStep,
        completionCriteria: t.completionCriteria,
        followUpOn: t.followUpOn,
        visibility: t.visibility,
        dependencies: [...t.dependencies],
        objectIds: [...t.objectIds],
        sourceRecordId: t.sourceRecordId,
      });
      revision = t.revision;
    }
    try {
      const result = await api<KnowledgeGraph>(
        `/api/organizations/${props.organizationId}/knowledge`,
      );
      if (request !== serial) return;
      graph.value = result;
      if (create.value && props.sourceRecordId) {
        const source = result.records.find((r) => r.id === props.sourceRecordId);
        if (source) {
          plan.sourceRecordId = source.id;
          plan.visibility = source.visibility;
          plan.title = ('Follow up: ' + source.title).slice(0, 160);
        } else
          formError.value =
            'The requested source is not available. Choose a reference before saving.';
      }
    } catch (e) {
      if (request === serial) formError.value = errorText(e);
    } finally {
      if (request === serial) loading.value = false;
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  serial++;
});
async function savePlan() {
  if (busy.value || loading.value) return;
  busy.value = true;
  formError.value = '';
  try {
    if (create.value)
      await api(`/api/organizations/${props.organizationId}/work/tasks`, {
        method: 'POST',
        body: plan,
      });
    else
      await api(`/api/work/tasks/${props.task!.id}`, {
        method: 'PATCH',
        body: { ...plan, revision },
      });
    await props.refresh();
    emit('saved');
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AppDialog
    :title="create ? tr('New information → New task') : tr('Edit task plan')"
    wide
    :busy="busy"
    @close="emit('close')"
  >
    <form @submit.prevent="savePlan">
      <fieldset class="task-plan-fields" :disabled="loading || busy">
        <label>
          {{ tr('Task title') }}
          <input v-model="plan.title" required maxlength="160" />
        </label>
        <div class="form-grid">
          <label>
            {{ tr('Track') }}
            <select v-model="plan.lane">
              <option v-for="(label, key) in laneNames" :key="key" :value="key">
                {{ tr(label) }}
              </option>
            </select>
          </label>
          <label>
            {{ tr('Owner') }}
            <select v-model="plan.ownerId">
              <option value="">{{ tr('Unassigned') }}</option>
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </label>
          <label>
            {{ tr('Due date') }}
            <input v-model="plan.dueOn" type="date" />
          </label>
          <label>
            {{ tr('Access') }}
            <select v-model="plan.visibility" :disabled="!create">
              <option value="team">{{ tr('Internal team') }}</option>
              <option v-if="session.user?.role === 'admin'" value="admin">
                {{ tr('Administrators only') }}
              </option>
            </select>
          </label>
        </div>
        <label>
          {{ tr('Context') }}
          <textarea v-model="plan.description" rows="3" />
        </label>
        <label>
          {{ tr('Next concrete step') }}
          <textarea v-model="plan.nextStep" rows="2" maxlength="1500" />
        </label>
        <label>
          {{ tr('Done when') }}
          <textarea
            v-model="plan.completionCriteria"
            rows="2"
            maxlength="2000"
            :placeholder="tr('A result that can be checked against evidence')"
          />
        </label>
        <label v-if="task?.state === 'waiting'">
          {{ tr('Follow up on') }}
          <input v-model="plan.followUpOn" type="date" />
        </label>
        <fieldset class="form-section">
          <legend>{{ tr('Must finish first') }}</legend>
          <small>
            {{
              tr(
                'Leave empty to allow independent progress. A person can own several concurrent tasks.',
              )
            }}
          </small>
          <label v-for="t in prerequisites" :key="t.id" class="check-row">
            <input v-model="plan.dependencies" type="checkbox" :value="t.id" />
            {{ taskText(t) }}
          </label>
          <p v-if="!prerequisites.length" class="hint">{{ tr('No existing prerequisites.') }}</p>
        </fieldset>
        <fieldset v-if="graph?.objects.length" class="form-section">
          <legend>{{ tr('Related objects') }}</legend>
          <label
            v-for="o in graph.objects.filter(
              (o) => plan.visibility === 'admin' || o.visibility === 'team',
            )"
            :key="o.id"
            class="check-row"
          >
            <input v-model="plan.objectIds" type="checkbox" :value="o.id" />
            {{ o.name }} · {{ tr(o.kind) }}
          </label>
        </fieldset>
        <label>
          {{ tr('Source record') }}
          <select v-model="plan.sourceRecordId" :aria-label="tr('Source record')">
            <option value="">{{ tr('Use an original note below') }}</option>
            <option
              v-for="r in graph?.records.filter(
                (r) => plan.visibility === 'admin' || r.visibility === 'team',
              )"
              :key="r.id"
              :value="r.id"
            >
              {{ r.title }}
            </option>
          </select>
        </label>
        <label>
          {{
            create
              ? tr('New information that triggered this task')
              : tr('Additional source note (optional)')
          }}
          <textarea v-model="plan.rawText" rows="3" :required="create && !plan.sourceRecordId" />
        </label>
        <label>
          {{ tr('Source URL') }}
          <input v-model="plan.sourceUrl" type="url" />
        </label>
        <p v-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
      </fieldset>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="emit('close')">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="busy || loading">{{ tr('Save task') }}</button>
      </div>
    </form>
  </AppDialog>
</template>
