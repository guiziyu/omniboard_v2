<script setup lang="ts">
// 一个模块 tab 的内容(frontend-spec 4.3、4.4、5.1、5.2、5.4),从 v1 ModuleView.vue 迁移。
// 尚未迁移的专用面板(registry.ts pendingModules)显示「正在迁移」。
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api, atLeast, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import {
  contactGroup,
  hasRecordedValue,
  isNarrativeIntelligence,
  recordBusinessState,
  reviewDue,
  summaryFields as decisionFields,
} from '../../shared/record-summary';
import { contactHref, knowledgeFields } from '../../shared/knowledge';
import { pendingModules } from '../../shared/registry';
import { groupContacts } from '../../shared/contact-groups';
import type { KnowledgeObject } from '../../shared/operations';
import type { ModuleData, ModuleRecord, Organization, TabDefinition } from '../../shared/types';
import {
  evidencePresentation,
  fieldHint,
  fieldOptionLabel,
  fieldValueLabel,
  readableNote,
  readableTitle,
  reviewPresentation,
} from '../presentation';
import AppDialog from './AppDialog.vue';
import DiscussionPanel from './DiscussionPanel.vue';
import Icon from './Icon.vue';
import KnowledgePanel from './KnowledgePanel.vue';
import OrgChart from './OrgChart.vue';
import OrganizationOverview from './OrganizationOverview.vue';
import PeopleMovements from './PeopleMovements.vue';
import RecordEditor from './RecordEditor.vue';
import RecordHistory from './RecordHistory.vue';
const props = defineProps<{ organization: Organization; data: ModuleData; tab: TabDefinition }>();
const emit = defineEmits<{ refresh: [] }>();
const route = useRoute();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const pending = computed(() => pendingModules.includes(props.tab.id));
const records = computed(() => props.data.records ?? []);
const today = () => new Date().toISOString().slice(0, 10);

// ---- 编辑与历史 ----
const editing = ref<ModuleRecord>();
const showEditor = ref(false);
const historyFor = ref<string>();
function edit(record?: ModuleRecord) {
  editing.value = record;
  showEditor.value = true;
}

// ---- 关联的共享对象(5.2 第 9 项):列表加载后单独请求,失败时静默忽略 ----
const sharedObjects = ref<KnowledgeObject[]>([]);
let objectRequest = 0;
watch(
  () => [props.organization.id, props.data],
  async () => {
    const request = ++objectRequest;
    sharedObjects.value = [];
    if (!records.value.length || props.tab.id === 'relationships') return;
    try {
      const data = await api<{ objects: KnowledgeObject[] }>(
        `/api/organizations/${props.organization.id}/objects`,
      );
      if (request === objectRequest) sharedObjects.value = data.objects;
    } catch {
      // 关联对象加载不到时,原记录照常显示。
    }
  },
  { immediate: true },
);
const objectsFor = (recordId: string) =>
  sharedObjects.value.filter((o) => o.records.some((r) => r.id === recordId));
const relationshipsPath = computed(
  () => `/w/internal/organizations/${props.organization.id}/relationships`,
);

// ---- 联系人(5.1、5.3):分组筛选;明确关联到同一 person 对象的记录合并成一张卡片 ----
const contactFilter = ref('');
const isContacts = computed(() => props.tab.id === 'contacts');
const contactGroups = ['', 'People', 'Team channels', 'Official channels'] as const;
const displayed = computed(() =>
  isContacts.value && contactFilter.value
    ? records.value.filter((r) => contactGroup(r) === contactFilter.value)
    : records.value,
);
const contactCards = computed(() => groupContacts(records.value, sharedObjects.value));
const cards = computed(() =>
  isContacts.value
    ? groupContacts(displayed.value, sharedObjects.value)
    : displayed.value.map((record) => ({ id: record.id, records: [record] })),
);
const merged = (card: { records: ModuleRecord[] }) => isContacts.value && card.records.length > 1;
// 联系人对话记录(5.9):列出关联到该联系人的讨论。
const contactHistory = ref<ModuleRecord>();
const copyStatus = ref('');
async function copyContact(record: ModuleRecord) {
  try {
    await navigator.clipboard.writeText(record.structured.value || record.personEmail);
    copyStatus.value = tr('Copied');
  } catch {
    copyStatus.value = tr('Could not copy. Select the address to copy it manually.');
  }
}

// ---- 折叠行(5.1) ----
const listSummaryFields: Record<string, string[]> = {
  services: ['coverage', 'delivery'],
  market_access: ['coverage', 'delivery'],
  payments: ['coverage', 'delivery'],
  custody: ['coverage', 'delivery'],
  data_coverage: ['coverage', 'delivery'],
  infrastructure: ['coverage', 'delivery'],
  api_optimization: ['mechanism', 'product', 'accountModel', 'entitlement'],
  capital_optimization: ['mechanism', 'product', 'vipTier', 'holdingMethod'],
  tech_stack: ['layer', 'cloud', 'region', 'instanceType'],
  compliance: ['decision', 'jurisdiction', 'legalEntity', 'product'],
  onboarding: ['integrationStage', 'resourceType', 'resourceStage', 'product'],
  contacts: ['channel', 'role', 'relationship'],
};
const hiddenInGrid = [
  'evidenceLevel',
  'sensitivity',
  'owner',
  'reviewedOn',
  'value',
  'verification',
];
function fieldsFor(record: ModuleRecord, summary: boolean) {
  const keys = listSummaryFields[props.tab.id] ?? [];
  return (knowledgeFields[props.tab.id] ?? []).filter(
    (field) =>
      hasRecordedValue(record.structured[field.id]) &&
      (summary ? keys.includes(field.id) : !hiddenInGrid.includes(field.id)),
  );
}
const fieldValue = (record: ModuleRecord, field: { id: string; type?: string }) =>
  fieldValueLabel(field, record.structured[field.id]);
function sourceBadge(record: ModuleRecord) {
  const presentation = evidencePresentation(record.structured.evidenceLevel || 'REPORTED');
  const kind = record.structured.sourceKind;
  return record.structured.evidenceLevel === 'REPORTED' &&
    ['public_directory', 'public_social', 'repository_code', 'repository_document'].includes(
      kind || '',
    )
    ? { ...presentation, label: fieldOptionLabel('sourceKind', kind!) }
    : presentation;
}
function business(record: ModuleRecord) {
  const state = recordBusinessState(record);
  return hasRecordedValue(state.value) ? fieldOptionLabel(state.field, state.value) : '';
}
const decisionFacts = (record: ModuleRecord) =>
  (isNarrativeIntelligence(record.tabId) ? [] : (decisionFields[record.tabId] ?? []))
    .filter((id) => hasRecordedValue(record.structured[id]))
    .map((id) => {
      const field = (knowledgeFields[record.tabId] ?? []).find((f) => f.id === id);
      return {
        id,
        label: field?.label || id,
        value: field ? fieldValue(record, field) : tr('Not recorded'),
      };
    });
const recordPrimary = (record: ModuleRecord) =>
  isContacts.value && record.personName ? record.personName : readableTitle(record.title);
function recordContext(record: ModuleRecord) {
  if (isNarrativeIntelligence(record.tabId)) return record.body.trim();
  if (isContacts.value)
    return [fieldOptionLabel('channel', record.structured.channel || ''), record.structured.role]
      .filter(Boolean)
      .join(' · ');
  return fieldsFor(record, true)
    .filter((field) => record.structured[field.id] !== 'unknown')
    .slice(0, 2)
    .map((field) => fieldValue(record, field))
    .join(' · ');
}
const nextStepTitle = computed(() =>
  props.tab.id === 'onboarding'
    ? tr('Checks and next steps')
    : isContacts.value
      ? tr('Contact notes and follow-up')
      : tr('What to check next'),
);

// ?record=<id>:展开并滚动到该记录(5.4);在合并的联系人卡片里时先展开卡片。
watch(
  () => [route.query.record, props.data, sharedObjects.value],
  async () => {
    const target = String(route.query.record || '');
    if (!records.value.some((record) => record.id === target)) return;
    await nextTick();
    const element = document.getElementById(`record-${target}`);
    const parent = element?.parentElement?.closest('details.contact-person-card');
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: 'start' });
  },
  { immediate: true },
);
const showList = computed(
  () =>
    records.value.length > 0 &&
    !['chart', 'timeline', 'comments'].includes(props.tab.kind) &&
    !['onboarding', 'roadmap', 'relationships'].includes(props.tab.id),
);
</script>
<template>
  <div class="module-view">
    <div v-if="data.status === 'not_applicable'" class="empty">
      <span class="tag">{{ tr('NOT APPLICABLE') }}</span>
      <h3>{{ tr('Not available: {0}', [tr(tab.title)]) }}</h3>
      <p>
        {{
          tr(
            'This module is not configured for these organization tags. It remains visible for comparison.',
          )
        }}
      </p>
    </div>
    <div v-else-if="data.status === 'restricted'" class="empty">
      <Icon name="lock" :size="28" />
      <span class="tag">{{ tr('RESTRICTED') }}</span>
      <h3>{{ tr('Restricted records') }}</h3>
      <p>{{ tr('Your account does not have access to these records.') }}</p>
    </div>
    <div v-else-if="pending" class="empty">
      <h3>{{ tr(tab.title) }}</h3>
      <p>{{ tr(tab.description) }}</p>
      <p class="hint">This module is being moved to the new version.</p>
    </div>
    <template v-else>
      <div v-if="tab.kind !== 'overview' && tab.id !== 'relationships'" class="module-heading">
        <div>
          <h3>{{ tr(tab.title) }}</h3>
          <p class="hint">{{ tr(tab.description) }}</p>
        </div>
        <button
          v-if="!['stats', 'comments'].includes(tab.kind) && canEdit"
          type="button"
          class="ghost"
          @click="edit()"
        >
          <Icon name="plus" :size="16" />
          {{ tab.kind === 'chart' ? tr('Add person') : tr('Add record') }}
        </button>
      </div>
      <OrganizationOverview
        v-if="tab.kind === 'overview'"
        :organization="organization"
        @add-note="edit()"
      />
      <OrgChart
        v-if="tab.kind === 'chart'"
        :organization="organization"
        :records="records"
        @edit="edit"
        @history="historyFor = $event"
        @refresh="emit('refresh')"
      />
      <KnowledgePanel v-if="tab.id === 'relationships'" :organization-id="organization.id" />
      <DiscussionPanel
        v-if="tab.kind === 'comments'"
        :organization="organization"
        :records="records"
        @refresh="emit('refresh')"
        @edit="edit"
      />
      <PeopleMovements
        v-if="tab.kind === 'timeline' && records.length"
        :organization="organization"
        :records="records"
        @edit="edit"
        @history="historyFor = $event"
      />
      <div
        v-if="
          data.status === 'empty' &&
          ['records', 'timeline'].includes(tab.kind) &&
          tab.id !== 'relationships'
        "
        class="empty"
      >
        <h3>{{ tr('Ready for the first insight') }}</h3>
        <p>
          {{
            tr(
              'This module is available. Add a referenced record to share knowledge with the team.',
            )
          }}
        </p>
        <button v-if="canEdit" type="button" @click="edit()">
          {{ tr('Add the first record') }}
        </button>
      </div>
      <p v-if="copyStatus" class="hint" role="status">{{ copyStatus }}</p>
      <div v-if="isContacts && records.length" class="segmented" :aria-label="tr('Contact group')">
        <button
          v-for="group in contactGroups"
          :key="group"
          type="button"
          :aria-pressed="contactFilter === group"
          @click="contactFilter = group"
        >
          {{ tr(group || 'All') }}
          <small>{{
            group
              ? contactCards.filter((card) => card.records.some((r) => contactGroup(r) === group))
                  .length
              : contactCards.length
          }}</small>
        </button>
      </div>
      <div v-if="showList" class="record-list">
        <h4 v-if="tab.kind === 'overview'" class="subheading">
          {{ tr('Team knowledge') }} <span>{{ records.length }}</span>
        </h4>
        <component
          :is="merged(card) ? 'details' : 'div'"
          v-for="card in cards"
          :key="card.id"
          :class="{ 'record-card contact-person-card': merged(card) }"
        >
          <summary v-if="merged(card)" class="record-row">
            <Icon name="users" :size="17" />
            <span class="record-row-main">
              <strong>{{ recordPrimary(card.records[0]!) }}</strong>
              <span class="record-row-context">
                {{
                  [...new Set(card.records.map((r) => r.structured.role).filter(Boolean))].join(
                    ' · ',
                  )
                }}
              </span>
              <span class="record-row-context">
                {{
                  card.records
                    .map(
                      (r) =>
                        `${fieldOptionLabel('channel', r.structured.channel || '')}: ${r.structured.value}`,
                    )
                    .join(' · ')
                }}
              </span>
            </span>
          </summary>
          <details
            v-for="record in card.records"
            :id="`record-${record.id}`"
            :key="record.id"
            class="record-card"
          >
            <summary class="record-row">
              <Icon :name="isContacts ? 'users' : 'file'" :size="17" />
              <span class="record-row-main">
                <strong :title="recordPrimary(record)">
                  {{
                    merged(card)
                      ? fieldOptionLabel('channel', record.structured.channel || '')
                      : recordPrimary(record)
                  }}
                  <code v-if="record.structured.sourceId">{{ record.structured.sourceId }}</code>
                </strong>
                <span
                  v-if="recordContext(record) && !decisionFacts(record).length"
                  class="record-row-context"
                  :title="recordContext(record)"
                  >{{ recordContext(record) }}</span
                >
                <span v-if="decisionFacts(record).length" class="decision-facts">
                  <span v-for="fact in decisionFacts(record)" :key="fact.id">
                    <small>{{ tr(fact.label) }}</small>
                    <span :title="fact.value">{{ fact.value }}</span>
                  </span>
                </span>
                <span v-if="isContacts" class="record-row-context">
                  {{ record.structured.value }} · {{ tr('Owner') }}:
                  {{ record.structured.owner || tr('Not assigned') }}
                </span>
              </span>
              <span v-if="knowledgeFields[tab.id]" class="record-state">
                {{ business(record) }}
                <small :class="{ overdue: reviewDue(record, today()) }">
                  {{
                    reviewDue(record, today())
                      ? tr('Review overdue')
                      : reviewPresentation(record.status).label
                  }}
                </small>
              </span>
              <span v-else class="hint">{{ dateTime(record.updatedAt) }}</span>
              <span v-if="isContacts" class="quick-actions">
                <a
                  v-if="contactHref(record.structured)"
                  :href="contactHref(record.structured)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="tr('Open contact channel for {0}', [recordPrimary(record)])"
                  @click.stop
                  ><Icon name="external" :size="15"
                /></a>
                <button
                  type="button"
                  class="ghost"
                  :aria-label="tr('Copy contact for {0}', [recordPrimary(record)])"
                  @click.stop.prevent="copyContact(record)"
                >
                  <Icon name="copy" :size="15" />
                </button>
                <button
                  type="button"
                  class="ghost"
                  :aria-label="tr('Conversation history for {0}', [recordPrimary(record)])"
                  @click.stop.prevent="contactHistory = record"
                >
                  <Icon name="clock" :size="15" />
                </button>
              </span>
            </summary>
            <div class="record-expanded">
              <header class="record-head">
                <span
                  v-if="record.structured.evidenceLevel"
                  class="tag"
                  :title="sourceBadge(record).hint"
                  >{{ tr('Source:') }} {{ tr(sourceBadge(record).label) }}</span
                >
                <span v-if="record.visibility === 'admin'" class="tag">
                  <Icon name="lock" :size="11" /> {{ tr('Administrator') }}
                </span>
                <small class="push">v{{ record.revision }}</small>
                <button
                  v-if="canEdit"
                  type="button"
                  class="ghost"
                  :aria-label="tr('Edit {0}', [recordPrimary(record)])"
                  @click="edit(record)"
                >
                  <Icon name="edit" :size="15" />
                </button>
              </header>
              <h4>{{ readableTitle(record.title) }}</h4>
              <p v-if="record.structured.evidenceLevel" class="hint">
                <span class="tag">{{
                  fieldOptionLabel('sensitivity', record.structured.sensitivity || '')
                }}</span>
                {{
                  tr('{0} · Reviewed {1}', [record.structured.owner, record.structured.reviewedOn])
                }}
              </p>
              <p v-if="isContacts" class="contact-primary">
                <a
                  v-if="contactHref(record.structured)"
                  :href="contactHref(record.structured)"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ record.structured.value }}</a
                >
                <span v-else>{{ record.structured.value }}</span>
                <span class="hint">{{ record.personName || tr('Organization channel') }}</span>
              </p>
              <a
                v-if="
                  record.personEmail &&
                  (!isContacts || record.personEmail !== record.structured.value)
                "
                :href="`mailto:${record.personEmail}`"
                >{{ record.personEmail }}</a
              >
              <p v-if="record.personName && !record.personEmail && isContacts" class="hint">
                {{ tr('Email not published') }}
              </p>
              <p v-if="isNarrativeIntelligence(tab.id)" class="record-body">{{ record.body }}</p>
              <component
                :is="isNarrativeIntelligence(tab.id) ? 'details' : 'div'"
                v-if="knowledgeFields[tab.id] && fieldsFor(record, false).length"
              >
                <summary v-if="isNarrativeIntelligence(tab.id)">
                  {{ tr('Supporting details') }}
                </summary>
                <dl class="knowledge-grid">
                  <div v-for="field in fieldsFor(record, false)" :key="field.id">
                    <dt>{{ tr(field.label) }}</dt>
                    <dd>
                      {{ fieldValue(record, field) }}
                      <small v-if="fieldHint(field.id, record.structured[field.id] || '')">
                        {{ fieldHint(field.id, record.structured[field.id] || '') }}
                      </small>
                    </dd>
                  </div>
                </dl>
              </component>
              <div v-if="record.structured.verification" class="next-step">
                <strong>{{ nextStepTitle }}</strong>
                <p>{{ readableNote(record.structured.verification) }}</p>
              </div>
              <p v-if="!isNarrativeIntelligence(tab.id)" class="record-body">{{ record.body }}</p>
              <span v-if="record.scope" class="tag">
                {{ record.scope === 'Organization-wide' ? tr('Organization-wide') : record.scope }}
              </span>
              <p class="record-links">
                <RouterLink
                  v-for="object in objectsFor(record.id)"
                  :key="object.id"
                  :to="{ path: relationshipsPath, query: { object: object.id } }"
                >
                  {{ tr('{0} · Connections & evidence', [object.name]) }}
                </RouterLink>
                <RouterLink
                  v-if="!objectsFor(record.id).length && canEdit"
                  :to="{ path: relationshipsPath, query: { sourceRecord: record.id } }"
                >
                  {{ tr('Connect to a shared object') }}
                </RouterLink>
                <RouterLink
                  v-if="canEdit"
                  :to="{
                    path: '/w/internal/work',
                    query: { organizationId: organization.id, sourceRecord: record.id },
                  }"
                >
                  {{ tr('Create follow-up task') }}
                </RouterLink>
              </p>
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
                  <button type="button" class="link" @click="historyFor = record.id">
                    {{ tr('History') }}
                  </button>
                </span>
              </footer>
            </div>
          </details>
        </component>
      </div>
    </template>
    <RecordEditor
      v-if="showEditor"
      :organization="organization"
      :tab="tab"
      :record="editing"
      :records="records"
      @close="showEditor = false"
      @saved="
        showEditor = false;
        emit('refresh');
      "
    />
    <AppDialog
      v-if="contactHistory"
      :eyebrow="tr('Conversation history')"
      :title="contactHistory.personName || contactHistory.title"
      wide
      @close="contactHistory = undefined"
    >
      <DiscussionPanel :organization="organization" :records="[]" :contact="contactHistory" />
    </AppDialog>
    <RecordHistory
      v-if="historyFor"
      :record-id="historyFor"
      :positions="tab.kind === 'chart' ? records : undefined"
      @close="historyFor = undefined"
    />
  </div>
</template>
