<script setup lang="ts">
// 任务集合:列表与看板(frontend-spec 10.2),从 v1 WorkTaskCollection.vue 迁移。
import { computed } from 'vue';
import { laneNames, taskStates, type WorkTask } from '../../shared/operations';
import { taskAttention, taskGroup } from '../../shared/work-queue';
import { taskText, taskOwner } from '../task-text';
import { tr } from '../i18n';
const props = defineProps<{ tasks: WorkTask[]; layout?: 'list' | 'board'; embedded?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const groups = computed(() =>
  Array.from(new Set(props.tasks.map((t) => taskGroup(t)))).map((title) => ({
    title,
    tasks: props.tasks.filter((t) => taskGroup(t) === title),
  })),
);
</script>
<template>
  <div v-if="layout === 'board'" class="kanban">
    <section v-for="group in groups" :key="group.title" class="kanban-column">
      <h3>
        {{ tr(group.title) }}
        <span class="count">{{ group.tasks.length }}</span>
      </h3>
      <button
        v-for="task in group.tasks"
        :key="task.id"
        type="button"
        class="task-card"
        @click="emit('select', task.id)"
      >
        <small>{{ task.organizationName }} · {{ tr(laneNames[task.lane]) }}</small>
        <strong>{{ taskText(task) }}</strong>
        <span class="task-state" :class="'state-' + task.displayState">
          {{ tr(taskStates[task.displayState]) }}
        </span>
        <span v-for="reason in taskAttention(task)" :key="reason" class="task-queue-alert">
          {{ tr(reason) }}
        </span>
        <span v-if="task.blockers.length" class="task-card-note">
          {{ tr('After {0} prerequisites', [task.blockers.length]) }}
        </span>
        <span class="task-card-footer">
          <span>{{ taskOwner(task) }}</span>
          <span>{{ task.followUpOn || task.dueOn }}</span>
        </span>
      </button>
    </section>
  </div>
  <div v-else class="task-queue-list">
    <section v-for="group in groups" :key="group.title" class="task-queue-group">
      <h3>
        {{ tr(group.title) }}
        <span class="count">{{ group.tasks.length }}</span>
      </h3>
      <button
        v-for="task in group.tasks"
        :key="task.id"
        type="button"
        class="task-queue-row"
        @click="emit('select', task.id)"
      >
        <span class="task-queue-title">
          <strong>{{ taskText(task) }}</strong>
          <small>
            {{
              embedded
                ? tr(laneNames[task.lane])
                : task.organizationName + ' · ' + tr(laneNames[task.lane])
            }}
          </small>
        </span>
        <span class="task-queue-signals">
          <span class="task-state" :class="'state-' + task.displayState">
            {{ tr(taskStates[task.displayState]) }}
          </span>
          <span v-for="reason in taskAttention(task)" :key="reason" class="task-queue-alert">
            {{ tr(reason) }}
          </span>
        </span>
        <span class="task-queue-owner">{{ taskOwner(task) }}</span>
        <span class="task-queue-date">
          {{ task.followUpOn ? tr('Follow up {0}', [task.followUpOn]) : task.dueOn || '—' }}
        </span>
      </button>
    </section>
  </div>
</template>
