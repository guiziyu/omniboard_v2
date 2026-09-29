<script setup lang="ts">
// 关系与证据页(frontend-spec 7.1–7.3、7.9–7.11、7.13),从 v1 KnowledgePanel.vue 迁移。
import { computed, nextTick, reactive, ref, toRefs, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import { openEvidence } from '../evidence';
import { taskText } from '../task-text';
import { taskStates } from '../../shared/operations';
import { profileLink as explorationDestination } from '../exploration-links';
import { useExplorationView } from '../exploration-view';
import type { ObjectKind, KnowledgeClaim } from '../../shared/operations';
import { explorationModel } from '../../shared/exploration-model';
import type { ExplorationGraph, ExplorationEdge } from '../../shared/exploration';
import type { ModuleRecord } from '../../shared/types';
import { knowledgeFields } from '../../shared/knowledge';
import { tabs } from '../../shared/registry';
import { reviewPresentation, fieldValueLabel } from '../presentation';
import AppDialog from './AppDialog.vue';
import EvidenceReview from './EvidenceReview.vue';
import Icon from './Icon.vue';
import IdentityConnections from './IdentityConnections.vue';
import RelationshipGraph from './RelationshipGraph.vue';
const props = defineProps<{ organizationId: string }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const today = () => new Date().toISOString().slice(0, 10);
const route = useRoute();
const router = useRouter();
const graph = ref<ExplorationGraph>();
const error = ref('');
const busy = ref(false);
const { view, restorePage } = useExplorationView(
  props.organizationId,
  String(route.query.object || 'organization:' + props.organizationId),
);
const { search, kind, browserOpen, selectedId, sourceLimit, historical } = toRefs(view);
const mode = ref<'map' | 'evidence' | 'sources'>(
  ['map', 'evidence', 'sources'].includes(String(route.query.knowledgeView))
    ? (route.query.knowledgeView as 'map' | 'evidence' | 'sources')
    : 'map',
);
const selectedEdge = ref<ExplorationEdge>();
const dialog = ref<'' | 'object' | 'claim' | 'relation' | 'accept'>('');
const formError = ref('');
const objectForm = reactive({
  kind: 'capability' as ObjectKind,
  name: '',
  scope: '',
  visibility: 'team' as 'team' | 'admin',
  sourceRecordId: '',
});
const reference = reactive({ rawText: '', sourceUrl: '', sourceRecordId: '' });
const claimPresets = [
  'API permission',
  'Regional eligibility',
  'Subscription interval',
  'Trading fee',
  'Borrow rate',
  'Hosting region',
  'Account approval',
];
const claimPreset = ref('API permission');
const claimForm = reactive({
  field: '',
  value: '',
  scope: '',
  observedOn: '',
  validFrom: '',
  validUntil: '',
});
const relationForm = reactive({
  toId: '',
  label: '',
  certainty: 'unconfirmed' as 'confirmed' | 'unconfirmed',
  validFrom: '',
  validUntil: '',
});
const acceptClaim = ref<KnowledgeClaim>();
const reason = ref('');
const objectKinds: Record<ObjectKind, string> = {
  person: 'Person',
  account: 'Account',
  capability: 'Provider capability',
  resource: 'Our resource / approval',
};
let serial = 0;
const handledSource = ref(false);
async function load() {
  const request = ++serial;
  error.value = '';
  try {
    const data = await api<ExplorationGraph>(
      `/api/organizations/${props.organizationId}/exploration`,
    );
    if (request !== serial) return;
    graph.value = data;
    selectedId.value = data.identityAliases?.[selectedId.value] || selectedId.value;
    // `record:<id>` 指向已被共享对象承接的记录时,选中那个对象(人员变动的「探索此人身份」)。
    if (selectedId.value.startsWith('record:')) {
      const recordId = selectedId.value.slice('record:'.length);
      const owner = data.objects.find((o) => o.records.some((r) => r.id === recordId));
      if (owner) selectedId.value = owner.id;
    }
    if (!explorationModel(data).nodes.some((o) => o.id === selectedId.value))
      selectedId.value = 'organization:' + props.organizationId;
    selectedEdge.value = explorationModel(data).edges.find(
      (edge) => edge.id === view.selectedEdgeId,
    );
    if (mode.value !== 'map') {
      await nextTick();
      restorePage();
    }
    const source = data.contextRecords.find((r) => r.id === route.query.sourceRecord);
    if (source && !handledSource.value) {
      handledSource.value = true;
      const existing = data.objects.find((o) => o.records.some((r) => r.id === source.id));
      if (existing) selectedId.value = existing.id;
      else propose(source);
    }
  } catch (e) {
    if (request === serial) error.value = errorText(e);
  }
}
watch(
  () => props.organizationId,
  () => {
    graph.value = undefined;
    selectedEdge.value = undefined;
    handledSource.value = false;
    dialog.value = '';
    void load();
  },
  { immediate: true },
);
const selected = computed(() => graph.value?.objects.find((o) => o.id === selectedId.value));
const model = computed(() => (graph.value ? explorationModel(graph.value) : undefined));
const selectedNode = computed(() => model.value?.nodes.find((n) => n.id === selectedId.value));
const nodeKinds = { ...objectKinds, organization: 'Organization', record: 'Source record' };
const objects = computed(() =>
  (model.value?.nodes || []).filter(
    (o) =>
      (!kind.value || o.kind === kind.value) &&
      [o.name, o.scope, o.recordContext?.title, tr(nodeKinds[o.kind])]
        .join(' ')
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
const selectedRecords = computed(
  () =>
    graph.value?.contextRecords.filter(
      (r) =>
        (selectedNode.value?.origin === 'organization' &&
          r.organizationId === selectedId.value.slice('organization:'.length)) ||
        selectedNode.value?.recordIds.includes(r.id),
    ) || [],
);
const claims = computed(
  () =>
    graph.value?.claims.filter((c) =>
      selectedNode.value?.origin === 'organization'
        ? c.organizationId === selectedId.value.slice('organization:'.length)
        : c.objectId === selectedId.value,
    ) || [],
);
const conflicts = computed(() => claims.value.filter((c) => c.conflict).length);
// 「Work linked to this evidence」(7.9):关联了该对象,或以该节点的来源记录为来源的任务。
const relatedTasks = computed(
  () =>
    graph.value?.tasks.filter(
      (t) =>
        t.objectIds.includes(selectedId.value) ||
        selectedNode.value?.recordIds.includes(t.sourceRecordId),
    ) || [],
);
/** 以该记录为来源新建任务(10.6 的 sourceRecord 预填);机构取记录所在的机构。 */
const follow = (id: string) =>
  void router.push({
    path: '/w/internal/work',
    query: {
      organizationId:
        graph.value?.contextRecords.find((r) => r.id === id)?.organizationId ||
        props.organizationId,
      sourceRecord: id,
    },
  });
function selectNode(id: string) {
  selectedId.value = id;
  selectedEdge.value = undefined;
  sourceLimit.value = 8;
}
watch(selectedEdge, (edge) => {
  view.selectedEdgeId = edge?.id || '';
});
watch([selectedId, mode], ([object, knowledgeView]) => {
  if (
    graph.value &&
    route.path.endsWith('/relationships') &&
    (route.query.object !== object || route.query.knowledgeView !== knowledgeView)
  )
    void router.replace({ query: { ...route.query, object, knowledgeView } });
});
watch(
  () => [route.query.object, route.query.knowledgeView],
  ([value, nextMode]) => {
    if (!route.path.endsWith('/relationships')) return;
    if (value && model.value?.nodes.some((n) => n.id === value)) selectedId.value = String(value);
    if (nextMode === 'map' || nextMode === 'evidence' || nextMode === 'sources')
      mode.value = nextMode;
  },
);
const recordFacts = (record: ModuleRecord) =>
  (knowledgeFields[record.tabId] || [])
    .filter(
      (f) =>
        record.structured[f.id] &&
        ![
          'verification',
          'evidenceLevel',
          'sourceKind',
          'sourceRef',
          'reviewedOn',
          'expiresOn',
          'owner',
          'sensitivity',
        ].includes(f.id),
    )
    .slice(0, 6);
const sourceTab = (tabId: string) => tr(tabs.find((t) => t.id === tabId)?.title || tabId);
const recordOrganization = (record: ModuleRecord) =>
  record.organizationId === graph.value?.organization.id
    ? graph.value.organization.name
    : graph.value?.objects
        .flatMap((o) => o.organizations || [])
        .find((o) => o.id === record.organizationId)?.name || '';
const candidates = computed(() =>
  (graph.value?.contextRecords || []).filter(
    (r) =>
      (dialog.value !== 'object' || r.organizationId === props.organizationId) &&
      ((dialog.value === 'object' ? objectForm.visibility : selected.value?.visibility) ===
        'admin' ||
        r.visibility === 'team'),
  ),
);
const dialogTitle = computed(() =>
  tr(
    (
      {
        object: 'Add a shared object',
        claim: 'Record a sourced fact',
        relation: 'Connect two objects',
        accept: 'Review the current interpretation',
      } as Record<string, string>
    )[dialog.value] || '',
  ),
);
function newDialog(type: typeof dialog.value) {
  dialog.value = type;
  formError.value = '';
  Object.assign(reference, { rawText: '', sourceUrl: '', sourceRecordId: '' });
  claimPreset.value = claimPresets[0]!;
  Object.assign(claimForm, {
    field: claimPresets[0],
    value: '',
    scope: selected.value?.scope || '',
    observedOn: '',
    validFrom: '',
    validUntil: '',
  });
  Object.assign(relationForm, {
    toId: '',
    label: '',
    certainty: 'unconfirmed',
    validFrom: '',
    validUntil: '',
  });
  if (type === 'object')
    Object.assign(objectForm, {
      kind: 'capability',
      name: '',
      scope: '',
      visibility: 'team',
      sourceRecordId: '',
    });
}
async function save() {
  busy.value = true;
  formError.value = '';
  try {
    const post = <T,>(path: string, body: object) => api<T>(path, { method: 'POST', body });
    if (dialog.value === 'object') {
      const result = await post<{ id: string }>(
        `/api/organizations/${props.organizationId}/knowledge/objects`,
        objectForm,
      );
      selectedId.value = result.id;
    } else if (dialog.value === 'claim')
      await post(`/api/knowledge/objects/${selectedId.value}/claims`, {
        ...claimForm,
        ...reference,
        organizationId: props.organizationId,
      });
    else if (dialog.value === 'relation')
      await post('/api/knowledge/relations', {
        fromId: selectedId.value,
        ...relationForm,
        ...reference,
      });
    else if (dialog.value === 'accept' && acceptClaim.value)
      await post(`/api/knowledge/claims/${acceptClaim.value.id}/accept`, {
        revision: acceptClaim.value.revision,
        reason: reason.value,
      });
    dialog.value = '';
    await load();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function propose(record: {
  id: string;
  title: string;
  tabId: string;
  visibility?: 'team' | 'admin';
  personName?: string;
  scope?: string;
}) {
  newDialog('object');
  objectForm.sourceRecordId = record.id;
  objectForm.visibility = record.visibility || 'team';
  objectForm.name = (record.personName || record.title).slice(0, 160);
  objectForm.scope = record.scope || '';
  objectForm.kind = !!record.personName
    ? 'person'
    : record.tabId === 'onboarding'
      ? 'resource'
      : 'capability';
}
function review(claim: KnowledgeClaim) {
  newDialog('accept');
  acceptClaim.value = claim;
  reason.value = '';
}
function openRecord(id: string, tabId: string) {
  void router.push({
    path: `/w/internal/organizations/${graph.value?.contextRecords.find((r) => r.id === id)?.organizationId || props.organizationId}/${tabId}`,
    query: { record: id },
  });
}
</script>
<template>
  <section class="knowledge-workbench">
    <div class="work-heading">
      <div>
        <h2>{{ tr('Relationships & evidence') }}</h2>
      </div>
      <div class="work-actions">
        <button
          type="button"
          class="ghost"
          :aria-expanded="browserOpen"
          @click="browserOpen = !browserOpen"
        >
          <Icon name="search" :size="15" />
          {{ browserOpen ? tr('Hide object browser') : tr('Find an object') }}
        </button>
        <button type="button" class="link" @click="load">{{ tr('Refresh') }}</button>
        <button v-if="canEdit" type="button" @click="newDialog('object')">
          <Icon name="plus" :size="15" />
          {{ tr('Add shared object') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error" role="alert">
      {{ tr(error) }}
      <button type="button" @click="load">{{ tr('Retry') }}</button>
    </p>
    <p v-if="!graph && !error" class="hint" role="status">{{ tr('Loading relationships…') }}</p>
    <template v-if="graph && model">
      <div
        class="knowledge-layout exploration-layout"
        :class="{ 'browser-collapsed': !browserOpen }"
      >
        <aside v-if="browserOpen" class="object-list exploration-list">
          <label>
            {{ tr('Search the graph') }}
            <input v-model="search" :placeholder="tr('Name, type or scope')" />
          </label>
          <label>
            {{ tr('Object type') }}
            <select v-model="kind">
              <option value="">{{ tr('All types') }}</option>
              <option v-for="(label, id) in nodeKinds" :key="id" :value="id">
                {{ tr(label) }}
              </option>
            </select>
          </label>
          <span class="hint">{{ tr('{0} results', [objects.length]) }}</span>
          <div class="exploration-results">
            <button
              type="button"
              v-for="o in objects"
              :key="o.id"
              :class="{ active: o.id === selectedId }"
              @click="selectNode(o.id)"
            >
              <small>
                {{ tr(nodeKinds[o.kind]) }}
                <Icon v-if="o.visibility === 'admin'" name="lock" :size="11" />
              </small>
              <strong>{{ o.name }}</strong>
              <span>
                {{
                  o.origin === 'record'
                    ? tr('From existing record')
                    : o.origin === 'object'
                      ? tr('Shared object')
                      : tr('Organization context')
                }}
              </span>
              <span v-if="o.recordContext" :title="o.recordContext.title">
                {{
                  tr(tabs.find((t) => t.id === o.recordContext?.tabId)?.title || 'Source record')
                }}
                · {{ o.recordContext.title }}
              </span>
            </button>
          </div>
          <p class="hint">
            {{
              tr(
                'Records with matching names remain separate until the team links them to the same object.',
              )
            }}
          </p>
        </aside>
        <div v-if="selectedNode" class="object-main">
          <div v-if="mode !== 'map' || selectedId !== model.rootId" class="work-heading">
            <div>
              <span class="eyebrow">{{ tr(nodeKinds[selectedNode.kind]) }}</span>
              <h3>
                <RouterLink
                  v-if="explorationDestination(selectedNode)"
                  class="exploration-profile-link"
                  :to="explorationDestination(selectedNode)!"
                >
                  {{ selectedNode.name }}
                </RouterLink>
                <template v-else>{{ selectedNode.name }}</template>
              </h3>
              <p class="hint">
                {{
                  selectedNode.origin === 'organization'
                    ? tr('Organization context')
                    : (selected?.organizations?.length || 0) > 1
                      ? tr('Shared across {0} organizations', [selected!.organizations!.length])
                      : selectedNode.scope
                }}
              </p>
            </div>
            <div class="work-actions" v-if="canEdit">
              <template v-if="selected">
                <button type="button" class="ghost" @click="newDialog('relation')">
                  {{ tr('Connect object') }}
                </button>
                <button type="button" class="ghost" @click="newDialog('claim')">
                  {{ tr('Add evidence') }}
                </button>
              </template>
              <button
                type="button"
                v-else-if="selectedNode.origin === 'record' && selectedRecords[0]"
                class="ghost"
                @click="propose(selectedRecords[0])"
              >
                {{ tr('Track as shared object') }}
              </button>
            </div>
          </div>
          <p v-if="selectedNode.origin === 'record'" class="exploration-context-note">
            <Icon name="file" :size="15" />
            {{
              tr(
                'Shown from an existing source record. Identity, access and claims have not been automatically verified.',
              )
            }}
          </p>
          <IdentityConnections
            v-if="selected"
            :object="selected"
            @changed="
              async (id) => {
                selectedId = id;
                await load();
              }
            "
          />
          <div v-if="mode !== 'map'" class="exploration-summary">
            <span>
              <b>{{ graph.contextRecords.length }}</b>
              {{ tr('Source records') }}
            </span>
            <span>
              <b>{{ graph.objects.length }}</b>
              {{ tr('Shared objects') }}
            </span>
            <span>
              <b>{{ model.edges.filter((e) => e.kind !== 'context').length }}</b>
              {{ tr('Recorded relationships') }}
            </span>
            <button
              type="button"
              @click="
                selectNode(model.rootId);
                mode = 'evidence';
              "
            >
              <b>{{ graph.claims.length ? graph.claims.filter((c) => c.conflict).length : '—' }}</b>
              {{ tr(graph.claims.length ? 'Conflicting statements' : 'Not assessed') }}
              <small>{{ tr('{0} structured statements', [graph.claims.length]) }}</small>
            </button>
          </div>
          <div class="work-viewbar">
            <RouterLink
              v-if="
                selectedNode.origin === 'organization' &&
                selectedId !== 'organization:' + organizationId
              "
              :to="`/w/internal/organizations/${selectedId.slice('organization:'.length)}/relationships`"
              class="link"
            >
              {{ tr('Open organization') }}
            </RouterLink>
            <div class="segmented">
              <button
                type="button"
                :class="{ active: mode === 'map' }"
                :aria-pressed="mode === 'map'"
                @click="mode = 'map'"
              >
                {{ tr('Relationship graph') }}
              </button>
              <button
                type="button"
                :class="{ active: mode === 'evidence' }"
                :aria-pressed="mode === 'evidence'"
                @click="mode = 'evidence'"
              >
                {{ tr('Compare evidence') }}
                <span v-if="conflicts" class="count">{{ conflicts }}</span>
              </button>
              <button
                type="button"
                :class="{ active: mode === 'sources' }"
                :aria-pressed="mode === 'sources'"
                @click="mode = 'sources'"
              >
                {{ tr('Source records') }}
                <span class="count">{{ selectedRecords.length }}</span>
              </button>
            </div>
            <label class="check-row">
              <input v-model="historical" type="checkbox" />
              {{ tr('Include history') }}
            </label>
          </div>
          <RelationshipGraph
            v-if="mode === 'map'"
            :view="view.graph"
            @ready="restorePage"
            :nodes="model.nodes"
            :edges="model.edges"
            :selected-id="selectedId"
            :selected-edge-id="selectedEdge?.id"
            :historical="historical"
            @select="selectNode"
            @edge="selectedEdge = $event"
            @sources="
              (id) => {
                selectNode(id);
                mode = 'sources';
              }
            "
          >
            <template #details>
              <section
                v-if="mode === 'map' && selectedEdge"
                class="edge-inspector"
                :aria-label="tr('Relationship details')"
              >
                <div class="work-heading">
                  <strong>
                    {{ model.nodes.find((n) => n.id === selectedEdge!.fromId)?.name }} →
                    {{ model.nodes.find((n) => n.id === selectedEdge!.toId)?.name }}
                  </strong>
                  <button
                    type="button"
                    class="ghost"
                    :aria-label="tr('Close relationship details')"
                    @click="selectedEdge = undefined"
                  >
                    <Icon name="close" :size="15" />
                  </button>
                </div>
                <p>
                  {{
                    selectedEdge.kind === 'relationship'
                      ? selectedEdge.label
                      : tr(selectedEdge.label)
                  }}
                  ·
                  <span :class="{ 'evidence-uncertain': selectedEdge.certainty === 'unconfirmed' }">
                    {{
                      selectedEdge.certainty === 'confirmed'
                        ? tr('Confirmed relationship')
                        : tr('Unconfirmed relationship')
                    }}
                  </span>
                </p>
                <p class="hint">
                  {{ tr('Valid from') }}: {{ selectedEdge.validFrom || tr('Not recorded') }} ·
                  {{ tr('Valid until') }}: {{ selectedEdge.validUntil || tr('Not recorded') }}
                </p>
                <p v-if="!selectedEdge.current" class="evidence-uncertain">
                  {{ tr('Outside validity period') }}
                </p>
                <button
                  v-if="selectedEdge.evidenceId"
                  type="button"
                  class="link"
                  @click="openEvidence(selectedEdge.evidenceId)"
                >
                  {{ tr('Read relationship evidence') }}
                </button>
              </section>
            </template>
          </RelationshipGraph>
          <EvidenceReview
            v-if="mode === 'evidence'"
            :object-names="Object.fromEntries(graph.objects.map((o) => [o.id, o.name]))"
            :claims="claims"
            :decisions="graph.decisions"
            :references="graph.references"
            :historical="historical"
            :today="today()"
            @review="review"
            @follow="follow"
          />
          <section v-if="mode === 'sources' || mode === 'evidence'" class="exploration-sources">
            <div class="work-heading">
              <h3>{{ tr('Source records') }}</h3>
            </div>
            <p v-if="!selectedRecords.length" class="hint">
              {{ tr('No source record is linked to this object.') }}
            </p>
            <details
              v-for="record in selectedRecords.slice(0, sourceLimit)"
              :key="record.id"
              class="exploration-source"
            >
              <summary>
                <span>
                  <small>
                    {{ recordOrganization(record) }} · {{ sourceTab(record.tabId) }} ·
                    {{ sourceName(graph.references[record.evidenceId]?.source || '') }}
                  </small>
                  <strong>{{ record.title }}</strong>
                </span>
                <span class="hint">{{ reviewPresentation(record.status).label }}</span>
              </summary>
              <div class="exploration-source-detail">
                <p class="preserve-lines">{{ record.body }}</p>
                <dl>
                  <div v-for="field in recordFacts(record)" :key="field.id">
                    <dt>{{ tr(field.label) }}</dt>
                    <dd>{{ fieldValueLabel(field, record.structured[field.id]) }}</dd>
                  </div>
                </dl>
                <p class="hint">
                  {{ record.scope }} · {{ record.author }} · {{ dateTime(record.updatedAt) }}
                </p>
                <div class="work-actions">
                  <button type="button" class="link" @click="openEvidence(record.evidenceId)">
                    {{ tr('Original source') }}
                  </button>
                  <button type="button" class="link" @click="openRecord(record.id, record.tabId)">
                    {{ tr('Open source record') }}
                  </button>
                  <button v-if="canEdit" type="button" class="link" @click="follow(record.id)">
                    {{ tr('Create follow-up task') }}
                  </button>
                </div>
              </div>
            </details>
            <button
              type="button"
              v-if="selectedRecords.length > sourceLimit"
              class="link"
              @click="sourceLimit += 8"
            >
              {{ tr('Show more source records') }}
            </button>
          </section>
          <section v-if="relatedTasks.length" class="exploration-tasks">
            <h3>{{ tr('Work linked to this evidence') }}</h3>
            <RouterLink
              v-for="task in relatedTasks"
              :key="task.id"
              :to="{
                path: '/w/internal/work',
                query: { organizationId: task.organizationId, task: task.id },
              }"
            >
              <span>{{ taskText(task) }}</span>
              <small>{{ tr(taskStates[task.displayState]) }}</small>
            </RouterLink>
          </section>
        </div>
      </div>
    </template>
    <AppDialog v-if="dialog" :title="dialogTitle" :busy="busy" wide @close="dialog = ''">
      <form @submit.prevent="save">
        <div>
          <template v-if="dialog === 'object'">
            <label>
              {{ tr('Object type') }}
              <select v-model="objectForm.kind">
                <option v-for="(label, key) in objectKinds" :key="key" :value="key">
                  {{ tr(label) }}
                </option>
              </select>
            </label>
            <label>
              {{ tr('Name') }}
              <input v-model="objectForm.name" required maxlength="160" />
            </label>
            <label>
              {{ tr('Scope') }}
              <input
                v-model="objectForm.scope"
                required
                :placeholder="tr('Product, legal entity, account or role')"
              />
            </label>
            <label>
              {{ tr('Access') }}
              <select v-model="objectForm.visibility">
                <option value="team">{{ tr('Internal team') }}</option>
                <option v-if="session.user?.role === 'admin'" value="admin">
                  {{ tr('Administrators only') }}
                </option>
              </select>
            </label>
            <label>
              {{ tr('Existing source record') }}
              <select v-model="objectForm.sourceRecordId" required>
                <option value="" disabled>{{ tr('Select a record') }}</option>
                <option v-for="r in candidates" :key="r.id" :value="r.id">
                  {{ recordOrganization(r) }} · {{ r.title }}
                </option>
              </select>
            </label>
            <p class="hint">
              {{
                tr(
                  'Use one object for the same person, account or capability across tabs. Link additional records after creation.',
                )
              }}
            </p>
          </template>
          <template v-else-if="dialog === 'accept'">
            <p>
              <strong>{{ tr(acceptClaim?.field || '') }}</strong>
              · {{ acceptClaim?.scope }}
            </p>
            <blockquote>{{ acceptClaim?.value }}</blockquote>
            <p>
              {{
                tr(
                  'Adopt this value for its current scope. Other currently valid claims for this same field and scope will remain in history as previous interpretations.',
                )
              }}
            </p>
            <button type="button" class="link" @click="openEvidence(acceptClaim!.evidenceId)">
              {{ tr('Read original reference') }}
            </button>
            <label>
              {{ tr('Reason for this decision') }}
              <textarea
                v-model="reason"
                required
                rows="4"
                :placeholder="tr('Why does this source apply to our scope?')"
              />
            </label>
          </template>
          <template v-else>
            <template v-if="dialog === 'claim'">
              <label>
                {{ tr('Fact type') }}
                <select
                  v-model="claimPreset"
                  @change="claimForm.field = claimPreset === 'custom' ? '' : claimPreset"
                >
                  <option v-for="field in claimPresets" :key="field" :value="field">
                    {{ tr(field) }}
                  </option>
                  <option value="custom">{{ tr('Custom field') }}</option>
                </select>
              </label>
              <label v-if="claimPreset === 'custom'">
                {{ tr('Field') }}
                <input
                  v-model="claimForm.field"
                  required
                  maxlength="100"
                  :placeholder="tr('For example: API permission')"
                />
              </label>
              <label>
                {{ tr('Value') }}
                <input
                  v-model="claimForm.value"
                  required
                  :placeholder="tr('A specific value or short factual statement')"
                />
              </label>
              <label>
                {{ tr('Exact scope') }}
                <input v-model="claimForm.scope" required />
              </label>
              <div class="form-grid">
                <label>
                  {{ tr('Observed on') }}
                  <input v-model="claimForm.observedOn" type="date" />
                </label>
                <label>
                  {{ tr('Valid from') }}
                  <input v-model="claimForm.validFrom" type="date" />
                </label>
                <label>
                  {{ tr('Valid until') }}
                  <input v-model="claimForm.validUntil" type="date" />
                </label>
              </div>
              <p class="hint">
                {{ tr('Leave unknown dates empty. The recording time is saved separately.') }}
              </p>
            </template>
            <template v-else>
              <label>
                {{ tr('From') }}
                <input :value="selected?.name" disabled />
              </label>
              <label>
                {{ tr('To') }}
                <select v-model="relationForm.toId" required>
                  <option value="" disabled>{{ tr('Select an object') }}</option>
                  <option
                    v-for="o in graph?.objects.filter(
                      (o) => o.id !== selectedId && o.visibility === selected?.visibility,
                    )"
                    :key="o.id"
                    :value="o.id"
                  >
                    {{ o.name }} · {{ tr(objectKinds[o.kind]) }}
                  </option>
                </select>
              </label>
              <label>
                {{ tr('Relationship') }}
                <input
                  v-model="relationForm.label"
                  required
                  :placeholder="tr('reports to / manages / grants access to')"
                />
              </label>
              <label>
                {{ tr('Certainty') }}
                <select v-model="relationForm.certainty">
                  <option value="unconfirmed">{{ tr('Reported · needs confirmation') }}</option>
                  <option value="confirmed">{{ tr('Confirmed by the cited evidence') }}</option>
                </select>
              </label>
              <div class="form-grid">
                <label>
                  {{ tr('Valid from') }}
                  <input v-model="relationForm.validFrom" type="date" />
                </label>
                <label>
                  {{ tr('Valid until') }}
                  <input v-model="relationForm.validUntil" type="date" />
                </label>
              </div>
            </template>
            <label>
              {{ tr('Existing reference') }}
              <select v-model="reference.sourceRecordId">
                <option value="">{{ tr('Use original text below') }}</option>
                <option v-for="r in candidates" :key="r.id" :value="r.id">
                  {{ recordOrganization(r) }} · {{ r.title }}
                </option>
              </select>
            </label>
            <label>
              {{ tr('Original information') }}
              <textarea
                v-model="reference.rawText"
                rows="4"
                :required="!reference.sourceRecordId"
                :placeholder="
                  tr(
                    'Paste the original information. Do not replace it with an unsupported summary.',
                  )
                "
              />
            </label>
            <label>
              {{ tr('Source URL') }}
              <input v-model="reference.sourceUrl" type="url" />
            </label>
          </template>
          <p v-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
        </div>
        <div class="actions">
          <button type="button" class="ghost" :disabled="busy" @click="dialog = ''">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="busy">
            {{
              busy
                ? tr('Saving…')
                : dialog === 'accept'
                  ? tr('Adopt with decision record')
                  : tr('Save')
            }}
          </button>
        </div>
      </form>
    </AppDialog>
  </section>
</template>

<style scoped>
.exploration-profile-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  text-underline-offset: 3px;
}
.exploration-profile-link:hover,
.exploration-profile-link:focus-visible {
  text-decoration-color: currentColor;
}
</style>
