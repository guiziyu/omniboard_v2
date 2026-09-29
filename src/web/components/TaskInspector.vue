<script setup lang="ts">
// 任务详情面板(frontend-spec 10.4),从 v1 TaskInspector.vue 迁移。
// v2 直接读 quant 的 run(proposal §6),验证证据只在完成时存为任务证据,列表里不再有「Reference」。
import { computed, nextTick, ref, watch } from 'vue';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import {
  isFinished,
  laneNames,
  taskStates,
  type TaskActionResult,
  type TaskHistoryEvent,
  type TaskState,
  type WorkTask,
} from '../../shared/operations';
import { taskImpact } from '../../shared/focus';
import type { VerificationEvidence } from '../../shared/integration';
import { taskText, taskReference, taskOwner } from '../task-text';
import AppDialog from './AppDialog.vue';
import Icon from './Icon.vue';
const props = defineProps<{
  task: WorkTask;
  tasks: WorkTask[];
  visible: WorkTask[];
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{
  close: [];
  select: [id: string];
  edit: [task: WorkTask];
  dependencies: [task: WorkTask];
  evidence: [id: string];
  changed: [result: TaskActionResult];
}>();
const selected = computed(() => props.task);
const busy = ref(false);
const formError = ref('');
const actionFeedback = ref('');
const actionResult = ref<TaskActionResult>();
const body = ref<HTMLElement>();
const selectedAction = ref<TaskState | 'progress'>('progress');
const outcome = ref('');
const nextStep = ref('');
const followUpOn = ref('');
const evidenceText = ref('');
const evidenceUrl = ref('');
const environment = ref('');
const codeRevision = ref('');
const claim = ref(true);
const editable = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const finishedAction = computed(
  () => selectedAction.value === 'done' || selectedAction.value === 'skipped',
);
const impact = computed(() => taskImpact(props.task, props.tasks));
const taskPosition = computed(() => props.visible.findIndex((t) => t.id === props.task.id));
const nextTask = computed(
  () =>
    actionResult.value?.unlocked[0]?.id ||
    props.visible.find(
      (t) =>
        t.id !== props.task.id &&
        ['active', 'ready'].includes(t.displayState) &&
        (!t.ownerId || t.ownerId === session.user?.id),
    )?.id,
);
const taskHistory = ref<TaskHistoryEvent[]>();
// 本机构当前请求里已通过的 run(仅标准 validation 任务,10.4 第 11 项)。
const verification = ref<VerificationEvidence[]>([]);
async function loadVerification() {
  const taskId = props.task.id;
  verification.value = [];
  if (props.task.templateKey !== 'validation' || isFinished(props.task.state)) return;
  try {
    const result = await api<{ attempts: VerificationEvidence[] }>(
      `/api/work/tasks/${taskId}/verification`,
    );
    if (props.task.id === taskId) verification.value = result.attempts;
  } catch {
    // 读不到 run 时,手动完成的表单照常可用。
  }
}
async function completeWithRun(runId: string) {
  if (busy.value) return;
  busy.value = true;
  formError.value = '';
  try {
    const result = await api<TaskActionResult>(
      `/api/work/tasks/${props.task.id}/verification-complete`,
      { method: 'POST', body: { revision: props.task.revision, runId } },
    );
    await props.refresh();
    actionResult.value = result;
    actionFeedback.value = 'Task completed. Your result and evidence are saved.';
    emit('changed', result);
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const scrollTop = () => body.value?.closest('.dialog')?.scrollTo({ top: 0 });
watch(
  () => props.task.id,
  () => {
    actionResult.value = undefined;
    actionFeedback.value = '';
    formError.value = '';
    taskHistory.value = undefined;
    outcome.value = '';
    evidenceText.value = '';
    evidenceUrl.value = '';
    environment.value = '';
    codeRevision.value = '';
    nextStep.value = props.task.nextStep;
    followUpOn.value = props.task.followUpOn;
    claim.value = true;
    selectedAction.value = isFinished(props.task.state)
      ? 'planned'
      : props.task.state === 'planned' && !props.task.blockers.length
        ? 'active'
        : 'progress';
    void nextTick(scrollTop);
    void loadVerification();
  },
  { immediate: true },
);
function select(id: string) {
  if (!busy.value) emit('select', id);
}
async function history() {
  const taskId = props.task.id;
  try {
    const result = (await api<{ events: TaskHistoryEvent[] }>(`/api/work/tasks/${taskId}/history`))
      .events;
    if (props.task.id === taskId) taskHistory.value = result;
  } catch (e) {
    if (props.task.id === taskId) formError.value = errorText(e);
  }
}
async function takeAction() {
  if (busy.value) return;
  busy.value = true;
  formError.value = '';
  const task = props.task;
  const action = selectedAction.value;
  try {
    const result = await api<TaskActionResult>(
      `/api/work/tasks/${task.id}/${action === 'progress' ? 'updates' : 'actions'}`,
      {
        method: 'POST',
        body: {
          revision: task.revision,
          ...(action === 'progress'
            ? {}
            : {
                state: action,
                claim: action === 'active' && claim.value,
                environment: environment.value,
                codeRevision: codeRevision.value,
              }),
          nextStep: nextStep.value,
          followUpOn: followUpOn.value,
          outcome: outcome.value,
          rawText: evidenceText.value,
          sourceUrl: evidenceUrl.value,
        },
      },
    );
    await props.refresh();
    actionResult.value = result;
    actionFeedback.value =
      action === 'done'
        ? 'Task completed. Your result and evidence are saved.'
        : action === 'skipped'
          ? 'Marked not needed. Your decision is saved.'
          : action === 'progress'
            ? 'Progress saved. Task status is unchanged.'
            : 'Task updated.';
    outcome.value = '';
    evidenceText.value = '';
    evidenceUrl.value = '';
    selectedAction.value = isFinished(result.state) ? 'planned' : 'progress';
    emit('changed', result);
    await nextTick();
    scrollTop();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function scrollToForm() {
  body.value
    ?.querySelector('#task-action-form')
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
const actionLabels: Record<TaskState, string> = {
  planned: 'Return to plan / reopen',
  active: 'Start or resume work',
  waiting: 'Wait for a response',
  done: 'Complete with evidence',
  skipped: 'Mark not needed',
};
</script>
<template>
  <AppDialog :title="taskText(task)" drawer :busy="busy" @close="emit('close')">
    <div ref="body" class="task-inspector">
      <button type="button" class="link" @click="emit('dependencies', task)">
        {{ tr('View dependencies') }}
      </button>
      <div class="inspector-navigation">
        <button
          type="button"
          class="link"
          :disabled="busy || taskPosition <= 0"
          @click="select(visible[taskPosition - 1]!.id)"
        >
          {{ tr('← Previous') }}
        </button>
        <small>
          {{
            taskPosition < 0
              ? tr('Linked task')
              : tr('{0} of {1}', [taskPosition + 1, visible.length])
          }}
        </small>
        <button
          type="button"
          class="link"
          :disabled="busy || taskPosition < 0 || taskPosition >= visible.length - 1"
          @click="select(visible[taskPosition + 1]!.id)"
        >
          {{ tr('Next →') }}
        </button>
      </div>
      <section v-if="actionFeedback" class="task-feedback" role="status">
        <strong>
          <Icon name="check" :size="17" />
          {{ tr(actionFeedback) }}
        </strong>
        <template v-if="actionResult?.unlocked.length">
          <h4>{{ tr('Ready now') }}</h4>
          <button
            v-for="t in actionResult.unlocked"
            :key="t.id"
            type="button"
            class="context-link"
            @click="select(t.id)"
          >
            <span>
              {{ taskReference(t, tasks) }}
              <small>{{ tr('This prerequisite is now resolved.') }}</small>
            </span>
            <Icon name="arrow" :size="15" />
          </button>
        </template>
        <template v-if="actionResult?.remaining.length">
          <h4>{{ tr('Other work still has prerequisites') }}</h4>
          <p v-for="t in actionResult.remaining" :key="t.id" class="hint">
            {{
              tr('{0} · Still needs {1}', [
                taskReference(t, tasks),
                t.blockers.map((b) => taskReference(b, tasks)).join(', '),
              ])
            }}
          </p>
        </template>
        <button v-if="nextTask" type="button" @click="select(nextTask)">
          {{ tr('Continue to next task') }}
          <Icon name="arrow" :size="14" />
        </button>
        <button v-else type="button" class="link" @click="emit('close')">
          {{ tr('Back to focus') }}
        </button>
      </section>
      <div class="work-actions">
        <span class="task-state" :class="'state-' + selected.displayState">
          {{ tr(taskStates[selected.displayState]) }}
        </span>
        <span class="hint">{{ tr(laneNames[selected.lane]) }} · {{ taskOwner(selected) }}</span>
        <button
          v-if="editable && !isFinished(selected.state)"
          type="button"
          class="link"
          :disabled="busy"
          @click="emit('edit', selected)"
        >
          {{ tr('Edit plan') }}
        </button>
      </div>
      <section v-if="!isFinished(selected.state)" class="task-brief">
        <span class="eyebrow">{{ tr('NEXT STEP') }}</span>
        <p>
          {{
            taskText(selected, 'nextStep') ||
            taskText(selected, 'description') ||
            tr('Agree a concrete next action with the task owner.')
          }}
        </p>
        <h4>{{ tr('Done when') }}</h4>
        <p class="hint">
          {{
            taskText(selected, 'completionCriteria') ||
            tr(
              'Record the agreed result and its supporting evidence. Add a specific completion condition in Edit plan.',
            )
          }}
        </p>
      </section>
      <p class="hint">
        {{ selected.organizationName }} ·
        {{
          selected.origin === 'standard'
            ? tr('Standard onboarding')
            : tr('Added from new information')
        }}{{ selected.dueOn ? ' ' + tr('· Due {0}', [selected.dueOn]) : '' }}
      </p>
      <details v-if="selected.description" class="task-context">
        <summary>{{ tr('Task context') }}</summary>
        <p class="preserve-lines">{{ taskText(selected, 'description') }}</p>
      </details>
      <section
        v-if="!isFinished(selected.state) && (impact.unlocked.length || impact.remaining.length)"
        class="task-impact"
      >
        <h4>{{ tr('What this enables') }}</h4>
        <p v-for="t in impact.unlocked" :key="t.id">
          <Icon name="arrow" :size="14" />
          {{ taskReference(t, tasks) }}
          <small>{{ tr('Ready after this task') }}</small>
        </p>
        <p v-for="t in impact.remaining" :key="t.id">
          {{ taskReference(t, tasks) }}
          <small>
            {{ tr('Also needs {0}', [t.blockers.map((b) => taskReference(b, tasks)).join(', ')]) }}
          </small>
        </p>
      </section>
      <div v-if="selected.dependencies.length" class="task-prerequisites">
        <h3>{{ tr('Prerequisites') }}</h3>
        <button
          v-for="dep in selected.dependencies"
          :key="dep"
          type="button"
          class="ghost"
          @click="select(dep)"
        >
          <span
            class="task-state"
            :class="'state-' + (tasks.find((t) => t.id === dep)?.displayState || 'blocked')"
          >
            {{ tr(taskStates[tasks.find((t) => t.id === dep)?.displayState || 'blocked']) }}
          </span>
          {{ taskReference({ id: dep, title: '' }, tasks) }}
        </button>
      </div>
      <section v-if="verification.length && editable" class="task-verification">
        <h4>{{ tr('Verification evidence from quant') }}</h4>
        <p v-for="attempt in verification" :key="attempt.runId">
          {{ attempt.suite }} · {{ attempt.environment }} · {{ attempt.accountName }} ·
          <code>{{ attempt.buildRevision.slice(0, 12) }}</code>
          <span v-if="attempt.buildDirty"> ({{ tr('dirty') }})</span>
          · {{ attempt.finishedAt ? dateTime(attempt.finishedAt) : '' }} ·
          {{ tr('{0} passed, {1} skipped', [attempt.passedCount, attempt.skippedCount]) }}
          <button
            type="button"
            class="link"
            :disabled="busy || selected.blockers.length > 0"
            @click="completeWithRun(attempt.runId)"
          >
            {{ tr('Complete with this run') }}
          </button>
        </p>
        <p v-if="selected.blockers.length" class="hint">
          {{ tr('Complete or waive the prerequisites first.') }}
        </p>
      </section>
      <div v-if="selected.outcome" class="outcome-box">
        <h3>{{ tr('Latest result / follow-up') }}</h3>
        <p class="preserve-lines">{{ selected.outcome }}</p>
      </div>
      <div class="work-actions">
        <RouterLink
          v-if="selected.sourceRecordId"
          :to="{
            path: '/w/internal/intelligence',
            query: { organizationId: selected.organizationId, record: selected.sourceRecordId },
          }"
        >
          {{ tr('Open source information') }}
        </RouterLink>
        <button type="button" class="link" @click="emit('evidence', selected.evidenceId)">
          {{ tr('View reference') }}
        </button>
        <button type="button" class="link" @click="history">{{ tr('Activity history') }}</button>
        <RouterLink :to="`/w/internal/organizations/${selected.organizationId}/relationships`">
          {{ tr('Linked objects & evidence') }}
        </RouterLink>
      </div>
      <div v-if="taskHistory" class="history-list">
        <article v-for="(e, i) in taskHistory" :key="i">
          <strong>{{ e.title }}</strong>
          <small>{{ e.author }} · {{ dateTime(e.createdAt) }}</small>
          <p v-if="e.payload.outcome" class="preserve-lines">{{ e.payload.outcome }}</p>
          <button
            v-if="e.payload.evidenceId"
            type="button"
            class="link"
            @click="emit('evidence', e.payload.evidenceId)"
          >
            {{ tr('Reference') }}
          </button>
        </article>
      </div>
      <form
        v-if="editable && (!actionFeedback || !isFinished(selected.state))"
        id="task-action-form"
        class="task-action-form"
        @submit.prevent="takeAction"
      >
        <h3>{{ isFinished(selected.state) ? tr('Reopen task') : tr('Move this forward') }}</h3>
        <label>
          {{ tr('Action') }}
          <select v-model="selectedAction" :aria-label="tr('Task action')">
            <option v-if="!isFinished(selected.state)" value="progress">
              {{ tr('Record progress · keep current status') }}
            </option>
            <option
              v-for="s in ['planned', 'active', 'waiting', 'done', 'skipped'] as const"
              :key="s"
              :value="s"
              :disabled="
                s === selected.state ||
                (selected.blockers.length > 0 && ['active', 'waiting', 'done'].includes(s))
              "
            >
              {{ tr(actionLabels[s]) }}
            </option>
          </select>
        </label>
        <label>
          {{
            selectedAction === 'skipped'
              ? tr('Why is this task not needed?')
              : tr('Result or follow-up')
          }}
          <textarea
            v-model="outcome"
            rows="3"
            :required="
              finishedAction || selectedAction === 'progress' || selectedAction === 'waiting'
            "
            :placeholder="tr('What happened, or what are we waiting for?')"
          />
        </label>
        <template v-if="!finishedAction && selectedAction !== 'planned'">
          <label>
            {{ tr('Next concrete step') }}
            <textarea
              v-model="nextStep"
              rows="2"
              maxlength="1500"
              :placeholder="tr('One action someone can take next')"
            />
          </label>
          <label
            v-if="
              selectedAction === 'waiting' ||
              (selectedAction === 'progress' && selected.state === 'waiting')
            "
          >
            {{ tr('Follow up on') }}
            <input v-model="followUpOn" type="date" />
            <small>{{ tr('Appears in Focus when the date arrives.') }}</small>
          </label>
          <label v-if="selectedAction === 'active' && !selected.ownerId" class="check-row">
            <input v-model="claim" type="checkbox" />
            {{ tr('Assign this task to me') }}
          </label>
        </template>
        <template v-if="finishedAction">
          <label>
            {{ tr('Original evidence or decision note') }}
            <textarea
              v-model="evidenceText"
              required
              rows="3"
              :placeholder="
                tr('Paste the result, approval, or reason. Saved as an original reference.')
              "
            />
          </label>
          <label>
            {{ tr('Source / test artifact URL') }}
            <input v-model="evidenceUrl" type="url" placeholder="https://…" />
          </label>
          <div
            v-if="selected.templateKey === 'validation' && selectedAction === 'done'"
            class="form-grid"
          >
            <label>
              {{ tr('Tested environment') }}
              <input
                v-model="environment"
                required
                :placeholder="tr('Environment and account scope')"
              />
            </label>
            <label>
              {{ tr('Code revision') }}
              <input v-model="codeRevision" required :placeholder="tr('Commit or release')" />
            </label>
          </div>
        </template>
        <p class="hint">
          {{
            tr(
              'This records work and results. It does not run an API test or change a live trading account.',
            )
          }}
        </p>
        <p v-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
        <button type="submit" :disabled="busy">
          {{
            busy
              ? tr('Saving…')
              : selectedAction === 'progress'
                ? tr('Save progress')
                : selectedAction === 'done'
                  ? tr('Complete task')
                  : selectedAction === 'waiting'
                    ? tr('Save follow-up')
                    : selectedAction === 'active'
                      ? tr('Start work')
                      : tr('Save decision')
          }}
        </button>
      </form>
      <p v-else-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
      <footer
        v-if="editable && (!actionFeedback || !isFinished(selected.state))"
        class="inspector-action-bar"
      >
        <small>{{ tr(taskStates[selected.displayState]) }}</small>
        <button type="button" @click="scrollToForm">
          {{ tr('Move this forward') }}
          <Icon name="arrow" :size="14" />
        </button>
      </footer>
    </div>
  </AppDialog>
</template>
