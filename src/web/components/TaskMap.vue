<script setup lang="ts">
// 依赖图(frontend-spec 10.7),从 v1 TaskMap.vue 迁移。横轴是拓扑层,不表示时间长度。
import { computed, useId, ref, watch } from 'vue';
import {
  dependencyLayers,
  laneNames,
  onboardingTemplate,
  taskStates,
  type WorkTask,
} from '../../shared/operations';
import { taskText, taskOwner } from '../task-text';
import { tr } from '../i18n';
const props = defineProps<{ tasks: WorkTask[]; highlighted?: string[]; initialFocus?: string }>();
const emit = defineEmits<{ select: [id: string] }>();
const zoom = ref(1);
const viewport = ref<HTMLElement>();
const focused = ref(props.initialFocus || '');
watch(
  () => props.tasks,
  (tasks) => {
    if (focused.value && !tasks.some((task) => task.id === focused.value)) focused.value = '';
  },
);
const scopedTasks = computed(() =>
  !focused.value
    ? props.tasks
    : props.tasks.filter(
        (t) =>
          t.id === focused.value ||
          t.dependencies.includes(focused.value) ||
          props.tasks.find((x) => x.id === focused.value)?.dependencies.includes(t.id),
      ),
);
function fit() {
  zoom.value = Math.max(
    0.25,
    Math.min(1, (viewport.value?.clientWidth || 800) / layout.value.width),
  );
}
const markerId = 'task-arrow-' + useId();
const layout = computed(() => {
  const templateOrder = new Map(onboardingTemplate.map((t, i) => [t.key, i]));
  const tasks = [...scopedTasks.value].sort(
    (a, b) =>
      (templateOrder.get(a.templateKey) ?? 99) - (templateOrder.get(b.templateKey) ?? 99) ||
      a.title.localeCompare(b.title),
  );
  const layers = dependencyLayers(tasks);
  const nodes = layers.flatMap((layerIds, col) =>
    layerIds.map((id, row) => ({
      task: props.tasks.find((t) => t.id === id)!,
      x: col * 320 + 20,
      y: row * 136 + 44,
    })),
  );
  const byId = new Map(nodes.map((n) => [n.task.id, n]));
  const baseHeight = Math.max(200, ...layers.map((l) => l.length * 136 + 52));
  let bypasses = 0;
  const links = nodes.flatMap((n) =>
    n.task.dependencies.flatMap((id) => {
      const start = byId.get(id);
      if (!start) return [];
      const bottom = baseHeight + bypasses * 20;
      const long = n.x - start.x > 320;
      if (long) bypasses++;
      return [
        {
          key: id + n.task.id,
          done: ['done', 'skipped'].includes(start.task.state),
          d: long
            ? `M ${start.x + 260} ${start.y + 51} H ${start.x + 280} V ${bottom} H ${n.x - 20} V ${n.y + 51} H ${n.x}`
            : `M ${start.x + 260} ${start.y + 51} C ${start.x + 290} ${start.y + 51}, ${n.x - 30} ${n.y + 51}, ${n.x} ${n.y + 51}`,
        },
      ];
    }),
  );
  return {
    nodes,
    links,
    width: Math.max(320, layers.length * 320),
    height: baseHeight + bypasses * 20 + 12,
    layers,
  };
});
</script>
<template>
  <div class="task-map-toolbar">
    <label>
      {{ tr('Focus task path') }}
      <select v-model="focused">
        <option value="">{{ tr('All tasks') }}</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">{{ taskText(task) }}</option>
      </select>
    </label>
    <button
      type="button"
      class="ghost"
      :aria-label="tr('Zoom out')"
      @click="zoom = Math.max(0.25, zoom - 0.15)"
    >
      −
    </button>
    <button type="button" class="link" :aria-label="tr('Reset zoom')" @click="zoom = 1">
      {{ Math.round(zoom * 100) }}%
    </button>
    <button
      type="button"
      class="ghost"
      :aria-label="tr('Zoom in')"
      @click="zoom = Math.min(1.5, zoom + 0.15)"
    >
      +
    </button>
    <button type="button" class="link" @click="fit">{{ tr('Fit graph') }}</button>
  </div>
  <div
    ref="viewport"
    class="task-map-scroll"
    tabindex="0"
    :aria-label="tr('Task dependencies. Scroll horizontally to follow prerequisites.')"
  >
    <div :style="{ width: layout.width * zoom + 'px', height: layout.height * zoom + 'px' }">
      <div
        class="task-map"
        :style="{
          width: layout.width + 'px',
          height: layout.height + 'px',
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }"
      >
        <svg :width="layout.width" :height="layout.height" aria-hidden="true">
          <defs>
            <marker :id="markerId" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8" fill="var(--muted)" />
            </marker>
          </defs>
          <path
            v-for="link in layout.links"
            :key="link.key"
            :d="link.d"
            fill="none"
            :stroke="link.done ? 'var(--joined)' : 'var(--line)'"
            stroke-width="1.5"
            :marker-end="'url(#' + markerId + ')'"
          />
        </svg>
        <span
          v-for="(_, i) in layout.layers"
          :key="i"
          class="map-stage"
          :style="{ left: i * 320 + 20 + 'px' }"
        >
          {{ i === 0 ? tr('Can start independently') : tr('After prerequisites') }}
        </span>
        <button
          v-for="n in layout.nodes"
          :key="n.task.id"
          type="button"
          class="task-map-node"
          :class="[
            'state-' + n.task.displayState,
            { 'newly-ready': highlighted?.includes(n.task.id) },
          ]"
          :style="{ left: n.x + 'px', top: n.y + 'px' }"
          @click="emit('select', n.task.id)"
        >
          <small>{{ tr(laneNames[n.task.lane]) }} · {{ taskOwner(n.task) }}</small>
          <strong>{{ taskText(n.task) }}</strong>
          <span class="task-state" :class="'state-' + n.task.displayState">
            {{ tr(taskStates[n.task.displayState]) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
