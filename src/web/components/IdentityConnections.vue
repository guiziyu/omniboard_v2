<script setup lang="ts">
// 跨机构身份(frontend-spec 7.14),从 v1 IdentityConnections.vue 迁移。
import { computed, ref, watch } from 'vue';
import type { KnowledgeObject } from '../../shared/operations';
import type { IdentitySearch, IdentityHistory } from '../../shared/identities';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { tabs } from '../../shared/registry';
import AppDialog from './AppDialog.vue';
import Icon from './Icon.vue';
const props = defineProps<{ object: KnowledgeObject }>();
const emit = defineEmits<{ changed: [id: string] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const post = (path: string, body: object) => api(path, { method: 'POST', body });
const dialog = ref<'' | 'link' | 'undo' | 'unlink'>(''),
  query = ref(''),
  reason = ref(''),
  choice = ref(''),
  error = ref(''),
  busy = ref(false),
  loading = ref(false);
const result = ref<IdentitySearch>({ objects: [], records: [] }),
  history = ref<IdentityHistory[]>([]),
  eventId = ref(''),
  recordId = ref('');
let serial = 0;
const objects = computed(() =>
  result.value.objects.filter(
    (o) => o.id !== props.object.id && o.visibility === props.object.visibility,
  ),
);
const records = computed(() =>
  result.value.records.filter(
    (r) =>
      !r.objectIds.length &&
      !props.object.records.some((known) => known.id === r.id) &&
      (props.object.visibility === 'admin' || r.visibility === 'team'),
  ),
);
const selected = computed(() => objects.value.find((o) => choice.value === 'identity:' + o.id));
const selectedRecord = computed(() => records.value.find((r) => choice.value === 'record:' + r.id));
const dialogTitle = computed(() =>
  tr(
    dialog.value === 'link'
      ? 'Link across organizations'
      : dialog.value === 'undo'
        ? 'Undo identity merge'
        : 'Unlink identity',
  ),
);
const tabTitle = (id: string) => tr(tabs.find((t) => t.id === id)?.title || id);
watch(
  () => [props.object.id, props.object.revision],
  async () => {
    const request = ++serial;
    dialog.value = '';
    error.value = '';
    history.value = [];
    try {
      const data = await api<{ history: IdentityHistory[] }>(
        `/api/knowledge/identities/${props.object.id}`,
      );
      if (request === serial) history.value = data.history;
    } catch (e) {
      if (request === serial) error.value = errorText(e);
    }
  },
  { immediate: true },
);
let searchSerial = 0;
async function search() {
  const request = ++searchSerial;
  loading.value = true;
  error.value = '';
  choice.value = '';
  try {
    const data = await api<IdentitySearch>(
      `/api/knowledge/identities?q=${encodeURIComponent(query.value)}&kind=${props.object.kind}`,
    );
    if (request === searchSerial) result.value = data;
  } catch (e) {
    if (request === searchSerial) error.value = errorText(e);
  } finally {
    if (request === searchSerial) loading.value = false;
  }
}
function open() {
  dialog.value = 'link';
  query.value = props.object.name;
  reason.value = '';
  void search();
}
function undo(event: IdentityHistory) {
  dialog.value = 'undo';
  eventId.value = event.id;
  reason.value = '';
  error.value = '';
}
function unlink(id: string) {
  dialog.value = 'unlink';
  recordId.value = id;
  reason.value = '';
  error.value = '';
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    let target = props.object.id;
    if (dialog.value === 'undo')
      await post(`/api/knowledge/identities/${target}/undo`, {
        eventId: eventId.value,
        revision: props.object.revision,
        reason: reason.value,
      });
    else if (dialog.value === 'unlink')
      await post(`/api/knowledge/identities/${target}/unlink`, {
        recordId: recordId.value,
        revision: props.object.revision,
        reason: reason.value,
      });
    else if (selected.value) {
      target = selected.value.id;
      await post(`/api/knowledge/identities/${target}/merge`, {
        otherId: props.object.id,
        revision: selected.value.revision,
        otherRevision: props.object.revision,
        reason: reason.value,
      });
    } else if (selectedRecord.value)
      await post(`/api/knowledge/objects/${target}/records`, {
        recordId: selectedRecord.value.id,
        revision: props.object.revision,
        reason: reason.value,
      });
    else return;
    dialog.value = '';
    emit('changed', target);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="identity-connections" :aria-label="tr('Identity across organizations')">
    <div class="work-heading">
      <div>
        <strong>
          <Icon name="users" :size="16" />
          {{ tr('Identity across organizations') }}
        </strong>
        <p class="hint">
          {{
            tr('One identity. Organization-specific roles, evidence and permissions stay separate.')
          }}
        </p>
      </div>
      <button v-if="canEdit" type="button" class="ghost" @click="open">
        {{ tr('Link across organizations') }}
      </button>
    </div>
    <div class="identity-organizations">
      <RouterLink
        v-for="org in object.organizations"
        :key="org.id"
        :to="{
          path: `/w/internal/organizations/${org.id}/relationships`,
          query: { object: object.id, knowledgeView: 'map' },
        }"
      >
        <Icon name="building" :size="14" />
        {{ org.name }}
      </RouterLink>
    </div>
    <p v-if="error && !dialog" role="alert" class="error">{{ error }}</p>
    <details class="identity-details">
      <summary>{{ tr('Linked records') }} · {{ object.records.length }}</summary>
      <div v-for="record in object.records" :key="record.id" class="identity-record">
        <div>
          <strong>{{ record.organizationName }}</strong>
          <span>{{ tabTitle(record.tabId) }} · {{ record.title }}</span>
        </div>
        <button type="button" class="link" @click="openEvidence(record.evidenceId)">
          {{ tr('Original source') }}
        </button>
        <button
          type="button"
          v-if="canEdit && object.records.length > 1"
          class="link"
          @click="unlink(record.id)"
        >
          {{ tr('Unlink identity') }}
        </button>
      </div>
    </details>
    <details v-if="history.length" class="identity-details">
      <summary>{{ tr('Identity decisions') }} · {{ history.length }}</summary>
      <article v-for="entry in history" :key="entry.id" class="identity-event">
        <strong>
          {{
            tr(
              {
                link: 'Record linked',
                unlink: 'Record unlinked',
                merge: 'Identities merged',
                undo_merge: 'Identity merge undone',
              }[entry.kind],
            )
          }}
          {{ entry.otherName || entry.recordTitle }}
        </strong>
        <p>{{ entry.reason }}</p>
        <small>{{ entry.author }} · {{ dateTime(entry.createdAt) }}</small>
        <div class="work-actions">
          <button type="button" class="link" @click="openEvidence(entry.evidenceId)">
            {{ tr('Decision reference') }}
          </button>
          <button type="button" v-if="entry.canUndo && canEdit" class="link" @click="undo(entry)">
            {{ tr('Undo identity merge') }}
          </button>
        </div>
      </article>
    </details>
  </section>
  <AppDialog v-if="dialog" :title="dialogTitle" :busy="busy" wide @close="dialog = ''">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="dialog === 'link'">
      <p>
        {{
          tr('Review the sources before linking. Matching names alone do not establish identity.')
        }}
      </p>
      <form class="identity-search" @submit.prevent="search">
        <input v-model="query" :aria-label="tr('Search identities and records')" />
        <button type="submit" class="ghost" :disabled="loading">{{ tr('Search') }}</button>
      </form>
      <p v-if="loading" role="status">{{ tr('Searching identities…') }}</p>
      <div class="identity-candidates" v-else>
        <label
          v-for="candidate in objects"
          :key="candidate.id"
          class="identity-candidate"
          :class="{ chosen: choice === 'identity:' + candidate.id }"
        >
          <input
            v-model="choice"
            type="radio"
            :value="'identity:' + candidate.id"
            name="identity-choice"
          />
          <span>
            <strong>{{ candidate.name }}</strong>
            <small>
              {{ tr('Shared identity') }} ·
              {{ candidate.organizations?.map((o) => o.name).join(' · ') }}
            </small>
            <span>{{ candidate.scope }}</span>
          </span>
        </label>
        <label
          v-for="candidate in records"
          :key="candidate.id"
          class="identity-candidate"
          :class="{ chosen: choice === 'record:' + candidate.id }"
        >
          <input
            v-model="choice"
            type="radio"
            :value="'record:' + candidate.id"
            name="identity-choice"
          />
          <span>
            <strong>{{ candidate.personName || candidate.title }}</strong>
            <small>{{ candidate.organizationName }} · {{ tabTitle(candidate.tabId) }}</small>
            <span>{{ candidate.title }}</span>
          </span>
        </label>
        <p v-if="!objects.length && !records.length" class="hint">
          {{ tr('No matching identities or unlinked records. Try another name or organization.') }}
        </p>
      </div>
      <div v-if="selected || selectedRecord" class="identity-preview">
        <strong>{{ tr('Review original references') }}</strong>
        <div
          v-for="record in selected?.records || (selectedRecord ? [selectedRecord] : [])"
          :key="record.id"
        >
          <span>{{ record.organizationName }} · {{ record.title }}</span>
          <button type="button" class="link" @click="openEvidence(record.evidenceId)">
            {{ tr('Original source') }}
          </button>
        </div>
        <p v-if="selected">
          {{
            tr(
              'This combines the identities for display. Original records and organization-specific claims remain intact; the merge can be undone.',
            )
          }}
        </p>
      </div>
    </template>
    <p v-else>
      {{ tr('Original records and evidence are preserved. Explain the correction for the team.') }}
    </p>
    <form @submit.prevent="save">
      <label class="identity-reason">
        {{ tr('Reason for this identity decision') }}
        <textarea
          v-model="reason"
          required
          maxlength="4000"
          rows="3"
          :placeholder="tr('For example: the same official profile explicitly lists both roles.')"
        />
      </label>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="dialog = ''">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="busy || !reason.trim() || (dialog === 'link' && !choice)">
          {{
            busy
              ? tr('Saving…')
              : tr(
                  dialog === 'link'
                    ? 'Confirm shared identity'
                    : dialog === 'undo'
                      ? 'Undo identity merge'
                      : 'Unlink identity',
                )
          }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
<style scoped>
.identity-connections {
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 4%, var(--bg));
  padding: 16px;
  margin: 18px 0;
}
.identity-connections .work-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}
.identity-connections strong {
  font-size: 13px;
}
.identity-connections p {
  margin: 8px 0;
}
.identity-organizations {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.identity-organizations a {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--line);
  padding: 7px 11px;
  border-radius: 5px;
  background: var(--bg);
  font-size: 12px;
  color: var(--accent);
}
.identity-details {
  margin-top: 14px;
  font-size: 12px;
}
.identity-details summary {
  cursor: pointer;
}
.identity-record {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.identity-record > div {
  flex: 1;
  min-width: 0;
}
.identity-record span {
  display: block;
  color: var(--muted);
  margin-top: 5px;
}
.identity-event {
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.identity-event small {
  display: block;
  color: var(--muted);
  margin-bottom: 8px;
}
.identity-dialog {
  max-width: 760px;
}
.identity-search {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.identity-search input {
  flex: 1;
  min-width: 0;
}
.identity-candidates {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.identity-candidate {
  margin: 0;
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 13px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.identity-candidate.chosen {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  box-shadow: inset 3px 0 var(--accent);
}
.identity-candidate input {
  width: auto;
}
.identity-candidate > span {
  min-width: 0;
}
.identity-candidate strong,
.identity-candidate small,
.identity-candidate span > span {
  display: block;
  margin: 4px 0;
}
.identity-candidate small {
  color: var(--accent);
}
.identity-candidate span > span {
  font-size: 12px;
  color: var(--muted);
}
.identity-preview {
  padding: 14px;
  background: var(--panel);
  border-radius: 6px;
  margin-top: 14px;
  font-size: 12px;
}
.identity-preview > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
}
.identity-reason {
  display: block;
  margin: 18px 0;
}
.identity-reason textarea {
  display: block;
  width: 100%;
  margin-top: 8px;
}
.dialog-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.identity-dialog p {
  font-size: 13px;
  line-height: 1.6;
}
.identity-record,
.identity-preview > div {
  flex-wrap: wrap;
}
</style>
