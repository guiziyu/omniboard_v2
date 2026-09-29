<script setup lang="ts">
// 人才目录(frontend-spec 6.9–6.11),从 v1 TalentDirectory.vue 迁移。筛选写在 URL(replace,清空 page 与
// person)并按账号记忆(2.11);详情是 `?person=` 深链的抽屉,关闭用 replace。
import { computed, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { fieldOptionLabel } from '../presentation';
import { useRememberedFilters } from '../remembered-filters';
import type { TalentDetail, TalentDirectory, TalentEntry, TalentRecord } from '../../shared/talent';
import type { KnowledgeObject } from '../../shared/operations';
import {
  movementDateLabelKey,
  movementPerspective,
  movementTransition,
  movementType,
} from '../../shared/people-movements';
import AppDialog from '../components/AppDialog.vue';
import Icon from '../components/Icon.vue';
import IdentityConnections from '../components/IdentityConnections.vue';
import PersonCareer from '../components/PersonCareer.vue';
import PersonProfileImport from '../components/PersonProfileImport.vue';
import PositionDrivers from '../components/PositionDrivers.vue';

const route = useRoute();
const router = useRouter();
useRememberedFilters('talent');
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const data = ref<TalentDirectory>();
const detail = ref<TalentDetail>();
const identityObject = ref<KnowledgeObject>();
const importOpen = ref(false);
const importProfileId = ref('');
const detailRevision = ref(0);
const notice = ref('');
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const detailError = ref('');
const search = ref(String(route.query.q ?? ''));
const selectedId = computed(() => String(route.query.person ?? ''));
let serial = 0;
let detailSerial = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;
const filterQuery = computed(() => {
  const query = new URLSearchParams();
  for (const key of ['q', 'organizationId', 'duplicates', 'contact', 'sort', 'page']) {
    const value = route.query[key];
    if (typeof value === 'string') query.set(key, value);
  }
  return query.toString();
});
async function load() {
  const request = ++serial;
  loading.value = true;
  error.value = '';
  try {
    const response = await api<TalentDirectory>('/api/talent?' + filterQuery.value);
    if (request === serial) data.value = response;
  } catch (e) {
    if (request === serial) error.value = errorText(e);
  } finally {
    if (request === serial) loading.value = false;
  }
}
watch(
  () => [route.path, filterQuery.value],
  () => {
    if (route.path !== '/w/internal/talent') return;
    search.value = String(route.query.q ?? '');
    void load();
  },
  { immediate: true },
);
watch(
  () => [selectedId.value, detailRevision.value] as const,
  async ([id]) => {
    const request = ++detailSerial;
    detail.value = undefined;
    identityObject.value = undefined;
    detailError.value = '';
    detailLoading.value = !!id;
    if (!id) return;
    try {
      const response = await api<TalentDetail>('/api/talent/' + encodeURIComponent(id));
      if (request !== detailSerial) return;
      detail.value = response;
      if (response.identityId) {
        const identity = await api<{ object: KnowledgeObject }>(
          '/api/knowledge/identities/' + encodeURIComponent(response.identityId),
        );
        if (request === detailSerial) identityObject.value = identity.object;
      }
    } catch (e) {
      if (request === detailSerial) detailError.value = errorText(e);
    } finally {
      if (request === detailSerial) detailLoading.value = false;
    }
  },
  { immediate: true },
);
function filter(key: string, value: string) {
  clearTimeout(debounce);
  void router.replace({
    query: {
      ...route.query,
      [key]: value || undefined,
      person: undefined,
      page: key === 'page' ? value : undefined,
    },
  });
}
function searchInput() {
  clearTimeout(debounce);
  debounce = setTimeout(() => filter('q', search.value.trim()), 250);
}
const select = (person: TalentEntry) =>
  void router.push({ query: { ...route.query, person: person.id } });
function openImport(profileId = '') {
  importProfileId.value = profileId;
  importOpen.value = true;
}
function profileSaved(identityId: string, unchanged: boolean) {
  importOpen.value = false;
  notice.value = tr(
    unchanged
      ? 'This capture is already recorded. No duplicate was created.'
      : 'Profile saved. Career entries are attached to one person.',
  );
  void router.replace({ query: { ...route.query, person: 'identity:' + identityId } });
  detailRevision.value++;
  void load();
}
function dossierChanged() {
  detailRevision.value++;
  void load();
}
const close = () => void router.replace({ query: { ...route.query, person: undefined } });
const openPerson = (id: string) =>
  void router.replace({ query: { ...route.query, person: 'identity:' + id } });
function explore() {
  const person = detail.value;
  const source = person?.records[0];
  const organizationId = source?.organizationId || person?.organizations[0]?.id;
  if (!person || !organizationId || (!person.identityId && !source)) return;
  void router.push({
    path: `/w/internal/organizations/${organizationId}/relationships`,
    query: person.identityId
      ? { object: person.identityId, knowledgeView: 'map' }
      : { sourceRecord: source!.id, knowledgeView: 'map' },
  });
}
const aliases = computed(() => detail.value?.aliases.filter((a) => a !== detail.value!.name) ?? []);
const positions = computed(() =>
  (detail.value?.records ?? [])
    .filter((r) => r.tabId === 'org_chart')
    .map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      title: r.title,
      personName: r.personName,
    })),
);
const perspective = (record: TalentRecord) => movementPerspective(record, record.organizationName);
const transition = (record: TalentRecord) => movementTransition(record, record.organizationName);
const movementClass = (type: string) =>
  'movement-card-' + (type === 'transferred' ? 'role_change' : type);
const eventDate = (value: string) =>
  !value
    ? tr('Date not published')
    : value.length === 4
      ? tr('{0} · Year only', [value])
      : value.length === 7
        ? tr('{0} · Month only', [value])
        : value;
const sourceLink = (record: TalentRecord) => ({
  path: `/w/internal/organizations/${record.organizationId}/${record.tabId}`,
  query: { record: record.id },
});
onUnmounted(() => {
  clearTimeout(debounce);
  serial++;
  detailSerial++;
});
</script>
<template>
  <section class="page wide talent-page">
    <header class="page-head">
      <div>
        <h1>{{ tr('Talent directory') }}</h1>
        <p class="hint">{{ tr('People, roles and relationships across organizations.') }}</p>
      </div>
      <div class="work-actions">
        <button v-if="canEdit" type="button" @click="openImport()">
          {{ tr('Import personal profile') }}
        </button>
        <button type="button" class="ghost" :disabled="loading" @click="load">
          <Icon name="refresh" :size="16" />
          {{ tr('Refresh') }}
        </button>
      </div>
    </header>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <div
      v-if="data?.counts.possibleDuplicates || route.query.duplicates === 'review'"
      class="segmented talent-review"
    >
      <button
        type="button"
        :aria-pressed="route.query.duplicates !== 'review'"
        @click="filter('duplicates', '')"
      >
        {{ tr('All people') }}
      </button>
      <button
        type="button"
        :aria-pressed="route.query.duplicates === 'review'"
        @click="filter('duplicates', 'review')"
      >
        {{ tr('Possible duplicate dossiers') }} · {{ data?.counts.possibleDuplicates ?? 0 }}
      </button>
    </div>
    <div class="catalog-card">
      <div class="filters">
        <label>
          {{ tr('Search talent') }}
          <input
            v-model="search"
            type="search"
            :placeholder="tr('Search name, role, organization or contact…')"
            @input="searchInput"
            @keydown.enter="filter('q', search.trim())"
          />
        </label>
        <label>
          {{ tr('Organization') }}
          <select
            :value="route.query.organizationId ?? ''"
            @change="filter('organizationId', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ tr('All organizations') }}</option>
            <option v-for="org in data?.organizations ?? []" :key="org.id" :value="org.id">
              {{ org.name }}
            </option>
          </select>
        </label>
        <label>
          {{ tr('Contact availability') }}
          <select
            :value="route.query.contact ?? 'all'"
            @change="filter('contact', ($event.target as HTMLSelectElement).value)"
          >
            <option value="all">{{ tr('All') }}</option>
            <option value="available">{{ tr('Has contact details') }}</option>
          </select>
        </label>
        <label>
          {{ tr('Sort by') }}
          <select
            :value="route.query.sort ?? 'updated'"
            @change="filter('sort', ($event.target as HTMLSelectElement).value)"
          >
            <option value="updated">{{ tr('Recently updated') }}</option>
            <option value="name">{{ tr('Name') }}</option>
          </select>
        </label>
        <button type="button" class="link" @click="router.replace({ query: {} })">
          {{ tr('Reset filters') }}
        </button>
      </div>
      <p v-if="error" role="alert" class="error">{{ tr(error) }}</p>
      <p v-if="loading" role="status" class="hint">{{ tr('Loading…') }}</p>
      <div v-else-if="data?.people.length" class="table-wrap">
        <table class="talent-table">
          <thead>
            <tr>
              <th>{{ tr('Person name') }}</th>
              <th>{{ tr('Associated organizations') }}</th>
              <th>{{ tr('Latest movement') }}</th>
              <th>{{ tr('Contact methods') }}</th>
              <th>{{ tr('Updated') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="person in data.people" :key="person.id">
              <td>
                <button type="button" class="talent-name" @click="select(person)">
                  <span class="avatar" aria-hidden="true">{{ person.name.slice(0, 1) }}</span>
                  <span>
                    <strong>{{ person.name }}</strong>
                    <small>
                      {{ person.currentRoles[0] || person.roles[0] || tr('Role not recorded') }}
                    </small>
                  </span>
                </button>
                <button
                  v-if="person.duplicateCount"
                  type="button"
                  class="link"
                  @click="select(person)"
                >
                  {{ tr('Possible duplicate dossiers') }} · {{ person.duplicateCount }}
                </button>
              </td>
              <td>
                <span class="talent-orgs">
                  <RouterLink
                    v-for="org in person.organizations.slice(0, 2)"
                    :key="org.id"
                    :to="`/w/internal/organizations/${org.id}/overview`"
                  >
                    {{ org.name }}
                  </RouterLink>
                  <button
                    v-if="person.organizations.length > 2"
                    type="button"
                    class="link"
                    @click="select(person)"
                  >
                    {{ tr('+{0} more', [person.organizations.length - 2]) }}
                  </button>
                </span>
              </td>
              <td>
                <template v-if="person.latestMovement">
                  <span class="movement-type" :class="movementClass(person.latestMovement.type)">
                    <Icon :name="movementType(person.latestMovement.type).icon" :size="14" />
                    {{ tr(movementType(person.latestMovement.type).label) }}
                  </span>
                  <small class="talent-note">
                    <template v-if="person.latestMovement.type === 'transferred'">
                      {{ person.latestMovement.structured.fromOrganization }} →
                      {{ person.latestMovement.structured.toOrganization }}
                    </template>
                    <template v-else>{{ person.latestMovement.organizationName }}</template>
                  </small>
                  <small
                    v-if="
                      person.latestMovement.type === 'transferred' &&
                      person.latestMovement.structured.toRole
                    "
                    class="talent-note"
                  >
                    {{ person.latestMovement.structured.toRole }}
                  </small>
                  <small class="talent-note">
                    {{ tr(movementDateLabelKey(person.latestMovement.structured)) }}:
                    {{ eventDate(person.latestMovement.date) }}
                  </small>
                </template>
                <span v-else class="hint">—</span>
              </td>
              <td>
                <button
                  v-if="person.contactCount"
                  type="button"
                  class="link"
                  @click="select(person)"
                >
                  {{ tr('{0} contact methods', [person.contactCount]) }}
                </button>
                <span v-else class="hint">{{ tr('Not recorded') }}</span>
              </td>
              <td>
                <small>{{ dateTime(person.updatedAt) }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!error && data" class="empty">
        <Icon name="users" :size="32" />
        <h2>{{ tr('No matching people') }}</h2>
        <p>
          {{
            tr(
              'People recorded in Org Chart, Contacts and People Movements appear here. Try a different filter or maintain a source record in its organization.',
            )
          }}
        </p>
      </div>
      <div v-if="data" class="toolbar pager">
        <span>{{ tr('{0} matching entries', [data.total]) }}</span>
        <div>
          <button
            type="button"
            class="ghost"
            :disabled="loading || data.page <= 1"
            @click="filter('page', String(data.page - 1))"
          >
            {{ tr('Previous') }}
          </button>
          <span>{{ data.page }} / {{ data.pages }}</span>
          <button
            type="button"
            class="ghost"
            :disabled="loading || data.page >= data.pages"
            @click="filter('page', String(data.page + 1))"
          >
            {{ tr('Next') }}
          </button>
        </div>
      </div>
    </div>
    <AppDialog
      v-if="selectedId && !importOpen"
      :title="detail?.name || tr('Person details')"
      :eyebrow="tr('Talent directory')"
      drawer
      @close="close"
    >
      <p v-if="detailLoading" class="hint">{{ tr('Loading…') }}</p>
      <p v-if="detailError" class="error" role="alert">{{ tr(detailError) }}</p>
      <div v-if="detail" class="talent-detail">
        <PositionDrivers :positions="positions" />
        <PersonCareer
          :person="detail"
          @update="openImport"
          @changed="dossierChanged"
          @open-person="openPerson"
        />
        <p v-if="aliases.length" class="hint">{{ aliases.join(' · ') }}</p>
        <button v-if="canEdit" type="button" class="link" @click="openImport()">
          + {{ tr('Add profile source') }}
        </button>
        <details v-if="identityObject" class="talent-section">
          <summary>{{ tr('Dossier history and merge tools') }}</summary>
          <IdentityConnections :object="identityObject" @changed="dossierChanged" />
        </details>
        <h4>{{ tr('Associated organizations') }}</h4>
        <div class="talent-orgs">
          <RouterLink
            v-for="org in detail.organizations"
            :key="org.id"
            :to="`/w/internal/organizations/${org.id}/overview`"
          >
            {{ org.name }}
            <Icon name="arrow" :size="14" />
          </RouterLink>
        </div>
        <p class="hint">
          {{ tr('Associations include historical records and do not confirm current employment.') }}
        </p>
        <button v-if="detail.identityId || canEdit" type="button" class="ghost" @click="explore">
          <Icon name="link" :size="16" />
          {{ tr('Explore relationships') }}
        </button>
        <details class="talent-section">
          <summary>
            {{ tr('Contact methods') }}
            <span class="count">{{ detail.contactCount }}</span>
          </summary>
          <template v-if="detail.contacts.length">
            <article
              v-for="contact in detail.contacts"
              :key="contact.channel + contact.value"
              class="talent-contact"
            >
              <small class="hint">
                {{ fieldOptionLabel('channel', contact.channel) }}
                <template v-if="contact.organizationName">
                  · {{ contact.organizationName }}
                </template>
              </small>
              <a v-if="contact.href" :href="contact.href" target="_blank" rel="noopener noreferrer">
                {{ contact.value }}
              </a>
              <span v-else>{{ contact.value }}</span>
              <p v-if="contact.role">{{ tr(contact.role) }}</p>
              <button type="button" class="link" @click="openEvidence(contact.evidenceId)">
                {{ tr('Original reference') }}
              </button>
            </article>
          </template>
          <p v-else class="hint">{{ tr('No contact details recorded.') }}</p>
        </details>
        <h4>{{ tr('Roles, movements and evidence') }}</h4>
        <details v-for="record in detail.records" :key="record.id" class="talent-section">
          <summary>
            <span class="talent-record-title">
              <small class="hint">{{ record.organizationName }}</small>
              <strong>
                {{
                  record.eventType
                    ? `${transition(record).fromOrganization || tr('Not recorded')} → ${transition(record).toOrganization || tr('Not recorded')}`
                    : record.title
                }}
              </strong>
            </span>
            <span
              v-if="record.eventType"
              class="movement-type"
              :class="movementClass(perspective(record))"
            >
              {{ tr(movementType(perspective(record)).label) }}
            </span>
          </summary>
          <p v-if="record.eventType" class="hint">
            {{ tr(movementDateLabelKey(record.structured)) }}: {{ eventDate(record.eventDate) }}
          </p>
          <p v-if="record.structured.fromRole || record.structured.toRole" class="talent-note">
            {{ tr('Before') }}: {{ record.structured.fromRole || tr('Role not recorded') }} ·
            {{ tr('After') }}: {{ record.structured.toRole || tr('Role not recorded') }}
          </p>
          <small v-if="record.eventType" class="hint">
            {{ tr('Source title') }}: {{ record.title }}
          </small>
          <p class="preserve-lines">{{ record.body }}</p>
          <div class="record-links">
            <button type="button" class="link" @click="openEvidence(record.evidenceId)">
              {{ tr('Original reference') }}
            </button>
            <RouterLink :to="sourceLink(record)">
              {{ tr('Open source record') }}
              <Icon name="arrow" :size="14" />
            </RouterLink>
          </div>
        </details>
      </div>
    </AppDialog>
    <PersonProfileImport
      v-if="importOpen"
      :identity-id="selectedId ? detail?.identityId : undefined"
      :name="selectedId ? detail?.name : undefined"
      :profile-id="importProfileId"
      @close="importOpen = false"
      @saved="profileSaved"
    />
  </section>
</template>
