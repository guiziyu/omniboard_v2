<script setup lang="ts">
// Overview(frontend-spec 4.7–4.10),从 v1 OrganizationOverview.vue 迁移。
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import { displayMetric } from '../format';
import { openEvidence } from '../evidence';
import { useOrganizationTab } from '../organization-work';
import { tabsFor } from '../../shared/registry';
import type { Observation, Organization } from '../../shared/types';
import Icon from './Icon.vue';
import OrganizationMetrics from './OrganizationMetrics.vue';
import OrganizationWorkSummary from './OrganizationWorkSummary.vue';
// compact:对比页两侧并排(4.5);指标区锚点只留给单机构页。
const props = defineProps<{ organization: Organization; compact?: boolean }>();
const emit = defineEmits<{ addNote: [] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const expandedAbout = ref(false);
const profile = computed(() => props.organization.profile);
const about = computed(() => profile.value?.about?.text || props.organization.description || '');
const sections = computed(() => {
  const groups = new Map<string, NonNullable<Organization['profile']>['facts']>();
  for (const fact of profile.value?.facts ?? []) {
    if (!groups.has(fact.section)) groups.set(fact.section, []);
    groups.get(fact.section)!.push(fact);
  }
  return [...groups].map(([title, facts]) => ({ title, facts }));
});
const latestCapture = computed(() =>
  props.organization.sources
    .map((s) => s.capturedAt)
    .sort()
    .at(-1),
);
const hasTab = (id: string) => tabsFor(props.organization.tags).some((t) => t.id === id);
const tabRoute = useOrganizationTab(() => props.organization.id);
// 样本历史(4.9):所有成功采集批次。
const history = ref<Observation[]>();
const historyError = ref('');
async function toggleHistory() {
  if (history.value) {
    history.value = undefined;
    return;
  }
  try {
    history.value = (
      await api<{ observations: Observation[] }>(
        `/api/organizations/${props.organization.id}/observations`,
      )
    ).observations;
  } catch (e) {
    historyError.value = errorText(e);
  }
}
const volume = (point: Observation) => point.metrics.find((m) => m.key === 'volume_24h');
</script>
<template>
  <div class="organization-overview" :class="{ 'overview-compact': compact }">
    <section class="overview-intro">
      <div class="section-heading">
        <h4>{{ tr('About {0}', [organization.name]) }}</h4>
        <span>
          <button v-if="canEdit" type="button" class="link" @click="emit('addNote')">
            <Icon name="plus" :size="14" /> {{ tr('Add note') }}
          </button>
          <button
            v-if="profile?.about"
            type="button"
            class="link"
            @click="openEvidence(profile.about.evidenceId)"
          >
            {{ tr('Reference') }}
          </button>
        </span>
      </div>
      <p v-if="about" class="introduction" :class="{ collapsed: !expandedAbout }">{{ about }}</p>
      <p v-else class="hint">
        {{
          tr(
            'An introduction has not been added yet. Team notes and public references can be added below.',
          )
        }}
      </p>
      <button
        v-if="about.length > 240"
        type="button"
        class="link"
        @click="expandedAbout = !expandedAbout"
      >
        {{ tr(expandedAbout ? 'Show fewer' : 'Read full introduction') }}
      </button>
      <p v-if="expandedAbout && profile?.about" class="hint">
        {{
          tr('{0} profile · Captured {1}', [
            profile.about.sourceName,
            dateTime(profile.about.capturedAt),
          ])
        }}
      </p>
    </section>

    <OrganizationWorkSummary v-if="hasTab('onboarding')" :organization="organization" />
    <section
      :id="compact ? undefined : 'metrics'"
      class="overview-snapshot"
      :aria-label="tr('Key metrics')"
    >
      <div class="section-heading">
        <h4>
          {{ organization.tags.includes('exchange') ? tr('Market snapshot') : tr('Key metrics') }}
        </h4>
      </div>
      <OrganizationMetrics :organization="organization" overview />
      <details class="detailed-metrics">
        <summary>{{ tr('Detailed metrics') }}</summary>
        <OrganizationMetrics :organization="organization" recorded-only />
        <button
          v-if="organization.sources.length"
          type="button"
          class="link"
          @click="toggleHistory"
        >
          <Icon name="clock" :size="14" /> {{ history ? tr('Hide history') : tr('Sample history') }}
        </button>
        <p v-if="historyError" class="error" role="alert">{{ tr(historyError) }}</p>
        <div v-if="history" class="table-wrap">
          <h4>
            {{ tr('Sample history') }}
            <span class="hint">{{ tr('{0} rows', [history.length]) }}</span>
          </h4>
          <table>
            <thead>
              <tr>
                <th>{{ tr('Collected') }}</th>
                <th>{{ tr('Source') }}</th>
                <th>{{ tr('Rank') }}</th>
                <th>{{ tr('24h volume') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in history" :key="point.evidenceId + point.slug">
                <td>{{ dateTime(point.capturedAt) }}</td>
                <td>{{ sourceName(point.source) }}</td>
                <td>#{{ point.rank }}</td>
                <td>{{ displayMetric(volume(point)) }} {{ volume(point)?.unit }}</td>
                <td>
                  <button type="button" class="link" @click="openEvidence(point.evidenceId)">
                    {{ tr('Reference') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p v-if="latestCapture" class="hint">
        {{
          tr('Last market capture {0} · Select a value for sources and assumptions.', [
            dateTime(latestCapture),
          ])
        }}
      </p>
    </section>

    <div class="overview-layout">
      <div>
        <section v-for="section in sections" :key="section.title" class="overview-section">
          <h4>{{ tr(section.title) }}</h4>
          <dl class="overview-facts">
            <div v-for="fact in section.facts" :key="fact.key">
              <dt>{{ tr(fact.label) }}</dt>
              <dd>
                <button
                  type="button"
                  class="fact"
                  :aria-label="tr('{0}: {1}. View reference', [tr(fact.label), fact.value])"
                  :title="`${fact.sourceName} · ${dateTime(fact.capturedAt)}`"
                  @click="openEvidence(fact.evidenceId)"
                >
                  <span>{{ fact.value }}</span> <Icon name="info" :size="14" />
                </button>
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <aside>
        <section v-if="profile?.links.length" class="overview-section">
          <h4>{{ tr('Useful links') }}</h4>
          <div v-for="link in profile.links" :key="link.key" class="overview-link">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ tr(link.label) }} ↗</a>
            <button
              type="button"
              class="ghost"
              :aria-label="tr('View reference for {0}', [tr(link.label)])"
              @click="openEvidence(link.evidenceId)"
            >
              <Icon name="info" :size="13" />
            </button>
          </div>
        </section>
        <section class="overview-section">
          <h4>{{ tr('Team workspace') }}</h4>
          <nav class="shortcuts">
            <RouterLink :to="tabRoute('contacts')">
              {{ tr('Contacts') }} <small>{{ tr('People and business channels') }}</small>
            </RouterLink>
            <RouterLink :to="tabRoute('org_chart')">
              {{ tr('Org chart') }} <small>{{ tr('Roles and reporting relationships') }}</small>
            </RouterLink>
            <RouterLink v-if="hasTab('onboarding')" :to="tabRoute('onboarding')">
              {{ tr('Onboarding') }} <small>{{ tr('Connection and account progress') }}</small>
            </RouterLink>
            <RouterLink v-if="hasTab('compliance')" :to="tabRoute('compliance')">
              {{ tr('Compliance') }} <small>{{ tr('Entity, product and access rules') }}</small>
            </RouterLink>
          </nav>
        </section>
        <details v-if="organization.sources.length" class="overview-section">
          <summary>
            {{ tr('Market data references') }} <span>{{ organization.sources.length }}</span>
          </summary>
          <div v-for="source in organization.sources" :key="source.linkId" class="overview-source">
            <a :href="source.url" target="_blank" rel="noopener noreferrer"
              >{{ sourceName(source.source) }} ↗</a
            >
            <small>{{ dateTime(source.capturedAt) }}</small>
            <button type="button" class="link" @click="openEvidence(source.evidenceId)">
              {{ tr('Original snapshot') }}
            </button>
          </div>
        </details>
      </aside>
    </div>
  </div>
</template>
