<script setup lang="ts">
// 关系图谱画布(frontend-spec 7.5、7.6),从 v1 RelationshipGraph.vue 迁移。
import { computed, nextTick, onBeforeUnmount, ref, toRefs, useId, watch } from 'vue';
import type { ExplorationNode, ExplorationEdge } from '../../shared/exploration';
import {
  relationshipView,
  relationshipCanvas,
  relationshipKinds,
  relationshipFocus,
  type RelationshipKind,
} from '../../shared/relationship-view';
import type { RelationshipLayout } from '../../shared/relationship-layout';
import { tabs } from '../../shared/registry';
import { tr } from '../i18n';
import Icon from './Icon.vue';
import { profileLink as explorationDestination } from '../exploration-links';
import type { GraphViewState } from '../exploration-view';
const props = defineProps<{
  nodes: ExplorationNode[];
  edges: ExplorationEdge[];
  selectedId: string;
  selectedEdgeId?: string;
  historical: boolean;
  view: GraphViewState;
}>();
const emit = defineEmits<{
  select: [id: string];
  edge: [edge: ExplorationEdge | undefined];
  sources: [id: string];
  ready: [];
}>();
// The parent owns this mutable view state so graph/source switching preserves the canvas.
const { depth, limit, zoom, kinds, showSources, showAssociations, expanded } = toRefs(props.view);
const loading = ref(false),
  failed = ref(false);
let restoring = props.view.positioned && props.view.focusId === props.selectedId;
const hoveredNode = ref(''),
  hoveredEdge = ref('');
const retry = ref(0);
const marker = useId();
const viewport = ref<HTMLElement>();
const layout = ref<RelationshipLayout>({ nodes: [], paths: [], width: 320, height: 260 });
const selection = computed(() =>
  relationshipView(props.nodes, props.edges, props.selectedId, {
    depth: depth.value,
    historical: props.historical,
    kinds: kinds.value,
    sources: showSources.value,
    limit: limit.value,
  }),
);
const canvas = computed(() =>
  relationshipCanvas(
    selection.value.nodes,
    selection.value.edges,
    props.selectedId,
    showAssociations.value || showSources.value,
  ),
);
watch(
  () => props.selectedId,
  () => {
    if (props.view.focusId === props.selectedId) return;
    restoring = false;
    props.view.focusId = props.selectedId;
    props.view.positioned = false;
    limit.value = 24;
    showSources.value = false;
    showAssociations.value = false;
    hoveredNode.value = '';
    hoveredEdge.value = '';
    kinds.value =
      props.nodes.find((node) => node.id === props.selectedId)?.kind === 'organization' &&
      selection.value.counts.person
        ? ['person', 'organization']
        : [...relationshipKinds];
  },
  { immediate: true },
);
let request = 0;
onBeforeUnmount(() => {
  request++;
});
watch(
  [canvas, retry],
  async () => {
    const current = ++request;
    loading.value = true;
    failed.value = false;
    hoveredNode.value = '';
    hoveredEdge.value = '';
    if (!selection.value.edges.some((edge) => edge.id === props.selectedEdgeId))
      emit('edge', undefined);
    try {
      // Load the layout engine only when the user opens the relationship graph.
      const { layoutRelationships } = await import('../../shared/relationship-layout');
      const arranged = await layoutRelationships(canvas.value.nodes, canvas.value.edges);
      if (current !== request) return;
      layout.value = arranged;
      loading.value = false;
      await nextTick();
      if (restoring) {
        viewport.value?.scrollTo({ left: props.view.left, top: props.view.top });
        restoring = false;
      } else fit(true);
      props.view.positioned = true;
      emit('ready');
    } catch {
      if (current !== request) return;
      loading.value = false;
      failed.value = true;
    }
  },
  { immediate: true },
);
function rememberScroll() {
  if (!viewport.value) return;
  props.view.left = viewport.value.scrollLeft;
  props.view.top = viewport.value.scrollTop;
}
function fit(readable = false) {
  if (!viewport.value) return;
  zoom.value = Math.max(
    readable ? 0.85 : 0.25,
    Math.min(
      1,
      (viewport.value.clientWidth - 20) / layout.value.width,
      (viewport.value.clientHeight - 20) / layout.value.height,
    ),
  );
  viewport.value.scrollTo({ left: 0, top: 0 });
}
async function expand() {
  expanded.value = !expanded.value;
  await nextTick();
  fit(true);
}
function toggleKind(kind: RelationshipKind) {
  kinds.value = kinds.value.includes(kind)
    ? kinds.value.filter((value) => value !== kind)
    : [...kinds.value, kind];
  limit.value = 24;
}
async function resizeZoom(value: number) {
  const element = viewport.value;
  if (!element) return;
  const x = (element.scrollLeft + element.clientWidth / 2) / zoom.value;
  const y = (element.scrollTop + element.clientHeight / 2) / zoom.value;
  zoom.value = Math.max(0.25, Math.min(1.8, value));
  await nextTick();
  element.scrollTo({
    left: x * zoom.value - element.clientWidth / 2,
    top: y * zoom.value - element.clientHeight / 2,
  });
}
const focus = computed(() =>
  relationshipFocus(
    layout.value.paths.map((path) => path.edge),
    hoveredNode.value || undefined,
    hoveredEdge.value || (!hoveredNode.value ? props.selectedEdgeId : undefined),
  ),
);
const focused = computed(
  () => !!hoveredNode.value || !!hoveredEdge.value || !!props.selectedEdgeId,
);
const activePath = computed(() =>
  layout.value.paths.find((path) => path.edge.id === (hoveredEdge.value || props.selectedEdgeId)),
);
const businessEdges = computed(() =>
  selection.value.edges.filter((edge) => edge.kind !== 'context'),
);
const nodeName = (id: string) => props.nodes.find((node) => node.id === id)?.name || '';
const recordContext = (node: ExplorationNode) =>
  node.recordContext
    ? `${tr(tabs.find((tab) => tab.id === node.recordContext?.tabId)?.title || 'Source record')} · ${node.recordContext.title}`
    : node.origin === 'object'
      ? tr('Shared object')
      : tr('Organization context');
const kindLabels = {
  organization: 'Related organizations',
  person: 'People and roles',
  account: 'Accounts',
  capability: 'Provider capabilities',
  resource: 'Resources and approvals',
  record: 'Source records',
};
const nodeIcon = (kind: ExplorationNode['kind']) =>
  ({
    organization: 'building',
    person: 'users',
    account: 'lock',
    capability: 'database',
    resource: 'check',
    record: 'file',
  })[kind];
const edgeLabel = (edge: ExplorationEdge) =>
  edge.kind === 'relationship' ? edge.label : tr(edge.label);
const edgeDescription = (edge: ExplorationEdge) =>
  `${nodeName(edge.fromId)} → ${nodeName(edge.toId)} · ${edgeLabel(edge)}`;
const singularLabels = {
  organization: 'Organization',
  person: 'Person',
  account: 'Account',
  capability: 'Provider capability',
  resource: 'Our resource / approval',
  record: 'Source record',
};
</script>
<template>
  <section class="exploration-canvas" :class="{ expanded }" :aria-label="tr('Relationship graph')">
    <div class="graph-branches" :aria-label="tr('Expand by object type')">
      <span>{{ tr('Expand by object type') }}</span>
      <button
        type="button"
        v-for="kind in relationshipKinds.filter((kind) => selection.counts[kind] > 0)"
        :key="kind"
        :aria-pressed="kinds.includes(kind)"
        :class="{ active: kinds.includes(kind) }"
        @click="toggleKind(kind)"
      >
        <Icon :name="nodeIcon(kind)" :size="14" />
        {{ tr(kindLabels[kind]) }}
        <b>{{ selection.counts[kind] }}</b>
      </button>
      <label v-if="selection.foldedSources" class="graph-sources-toggle">
        <input v-model="showSources" type="checkbox" />
        {{ tr('Show source nodes') }}
        <b>{{ selection.foldedSources }}</b>
      </label>
    </div>
    <div class="graph-toolbar">
      <label>
        {{ tr('Explore depth') }}
        <select v-model.number="depth">
          <option :value="1">{{ tr('Direct connections') }}</option>
          <option :value="2">{{ tr('Two connections away') }}</option>
        </select>
      </label>
      <span class="caption muted">{{ tr('{0} visible nodes', [canvas.nodes.length]) }}</span>
      <div v-if="canvas.nodes.length" class="graph-zoom">
        <button
          type="button"
          :disabled="zoom <= 0.25"
          :aria-label="tr('Zoom out')"
          @click="resizeZoom(zoom - 0.15)"
        >
          −
        </button>
        <button type="button" :aria-label="tr('Reset zoom')" @click="resizeZoom(1)">
          {{ Math.round(zoom * 100) }}%
        </button>
        <button
          type="button"
          :disabled="zoom >= 1.8"
          :aria-label="tr('Zoom in')"
          @click="resizeZoom(zoom + 0.15)"
        >
          +
        </button>
        <button type="button" @click="fit()">{{ tr('Fit graph') }}</button>
        <button type="button" :aria-pressed="expanded" @click="expand">
          {{ expanded ? tr('Compact canvas') : tr('Expand canvas') }}
        </button>
      </div>
    </div>
    <div class="graph-legend">
      <span>
        <i />
        {{ tr('Confirmed relationship') }}
      </span>
      <span>
        <i class="dashed" />
        {{ tr('Unconfirmed relationship') }}
      </span>
      <span>
        <i class="context" />
        {{ tr('Record association only') }}
      </span>
      <label
        v-if="props.nodes.find((node) => node.id === selectedId)?.kind === 'organization'"
        class="graph-sources-toggle"
      >
        <input
          :checked="showAssociations || showSources"
          :disabled="showSources"
          type="checkbox"
          @change="showAssociations = ($event.target as HTMLInputElement).checked"
        />
        {{ tr('Show record associations') }}
      </label>
    </div>
    <div v-if="loading" class="graph-message" role="status">
      {{ tr('Arranging relationships…') }}
    </div>
    <div v-else-if="failed" class="graph-message" role="alert">
      {{ tr('The graph could not be arranged. Your data is unchanged.') }}
      <button type="button" class="link" @click="retry++">{{ tr('Retry') }}</button>
    </div>
    <template v-else-if="canvas.nodes.length">
      <div
        ref="viewport"
        class="graph-viewport"
        tabindex="0"
        :aria-label="tr('Scroll to explore connections')"
        @scroll="rememberScroll"
      >
        <div
          :style="{
            width: layout.width * zoom + 'px',
            height: layout.height * zoom + 'px',
            margin: 'auto',
          }"
        >
          <div
            class="graph-stage"
            :style="{
              width: layout.width + 'px',
              height: layout.height + 'px',
              transform: `scale(${zoom})`,
            }"
          >
            <svg
              class="graph-edges"
              :width="layout.width"
              :height="layout.height"
              :aria-label="tr('Connections on the canvas')"
            >
              <defs>
                <marker
                  :id="marker"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L7 3.5L0 7z" fill="context-stroke" />
                </marker>
              </defs>
              <g
                v-for="path in layout.paths"
                :key="path.edge.id"
                :class="{
                  context: path.edge.kind === 'context',
                  uncertain: path.edge.certainty === 'unconfirmed',
                  historical: !path.edge.current,
                  dimmed: focused && !focus.edges.has(path.edge.id),
                  highlighted: focused && focus.edges.has(path.edge.id),
                }"
              >
                <path
                  class="graph-line"
                  :d="path.d"
                  :marker-end="path.edge.kind === 'context' ? undefined : `url(#${marker})`"
                />
                <path
                  v-if="path.edge.kind !== 'context'"
                  class="graph-hit"
                  :d="path.d"
                  role="button"
                  tabindex="0"
                  :aria-label="edgeDescription(path.edge)"
                  :aria-pressed="selectedEdgeId === path.edge.id"
                  @mouseenter="hoveredEdge = path.edge.id"
                  @mouseleave="hoveredEdge = ''"
                  @focus="hoveredEdge = path.edge.id"
                  @blur="hoveredEdge = ''"
                  @click="emit('edge', path.edge)"
                  @keydown.enter.prevent="emit('edge', path.edge)"
                  @keydown.space.prevent="emit('edge', path.edge)"
                />
              </g>
            </svg>
            <button
              type="button"
              v-if="activePath && activePath.edge.kind !== 'context'"
              class="graph-edge-label"
              :style="{ left: activePath.x + 'px', top: activePath.y + 'px' }"
              @mouseenter="hoveredEdge = activePath.edge.id"
              @mouseleave="hoveredEdge = ''"
              @click="emit('edge', activePath.edge)"
            >
              {{ edgeLabel(activePath.edge) }}
              <Icon name="info" :size="12" />
            </button>
            <div
              v-for="position in layout.nodes"
              :key="position.node.id"
              class="graph-node"
              :class="{
                selected: position.node.id === selectedId,
                derived: position.node.origin === 'record',
                dimmed: focused && !focus.nodes.has(position.node.id),
                highlighted: focused && focus.nodes.has(position.node.id),
              }"
              :style="{ left: position.x + 'px', top: position.y + 'px' }"
              @mouseenter="hoveredNode = position.node.id"
              @mouseleave="hoveredNode = ''"
              @focusin="hoveredNode = position.node.id"
              @focusout="hoveredNode = ''"
            >
              <button
                type="button"
                class="graph-node-select"
                :aria-pressed="position.node.id === selectedId"
                :aria-label="`${tr(singularLabels[position.node.kind])} ${position.node.name} ${recordContext(position.node)}`"
                :title="tr('Explore connections for {0}', [position.node.name])"
                @click="emit('select', position.node.id)"
              />
              <div class="graph-node-main">
                <span>
                  <Icon :name="nodeIcon(position.node.kind)" :size="14" />
                  {{ tr(singularLabels[position.node.kind]) }}
                  <Icon v-if="position.node.visibility === 'admin'" name="lock" :size="12" />
                </span>
                <strong>
                  <RouterLink
                    v-if="explorationDestination(position.node)"
                    class="graph-profile-link"
                    :to="explorationDestination(position.node)!"
                    :title="tr('Open profile: {0}', [position.node.name])"
                  >
                    {{ position.node.name }}
                  </RouterLink>
                  <template v-else>{{ position.node.name }}</template>
                </strong>
                <small :title="recordContext(position.node)">
                  {{ recordContext(position.node) }}
                </small>
              </div>
              <button
                type="button"
                v-if="position.node.recordIds.length"
                class="graph-source-count"
                :aria-label="
                  tr('View {0} source records for {1}', [
                    position.node.recordIds.length,
                    position.node.name,
                  ])
                "
                @click="emit('sources', position.node.id)"
              >
                <Icon name="file" :size="11" />
                {{ tr('{0} sources', [position.node.recordIds.length]) }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <p v-if="canvas.nodes.length <= 1" class="graph-hint">
        {{ tr('No connections match these filters. Expand another type or include history.') }}
      </p>
    </template>
    <p v-if="!loading && !failed && !canvas.nodes.length" class="graph-hint">
      {{
        tr(
          canvas.associated.length
            ? 'No business relationships are recorded in this view. Explore the associated objects below.'
            : 'No connections match these filters. Expand another type or include history.',
        )
      }}
    </p>
    <details
      v-if="canvas.associated.length"
      class="graph-associations"
      :open="view.associationsOpen || !canvas.nodes.length"
      @toggle="view.associationsOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>
        {{ tr('{0} objects with source associations only', [canvas.associated.length]) }}
      </summary>
      <p class="graph-hint">
        {{
          tr(
            'These objects have records linked to this organization. This does not establish a reporting, employment or business relationship.',
          )
        }}
      </p>
      <div>
        <div v-for="node in canvas.associated" :key="node.id" class="graph-associated-node">
          <button
            type="button"
            class="graph-node-select"
            :aria-label="`${node.name} ${recordContext(node)}`"
            :title="tr('Explore connections for {0}', [node.name])"
            @click="emit('select', node.id)"
          />
          <Icon :name="nodeIcon(node.kind)" :size="15" />
          <span>
            <strong>
              <RouterLink
                v-if="explorationDestination(node)"
                class="graph-profile-link"
                :to="explorationDestination(node)!"
                :title="tr('Open profile: {0}', [node.name])"
              >
                {{ node.name }}
              </RouterLink>
              <template v-else>{{ node.name }}</template>
            </strong>
            <small>{{ recordContext(node) }}</small>
          </span>
          <Icon name="chevron" :size="14" />
        </div>
      </div>
    </details>
    <p class="graph-hint">
      {{
        tr(
          'Open a name to view its profile. Select the card to explore connections, or a line to read its evidence.',
        )
      }}
    </p>
    <div v-if="selection.total > selection.nodes.length" class="graph-overflow">
      <span>
        {{ tr('Showing {0} of {1} connected nodes.', [selection.nodes.length, selection.total]) }}
      </span>
      <button type="button" class="link" @click="limit += 24">
        {{ tr('Show more connections') }}
      </button>
    </div>
    <slot name="details" />
    <details
      v-if="businessEdges.length"
      class="graph-relationship-list"
      :open="view.relationshipsOpen"
      @toggle="view.relationshipsOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>{{ tr('{0} relationships on the canvas', [businessEdges.length]) }}</summary>
      <button
        type="button"
        v-for="edge in businessEdges"
        :key="edge.id"
        :class="{ active: edge.id === selectedEdgeId }"
        @click="emit('edge', edge)"
        @mouseenter="hoveredEdge = edge.id"
        @mouseleave="hoveredEdge = ''"
        @focus="hoveredEdge = edge.id"
        @blur="hoveredEdge = ''"
      >
        <span>
          {{ nodeName(edge.fromId) }}
          <Icon name="arrow" :size="13" />
          {{ nodeName(edge.toId) }}
          <small>{{ edgeLabel(edge) }}</small>
        </span>
        <span class="graph-certainty" :class="{ uncertain: edge.certainty === 'unconfirmed' }">
          {{
            edge.certainty === 'confirmed'
              ? tr('Confirmed relationship')
              : tr('Unconfirmed relationship')
          }}
          <small v-if="!edge.current">{{ tr('Outside validity period') }}</small>
        </span>
      </button>
    </details>
  </section>
</template>
<style scoped>
/* 全局 button 是主按钮样式;画布里的按钮默认无底色,再按类名设置。 */
:where(.exploration-canvas) button {
  background: transparent;
  color: inherit;
  border: 0;
  padding: 0;
  border-radius: 0;
}
.exploration-canvas input[type='checkbox'] {
  width: auto;
}
.graph-toolbar select {
  width: auto;
}
.exploration-canvas {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.graph-branches,
.graph-toolbar,
.graph-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
}
.graph-branches {
  border-bottom: 1px solid var(--line);
}
.graph-branches > span {
  color: var(--muted);
  font-size: 11px;
}
.graph-branches button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  font-size: 12px;
}
.graph-branches button.active {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.graph-branches b {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.graph-sources-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  margin-left: auto;
  color: var(--muted);
}
.graph-toolbar label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.graph-toolbar select {
  padding: 6px;
  font-size: 12px;
}
.graph-zoom {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: auto;
}
.graph-zoom button {
  padding: 5px 8px;
  background: var(--panel);
  border-radius: 4px;
  font-size: 11px;
}
.graph-legend {
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
  gap: 18px;
  padding-block: 8px;
}
.graph-legend span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.graph-legend i {
  width: 20px;
  border-top: 2px solid var(--muted);
}
.graph-legend .dashed {
  border-top-style: dashed;
  border-color: var(--amber);
}
.graph-legend .context {
  border-top-style: dotted;
  border-color: var(--line);
}
.graph-hint {
  font-size: 11px;
  color: var(--muted);
  margin: 0;
  padding: 7px 12px;
  line-height: 1.6;
}
.graph-message {
  min-height: 260px;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
}
.graph-viewport {
  overflow: auto;
  height: 590px;
  background-color: var(--panel);
  background-image: radial-gradient(
    color-mix(in srgb, var(--muted) 20%, transparent) 1px,
    transparent 1px
  );
  background-size: 18px 18px;
  border-top: 1px solid var(--line);
}
.expanded .graph-viewport {
  height: 85vh;
  min-height: 710px;
}
.graph-stage {
  position: relative;
  transform-origin: top left;
}
.graph-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.graph-line {
  fill: none;
  stroke: var(--muted);
  stroke-width: 1.7;
  stroke-linejoin: round;
}
.uncertain .graph-line {
  stroke: var(--amber);
  stroke-dasharray: 6 4;
}
.context .graph-line {
  stroke: var(--line);
  stroke-width: 1;
  stroke-dasharray: 2 5;
}
.historical .graph-line {
  opacity: 0.5;
}
.highlighted .graph-line {
  stroke-width: 3;
}
.graph-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
  cursor: pointer;
  pointer-events: stroke;
}
.graph-hit:focus-visible {
  outline: none;
  stroke: color-mix(in srgb, var(--accent) 20%, transparent);
}
.dimmed {
  opacity: 0.17;
}
.graph-node {
  position: absolute;
  width: 210px;
  height: 94px;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 2px 4px transparent;
}
.graph-node.selected,
.graph-node.highlighted {
  border-color: var(--accent);
}
.graph-node.selected {
  box-shadow: 0 0 0 1px var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
}
.graph-node.derived {
  border-left-width: 3px;
}
.graph-node-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}
.graph-node-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.graph-profile-link {
  position: relative;
  pointer-events: auto;
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  text-underline-offset: 3px;
}
.graph-profile-link:hover,
.graph-profile-link:focus-visible {
  text-decoration-color: currentColor;
}
.graph-profile-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.graph-node-main {
  pointer-events: none;
  width: 100%;
  text-align: left;
  padding: 8px 10px 0;
  display: block;
}
.graph-node-main > span {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 10px;
}
.graph-node-main strong {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  margin: 3px 0;
}
.graph-node-main small {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10px;
  color: var(--muted);
}
.graph-source-count {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 5px 10px 0;
  padding: 0;
  font-size: 10px;
  color: var(--accent);
}
.graph-edge-label {
  position: absolute;
  transform: translate(-50%, -50%);
  background: var(--bg);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  padding: 4px 7px;
  z-index: 2;
}
.graph-overflow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  font-size: 12px;
}
.graph-relationship-list {
  border-top: 1px solid var(--line);
}
.graph-associations {
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.graph-associations summary {
  padding: 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
}
.graph-associations > div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
  padding: 12px;
}
.graph-associated-node {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  text-align: left;
  min-width: 0;
}
.graph-associated-node > span {
  pointer-events: none;
  flex: 1;
  min-width: 0;
}
.graph-associated-node > svg {
  pointer-events: none;
}
.graph-associations strong,
.graph-associations small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-associations strong {
  font-size: 12px;
}
.graph-associations small {
  font-size: 10px;
  color: var(--muted);
  margin-top: 5px;
}
.graph-relationship-list summary {
  padding: 12px;
  font-size: 12px;
  cursor: pointer;
  color: var(--accent);
}
.graph-relationship-list > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  font-size: 12px;
}
.graph-relationship-list > button.active {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
}
.graph-relationship-list small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 5px;
}
.graph-certainty {
  --tone: var(--joined);
  border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
  border-radius: 4px;
  padding: 4px 7px;
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 8%, var(--bg));
  font-size: 10px;
  flex-shrink: 0;
}
.graph-certainty.uncertain {
  --tone: var(--amber);
}
@media (max-width: 700px) {
  .graph-zoom {
    margin-left: 0;
  }
  .graph-sources-toggle {
    margin-left: 0;
  }
  .graph-relationship-list > button {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
}
</style>
