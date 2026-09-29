<script setup lang="ts">
// 组织架构图(frontend-spec 6.1–6.3),从 v1 OrgChart.vue 迁移。
// 人员详情侧栏的「目标与激励」(6.16)随 position_drivers 一起迁移。
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { cardHeight, cardWidth, descendants, layoutChart } from '../../shared/org-chart';
import type { ModuleRecord, Organization } from '../../shared/types';
import AppDialog from './AppDialog.vue';
import Icon from './Icon.vue';
import OrgLogo from './OrgLogo.vue';
const props = defineProps<{ organization: Organization; records: ModuleRecord[] }>();
const emit = defineEmits<{ edit: [record?: ModuleRecord]; history: [id: string]; refresh: [] }>();
const editable = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const viewport = ref<HTMLElement>();
const inspector = ref<HTMLElement>();
const zoom = ref(1);
const query = ref('');
const listMode = ref(false);
const expandedCanvas = ref(false);
const branch = ref('');
const branchRecords = computed(() => {
  if (!branch.value) return props.records;
  const ids = descendants(props.records, branch.value);
  return props.records.filter((r) => ids.has(r.id));
});
const collapsed = ref(new Set<string>());
const selectedId = ref('');
const route = useRoute();
const selected = computed(() => props.records.find((r) => r.id === selectedId.value));
watch(selectedId, async () => {
  await nextTick();
  inspector.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
const layout = computed(() => {
  const chart = layoutChart(
    branchRecords.value.map((r) => (r.id === branch.value ? { ...r, reportsTo: '' } : r)),
    collapsed.value,
  );
  return {
    ...chart,
    nodes: chart.nodes.map((n) => ({
      ...n,
      record: props.records.find((r) => r.id === n.record.id)!,
    })),
  };
});
const matches = computed(() => {
  const term = query.value.trim().toLowerCase();
  return term
    ? props.records.filter((r) =>
        [r.personName, r.title, r.personEmail].some((v) => v.toLowerCase().includes(term)),
      )
    : [];
});
const hasReports = (id: string) => props.records.some((c) => c.reportsTo === id);
const topLevel = computed(() => props.records.filter((r) => !r.reportsTo).length);

// ---- 调整汇报(6.2) ----
const status = ref('');
const pending = ref<{ record: ModuleRecord; parentId: string }>();
watch(pending, (value) => {
  if (!value) status.value = '';
});
const moveForm = reactive({
  parentId: '',
  kind: 'unconfirmed' as 'confirmed' | 'unconfirmed',
  note: '',
  sourceUrl: '',
});
const saving = ref(false);
const moveError = ref('');
const blocked = computed(() =>
  pending.value ? descendants(props.records, pending.value.record.id) : new Set<string>(),
);
const parentOptions = computed(() =>
  props.records.filter(
    (r) => !blocked.value.has(r.id) && r.visibility === pending.value?.record.visibility,
  ),
);
const changed = computed(
  () =>
    !!pending.value &&
    (moveForm.parentId !== pending.value.record.reportsTo ||
      (!!moveForm.parentId && moveForm.kind !== pending.value.record.relationshipKind)),
);
type Drag = {
  record: ModuleRecord;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: string | null;
};
const drag = ref<Drag>();
const invalidDrop = computed(() =>
  drag.value ? descendants(props.records, drag.value.record.id) : new Set<string>(),
);
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
const parentName = (id: string) =>
  props.records.find((r) => r.id === id)?.personName || tr('No recorded manager / Top level');
const relationshipLabel = (record: ModuleRecord) =>
  record.relationshipKind === 'confirmed'
    ? tr('Confirmed direct report')
    : tr('Unconfirmed relationship');
function toggle(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}
function toggleAll() {
  collapsed.value = collapsed.value.size
    ? new Set()
    : new Set(props.records.filter((r) => hasReports(r.id)).map((r) => r.id));
}
async function centerRoot() {
  await nextTick();
  const root = layout.value.nodes.find((n) => !n.record.reportsTo) || layout.value.nodes[0];
  if (root && viewport.value)
    viewport.value.scrollTo({
      left: Math.max(0, (root.x + cardWidth / 2) * zoom.value - viewport.value.clientWidth / 2),
      top: 0,
    });
}
async function fit() {
  if (!viewport.value) return;
  zoom.value = Math.max(0.4, Math.min(1, (viewport.value.clientWidth - 24) / layout.value.width));
  await centerRoot();
}
async function setZoom(value: number) {
  const view = viewport.value;
  const centerX = view ? (view.scrollLeft + view.clientWidth / 2) / zoom.value : 0;
  const centerY = view ? (view.scrollTop + view.clientHeight / 2) / zoom.value : 0;
  zoom.value = Math.max(0.4, Math.min(1.4, Math.round(value * 10) / 10));
  await nextTick();
  if (view)
    view.scrollTo({
      left: centerX * zoom.value - view.clientWidth / 2,
      top: centerY * zoom.value - view.clientHeight / 2,
    });
}
function focusBranch(id: string) {
  branch.value = id;
  zoom.value = 1;
  void centerRoot();
}
function showFullOrganization() {
  branch.value = '';
  void centerRoot();
}
async function locate(record: ModuleRecord) {
  listMode.value = false;
  if (branch.value && !descendants(props.records, branch.value).has(record.id)) branch.value = '';
  zoom.value = 1;
  selectedId.value = record.id;
  let cursor = record.reportsTo;
  const next = new Set(collapsed.value);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    next.delete(cursor);
    cursor = props.records.find((r) => r.id === cursor)?.reportsTo || '';
  }
  collapsed.value = next;
  await nextTick();
  const node = layout.value.nodes.find((n) => n.record.id === record.id);
  if (node && viewport.value)
    viewport.value.scrollTo({
      left: (node.x + cardWidth / 2) * zoom.value - viewport.value.clientWidth / 2,
      top: Math.max(0, node.y * zoom.value - 30),
      behavior: 'smooth',
    });
}
function openMove(record: ModuleRecord, target = record.reportsTo) {
  pending.value = { record, parentId: target };
  moveForm.parentId = target;
  moveForm.kind = target === record.reportsTo ? record.relationshipKind : 'unconfirmed';
  moveForm.note = '';
  moveForm.sourceUrl = '';
  moveError.value = '';
}
watch(
  () => moveForm.parentId,
  (parent) => {
    if (pending.value && parent !== pending.value.record.reportsTo) moveForm.kind = 'unconfirmed';
  },
);
async function saveMove() {
  if (!pending.value || !changed.value || saving.value) return;
  saving.value = true;
  moveError.value = '';
  try {
    await api(
      `/api/organizations/${props.organization.id}/org-chart/${pending.value.record.id}/relationship`,
      {
        method: 'PATCH',
        body: {
          revision: pending.value.record.revision,
          reportsTo: moveForm.parentId,
          relationshipKind: moveForm.parentId ? moveForm.kind : 'unconfirmed',
          note: moveForm.note,
          sourceUrl: moveForm.sourceUrl,
        },
      },
    );
    pending.value = undefined;
    emit('refresh');
  } catch (e) {
    moveError.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
function startDrag(event: PointerEvent, record: ModuleRecord) {
  if (!editable.value || event.button !== 0 || saving.value) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  event.preventDefault();
  drag.value = {
    record,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    target: null,
  };
}
function dropTarget(x: number, y: number): string | null {
  if (!drag.value) return null;
  for (const hit of document.elementsFromPoint(x, y)) {
    const root = hit.closest<HTMLElement>('[data-chart-root]');
    if (root?.dataset.chartRoot === props.organization.id && drag.value.record.reportsTo) return '';
    const node = hit.closest<HTMLElement>('[data-chart-node]');
    if (!node || !viewport.value?.contains(node)) continue;
    const id = node.dataset.chartNode!;
    const record = props.records.find((r) => r.id === id);
    if (
      record &&
      !invalidDrop.value.has(id) &&
      id !== drag.value.record.reportsTo &&
      record.visibility === drag.value.record.visibility
    )
      return id;
  }
  return null;
}
function moveDrag(event: PointerEvent) {
  if (!drag.value) return;
  const d = drag.value;
  d.x = event.clientX;
  d.y = event.clientY;
  if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) < 6) return;
  d.active = true;
  d.target = dropTarget(d.x, d.y);
  status.value =
    d.target === null
      ? tr('Drop on a different manager or the top-level area. Descendants cannot be managers.')
      : tr('Move {0} to {1}. Release to review.', [d.record.personName, parentName(d.target)]);
}
function endDrag() {
  if (!drag.value) return;
  const d = drag.value;
  drag.value = undefined;
  if (d.active && d.target !== null) openMove(d.record, d.target);
  else if (d.active)
    status.value = tr('Move cancelled. The reporting relationship has not changed.');
}
function cancelDrag() {
  drag.value = undefined;
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (drag.value) cancelDrag();
  // 对话框(包括证据抽屉)打开时 Escape 只关对话框,画布模式不跟着退出。
  else if (!document.querySelector('[aria-modal="true"]')) expandedCanvas.value = false;
}
let scrollFrame = 0;
watch(
  () => drag.value?.active,
  (active) => {
    cancelAnimationFrame(scrollFrame);
    if (!active) return;
    const scroll = () => {
      const d = drag.value;
      const box = viewport.value?.getBoundingClientRect();
      if (!d?.active || !box || !viewport.value) return;
      const within = d.x > box.left && d.x < box.right && d.y > box.top && d.y < box.bottom;
      if (within) {
        const dx = d.x < box.left + 42 ? -12 : d.x > box.right - 42 ? 12 : 0;
        const dy = d.y < box.top + 42 ? -12 : d.y > box.bottom - 42 ? 12 : 0;
        if (dx || dy) {
          viewport.value.scrollBy(dx, dy);
          d.target = dropTarget(d.x, d.y);
        }
      }
      scrollFrame = requestAnimationFrame(scroll);
    };
    scrollFrame = requestAnimationFrame(scroll);
  },
);
function initialCollapsedBranches() {
  const ids = new Set(props.records.map((record) => record.id));
  const managers = new Set(props.records.map((record) => record.reportsTo));
  // 初始只显示根和根的直接下属;更深的分支可展开。
  return new Set(
    props.records
      .filter(
        (record) =>
          record.reportsTo !== record.id && ids.has(record.reportsTo) && managers.has(record.id),
      )
      .map((record) => record.id),
  );
}
let waitingForInitialRecords = false;
watch(
  () => props.organization.id,
  () => {
    cancelDrag();
    pending.value = undefined;
    moveError.value = '';
    status.value = '';
    query.value = '';
    selectedId.value = '';
    branch.value = '';
    listMode.value = false;
    expandedCanvas.value = false;
    zoom.value = 1;
    collapsed.value = initialCollapsedBranches();
    waitingForInitialRecords = !props.records.length;
    void centerRoot();
  },
  { immediate: true, flush: 'post' },
);
watch(
  () => props.records,
  () => {
    // 首次数据异步到达时只初始化一次;保存后的刷新保留展开状态与缩放。
    if (!waitingForInitialRecords || !props.records.length) return;
    waitingForInitialRecords = false;
    collapsed.value = initialCollapsedBranches();
    void centerRoot();
  },
  { flush: 'post' },
);
watch(
  () => [route.query.record, props.organization.id, props.records],
  async (_, __, cleanup) => {
    let current = true;
    cleanup(() => {
      current = false;
    });
    const target = props.records.find((record) => record.id === route.query.record);
    if (!target) return;
    // 先初始化图,再展开上级并居中这个人(1.2 的定位)。
    await nextTick();
    if (current) await locate(target);
  },
  { immediate: true, flush: 'post' },
);
onMounted(() => document.addEventListener('keydown', escape));
onUnmounted(() => {
  cancelAnimationFrame(scrollFrame);
  document.removeEventListener('keydown', escape);
});
</script>
<template>
  <section
    class="org-chart-workbench"
    :class="{ 'is-dragging': drag?.active, 'chart-expanded': expandedCanvas }"
    :aria-label="tr('Interactive organization chart')"
  >
    <div class="org-chart-toolbar">
      <div class="segmented">
        <button type="button" :aria-pressed="!listMode" @click="listMode = false">
          {{ tr('Chart') }}
        </button>
        <button type="button" :aria-pressed="listMode" @click="listMode = true">
          {{ tr('List') }}
        </button>
      </div>
      <button
        type="button"
        class="link"
        :aria-pressed="expandedCanvas"
        @click="expandedCanvas = !expandedCanvas"
      >
        {{ tr(expandedCanvas ? 'Exit canvas' : 'Canvas mode') }}
      </button>
      <button
        v-if="selected && !branch"
        type="button"
        class="link"
        @click="focusBranch(selected.id)"
      >
        {{ tr('Focus selected branch') }}
      </button>
      <button v-if="branch" type="button" class="link" @click="showFullOrganization">
        {{ tr('Show full organization') }}
      </button>
      <label class="chart-search">
        <Icon name="search" :size="16" />
        <input
          v-model="query"
          :aria-label="tr('Find a person')"
          :placeholder="tr('Find a person or role…')"
        />
      </label>
      <span class="chart-people-count">
        {{ records.length }} {{ records.length === 1 ? tr('person') : tr('people') }}
      </span>
      <div class="chart-zoom-controls">
        <button
          type="button"
          class="ghost"
          :aria-label="tr('Zoom out')"
          :disabled="zoom <= 0.4"
          @click="setZoom(zoom - 0.1)"
        >
          −
        </button>
        <output :aria-label="tr('Chart zoom')">{{ Math.round(zoom * 100) }}%</output>
        <button
          type="button"
          class="ghost"
          :aria-label="tr('Zoom in')"
          :disabled="zoom >= 1.4"
          @click="setZoom(zoom + 0.1)"
        >
          +
        </button>
        <button type="button" class="ghost" @click="fit">{{ tr('Fit') }}</button>
      </div>
      <button
        v-if="records.some((r) => hasReports(r.id))"
        type="button"
        class="link"
        @click="toggleAll"
      >
        {{ collapsed.size ? tr('Expand all') : tr('Collapse all') }}
      </button>
    </div>
    <div v-if="query.trim()" class="chart-search-results">
      <p v-if="!matches.length" class="hint">{{ tr('No matching people.') }}</p>
      <button v-for="record in matches" :key="record.id" type="button" @click="locate(record)">
        <strong>{{ record.personName }}</strong>
        <span>{{ record.title }}</span>
      </button>
    </div>
    <div class="chart-legend">
      <span><i class="chart-line-sample confirmed" /> {{ tr('Confirmed direct report') }}</span>
      <span><i class="chart-line-sample" /> {{ tr('Unconfirmed relationship') }}</span>
      <span class="hint">
        {{
          editable ? tr('Drag a grip onto a manager to change reporting.') : tr('Read-only chart')
        }}
      </span>
    </div>
    <div
      :data-chart-root="organization.id"
      class="chart-root-area"
      :class="{ 'drop-active': drag?.active && drag.target === '' }"
    >
      <OrgLogo :name="organization.name" :src="organization.logoUrl" />
      <div>
        <strong>{{ organization.name }}</strong>
        <small>
          {{
            drag?.active
              ? tr('Drop here to remove the recorded manager')
              : tr('Top level · No manager recorded')
          }}
        </small>
      </div>
      <span class="hint chart-root-count">
        {{ topLevel }} {{ topLevel === 1 ? tr('position') : tr('positions') }}
      </span>
    </div>
    <div v-if="!records.length" class="empty chart-empty">
      <Icon name="users" :size="32" />
      <h3>{{ tr('Build this organization’s people map') }}</h3>
      <p>
        {{
          tr('Add people and their roles, then connect reporting relationships as you learn more.')
        }}
      </p>
      <button v-if="editable" type="button" @click="emit('edit')">
        <Icon name="plus" :size="16" /> {{ tr('Add the first person') }}
      </button>
    </div>
    <div v-else-if="listMode" class="table-wrap chart-list">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Person name') }}</th>
            <th>{{ tr('Role / job title') }}</th>
            <th>{{ tr('Reports to') }}</th>
            <th>{{ tr('Relationship') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="person in query.trim() ? matches : branchRecords" :key="person.id">
            <td>
              <button type="button" class="link" @click="selectedId = person.id">
                {{ person.personName }}
              </button>
            </td>
            <td>{{ person.title }}</td>
            <td>{{ parentName(person.reportsTo) }}</td>
            <td>{{ person.reportsTo ? relationshipLabel(person) : '—' }}</td>
            <td>
              <button type="button" class="link" @click="locate(person)">
                {{ tr('Locate in chart') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-else
      ref="viewport"
      class="chart-viewport"
      :style="{
        height: expandedCanvas
          ? 'calc(100vh - 230px)'
          : Math.min(Math.max(layout.height * zoom + 16, 360), 680) + 'px',
      }"
      tabindex="0"
      :aria-label="tr('Org chart canvas. Scroll to explore; use the zoom controls to resize.')"
    >
      <div
        class="chart-scaled-area"
        :style="{
          width: layout.width * zoom + 'px',
          height: layout.height * zoom + 'px',
          minWidth: '100%',
        }"
      >
        <div
          class="chart-scene"
          :style="{
            width: layout.width + 'px',
            height: layout.height + 'px',
            marginLeft: -(layout.width * zoom) / 2 + 'px',
            transform: `scale(${zoom})`,
          }"
        >
          <svg
            class="chart-connections"
            :width="layout.width"
            :height="layout.height"
            aria-hidden="true"
          >
            <path
              v-for="edge in layout.edges"
              :key="edge.id"
              :d="edge.path"
              :class="['chart-edge', edge.kind]"
            />
          </svg>
          <article
            v-for="node in layout.nodes"
            :key="node.record.id"
            :data-chart-node="node.record.id"
            class="person-node"
            :class="{
              selected: selectedId === node.record.id,
              'drop-active': drag?.active && drag.target === node.record.id,
              'drag-source': drag?.active && drag.record.id === node.record.id,
              'search-match': matches.some((r) => r.id === node.record.id),
            }"
            :style="{
              left: node.x + 'px',
              top: node.y + 'px',
              width: cardWidth + 'px',
              height: cardHeight + 'px',
            }"
          >
            <button
              v-if="editable"
              type="button"
              class="person-drag-handle"
              :aria-label="tr('Move {0}', [node.record.personName])"
              :title="tr('Drag to another manager, or press Enter to choose one')"
              @pointerdown="startDrag($event, node.record)"
              @pointermove="moveDrag"
              @pointerup="endDrag"
              @pointercancel="cancelDrag"
              @keydown.enter.prevent="openMove(node.record)"
              @keydown.space.prevent="openMove(node.record)"
            >
              ⠿
            </button>
            <button
              type="button"
              class="person-open"
              :aria-label="tr('View {0}', [node.record.personName])"
              @click="selectedId = node.record.id"
            >
              <span class="person-avatar" aria-hidden="true">{{
                initials(node.record.personName)
              }}</span>
              <strong :title="node.record.personName">{{ node.record.personName }}</strong>
              <span class="person-role" :title="node.record.title">{{ node.record.title }}</span>
            </button>
            <span
              class="person-relationship"
              :class="node.record.reportsTo ? node.record.relationshipKind : 'none'"
            >
              {{
                node.record.reportsTo
                  ? node.record.relationshipKind === 'confirmed'
                    ? tr('Confirmed reporting line')
                    : tr('Unconfirmed reporting line')
                  : tr('No recorded manager')
              }}
            </span>
            <button
              v-if="node.childCount"
              type="button"
              class="person-reports"
              :aria-label="
                tr('{0} reports of {1}', [
                  collapsed.has(node.record.id) ? tr('Expand') : tr('Collapse'),
                  node.record.personName,
                ])
              "
              :aria-expanded="!collapsed.has(node.record.id)"
              @click="toggle(node.record.id)"
            >
              {{ node.childCount }} {{ node.childCount === 1 ? tr('report') : tr('reports') }}
              <span>{{ collapsed.has(node.record.id) ? '+' : '−' }}</span>
            </button>
            <span v-else class="person-leaf">{{ tr('No recorded reports') }}</span>
          </article>
        </div>
      </div>
    </div>
    <p v-if="status" class="chart-status" role="status">{{ status }}</p>
    <p class="chart-footnote">
      {{
        tr(
          'A dashed line is an unconfirmed relationship, not a verified reporting line. People without a recorded manager stay at the top level.',
        )
      }}
    </p>
    <div
      v-if="drag?.active"
      class="chart-drag-ghost"
      :style="{ left: drag.x + 14 + 'px', top: drag.y + 14 + 'px' }"
    >
      {{ drag.record.personName }}
    </div>
    <aside
      v-if="selected"
      ref="inspector"
      class="person-inspector"
      :aria-label="tr('Selected person')"
    >
      <header>
        <div>
          <small class="eyebrow">{{ tr('PERSON DETAILS') }}</small>
          <h3>{{ selected.personName }}</h3>
          <p>{{ selected.title }}</p>
        </div>
        <button
          type="button"
          class="ghost"
          :aria-label="tr('Close person details')"
          @click="selectedId = ''"
        >
          <Icon name="close" />
        </button>
      </header>
      <dl>
        <div>
          <dt>{{ tr('Email') }}</dt>
          <dd>
            <a v-if="selected.personEmail" :href="'mailto:' + selected.personEmail">
              {{ selected.personEmail }}
            </a>
            <span v-else class="hint">{{ tr('Not published / not recorded') }}</span>
          </dd>
        </div>
        <div>
          <dt>{{ tr('Reports to') }}</dt>
          <dd>
            {{ parentName(selected.reportsTo) }}
            <small v-if="selected.reportsTo">{{ relationshipLabel(selected) }}</small>
          </dd>
        </div>
        <div>
          <dt>{{ tr('Last updated') }}</dt>
          <dd>
            {{ selected.author }} · {{ dateTime(selected.updatedAt) }} · v{{ selected.revision }}
          </dd>
        </div>
      </dl>
      <p class="record-body">{{ selected.body }}</p>
      <p v-if="selected.relationshipNote" class="record-body">
        <strong>{{ tr('Relationship evidence') }}</strong>
        <br />
        {{ selected.relationshipNote }}
      </p>
      <footer>
        <button v-if="editable" type="button" class="ghost" @click="emit('edit', selected)">
          {{ tr('Edit person') }}
        </button>
        <button v-if="editable" type="button" class="ghost" @click="openMove(selected)">
          {{ tr('Change reporting') }}
        </button>
        <button type="button" class="link" @click="openEvidence(selected.evidenceId)">
          {{ tr('Person reference') }}
        </button>
        <button
          v-if="selected.relationshipEvidenceId"
          type="button"
          class="link"
          @click="openEvidence(selected.relationshipEvidenceId)"
        >
          {{ tr('Relationship reference') }}
        </button>
        <button type="button" class="link" @click="emit('history', selected.id)">
          {{ tr('History') }}
        </button>
      </footer>
    </aside>
    <AppDialog
      v-if="pending"
      :eyebrow="tr('{0} / REPORTING RELATIONSHIP', [organization.name])"
      :title="tr('Move {0}', [pending.record.personName])"
      :busy="saving"
      @close="pending = undefined"
    >
      <form @submit.prevent="saveMove">
        <p class="chart-move-current">
          {{ tr('Current manager:') }} <strong>{{ parentName(pending.record.reportsTo) }}</strong>
        </p>
        <label for="move-parent">{{ tr('Reports to') }}</label>
        <select id="move-parent" v-model="moveForm.parentId">
          <option value="">{{ tr('No recorded manager / Top level') }}</option>
          <option v-for="parent in parentOptions" :key="parent.id" :value="parent.id">
            {{ parent.personName }} · {{ parent.title }}
          </option>
        </select>
        <template v-if="moveForm.parentId">
          <label for="move-kind">{{ tr('Relationship certainty') }}</label>
          <select id="move-kind" v-model="moveForm.kind">
            <option value="unconfirmed">{{ tr('Unconfirmed relationship · Dashed line') }}</option>
            <option value="confirmed">{{ tr('Confirmed direct report · Solid line') }}</option>
          </select>
        </template>
        <label for="move-note">{{ tr('Original evidence / reason for this change') }}</label>
        <textarea
          id="move-note"
          v-model="moveForm.note"
          required
          rows="4"
          maxlength="100000"
          :placeholder="
            tr(
              'Paste the original correspondence, or record your first-hand observation: who, what and when.',
            )
          "
        />
        <label for="move-url">{{ tr('Source URL (optional)') }}</label>
        <input
          id="move-url"
          v-model="moveForm.sourceUrl"
          type="url"
          maxlength="2000"
          placeholder="https://…"
        />
        <p class="hint">
          {{
            tr(
              'The person’s original reference is retained. This relationship change gets its own reference and history entry.',
            )
          }}
        </p>
        <p v-if="moveError" class="error" role="alert">{{ tr(moveError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="saving" @click="pending = undefined">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="saving || !changed || !moveForm.note.trim()">
            {{ saving ? tr('Saving…') : tr('Save relationship') }}
          </button>
        </div>
      </form>
    </AppDialog>
  </section>
</template>
