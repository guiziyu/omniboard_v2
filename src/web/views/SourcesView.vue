<script setup lang="ts">
// 数据来源页(frontend-spec 9.5–9.7),从 v1 SourcesView.vue 迁移。所有角色可看;采集、每日开关与
// 来源身份映射仅 admin。有运行中的采集时每 2.5 秒刷新,结束后刷新全局计数。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, errorText, refreshSummary, session } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import { openEvidence } from '../evidence';
import AppDialog from '../components/AppDialog.vue';
import Icon from '../components/Icon.vue';
import OrgPicker from '../components/OrgPicker.vue';
import type { DirectoryOrganization } from '../../shared/columns';
import {
  webSources,
  type RunStatus,
  type SourceMapping,
  type SourcesState,
  type WebSourceId,
} from '../../shared/sources';
const isAdmin = computed(() => session.user?.role === 'admin');
const state = ref<SourcesState>();
const error = ref('');
const busy = ref(false);
const filter = ref('');
const mapping = ref<SourceMapping>();
const pageKind: Record<WebSourceId, string> = {
  cmc_web: 'Spot exchange ranking page',
  coingecko_web: 'Trust Score exchange ranking page',
};
const statusLabel: Record<RunStatus, string> = {
  running: 'Collecting',
  success: 'Succeeded',
  failed: 'Failed',
  interrupted: 'Interrupted',
};
const statusTone: Record<RunStatus, string> = {
  running: 'tone-progress',
  success: 'tone-complete',
  failed: 'tone-blocked',
  interrupted: 'tone-pending',
};
async function load() {
  try {
    state.value = await api<SourcesState>('/api/sources');
    error.value = '';
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(load);
const timer = setInterval(() => {
  if (!state.value?.running) return;
  void load().then(() => {
    if (!state.value?.running) void refreshSummary().catch(() => undefined);
  });
}, 2500);
onUnmounted(() => clearInterval(timer));
async function collect(source: WebSourceId) {
  busy.value = true;
  error.value = '';
  try {
    await api('/api/sources/collect', { method: 'POST', body: { source } });
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
  await load();
}
async function schedule() {
  try {
    await api('/api/sources/schedule', { method: 'POST', body: { daily: !state.value?.daily } });
    await load();
  } catch (e) {
    error.value = errorText(e);
  }
}
async function link(org: DirectoryOrganization) {
  const current = mapping.value!;
  mapping.value = undefined;
  try {
    await api(`/api/sources/mappings/${current.id}`, {
      method: 'PATCH',
      body: { organizationId: org.id },
    });
    await load();
    void refreshSummary().catch(() => undefined);
  } catch (e) {
    error.value = errorText(e);
  }
}
const latest = (source: WebSourceId, successOnly = false) =>
  state.value?.runs.find((r) => r.source === source && (!successOnly || r.status === 'success'));
const mappings = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return (state.value?.mappings ?? []).filter((m) => m.name.toLowerCase().includes(needle));
});
</script>
<template>
  <section class="page sources-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ tr('DATA FOUNDATION') }}</p>
        <h1>{{ tr('Data sources') }}</h1>
        <p class="hint">
          {{ tr('Trace every update from the organization back to its original source.') }}
        </p>
      </div>
      <button v-if="isAdmin && state" type="button" class="ghost" @click="schedule">
        <Icon name="clock" :size="16" />
        {{ tr('Daily collection: {0}', [state.daily ? tr('On') : tr('Off')]) }}
      </button>
    </header>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="!state && !error" class="hint">{{ tr('Loading…') }}</p>
    <template v-if="state">
      <div class="source-cards">
        <article
          v-for="source in webSources"
          :key="source"
          class="source-card"
          :aria-label="sourceName(source)"
        >
          <header>
            <div>
              <h2>{{ sourceName(source) }}</h2>
              <small class="hint">{{ tr(pageKind[source]) }}</small>
            </div>
            <span
              class="status-badge"
              :class="latest(source) ? statusTone[latest(source)!.status] : 'tone-neutral'"
            >
              {{
                latest(source) ? tr(statusLabel[latest(source)!.status]) : tr('Awaiting collection')
              }}
            </span>
          </header>
          <div class="collection-numbers">
            <strong>
              {{ latest(source, true)?.rowCount ?? '—' }}
              <small>{{ tr('valid source records') }}</small>
            </strong>
            <div>
              <span class="hint">{{ tr('Last successful collection') }}</span>
              <b>
                {{
                  latest(source, true)?.finishedAt
                    ? dateTime(latest(source, true)!.finishedAt)
                    : tr('No successful batch yet')
                }}
              </b>
              <small class="hint">{{ tr('Top 50 target · Actual coverage recorded') }}</small>
            </div>
          </div>
          <p v-if="latest(source)?.error" class="error">{{ tr(latest(source)!.error!) }}</p>
          <footer>
            <button
              v-if="latest(source, true)?.evidenceId"
              type="button"
              class="link"
              @click="openEvidence(latest(source, true)!.evidenceId)"
            >
              <Icon name="file" :size="15" />
              {{ tr('View original page') }}
            </button>
            <button
              v-if="isAdmin"
              type="button"
              class="ghost collect-now"
              :disabled="busy || state.running"
              @click="collect(source)"
            >
              <Icon name="refresh" :size="15" />
              {{ state.running ? tr('Collection in progress') : tr('Collect now') }}
            </button>
          </footer>
        </article>
      </div>

      <section class="section-card" :aria-label="tr('Collection activity')">
        <div class="section-heading">
          <h2>{{ tr('Collection activity') }}</h2>
          <span class="hint">{{
            tr('A failed run never replaces the last successful data.')
          }}</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ tr('Source') }}</th>
                <th>{{ tr('Time') }}</th>
                <th>{{ tr('Status') }}</th>
                <th>{{ tr('Valid rows') }}</th>
                <th>{{ tr('Details / reference') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in state.runs" :key="run.id">
                <td>{{ sourceName(run.source) }}</td>
                <td>{{ dateTime(run.startedAt) }}</td>
                <td>
                  <span class="status-badge" :class="statusTone[run.status]">
                    {{ tr(statusLabel[run.status]) }}
                  </span>
                </td>
                <td>{{ run.status === 'success' ? run.rowCount : '—' }}</td>
                <td>
                  <span v-if="run.error" class="hint">{{ tr(run.error) }}</span>
                  <button
                    v-if="run.evidenceId"
                    type="button"
                    class="link"
                    @click="openEvidence(run.evidenceId)"
                  >
                    {{ tr('Original page ↗') }}
                  </button>
                </td>
              </tr>
              <tr v-if="!state.runs.length">
                <td colspan="5" class="hint">
                  {{ tr('No collection runs yet. An administrator can start one above.') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="isAdmin" class="section-card" :aria-label="tr('Source identity mappings')">
        <div class="section-heading mapping-heading">
          <div>
            <h2>{{ tr('Source identity mappings') }}</h2>
            <p class="hint">
              {{
                tr(
                  'Source records start independently. Confirm the entity before linking sources to one organization. Original records and history are preserved.',
                )
              }}
            </p>
          </div>
          <input
            v-model="filter"
            type="search"
            :placeholder="tr('Filter source names…')"
            :aria-label="tr('Filter source mappings')"
          />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ tr('Source organization') }}</th>
                <th>{{ tr('Source') }}</th>
                <th>{{ tr('Linked organization') }}</th>
                <th>{{ tr('Review status') }}</th>
                <th>
                  <span class="visually-hidden">{{ tr('Actions') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in mappings" :key="row.id">
                <td>
                  <strong>{{ row.name }}</strong>
                  <small class="hint">{{ row.slug }}</small>
                </td>
                <td>{{ sourceName(row.source) }}</td>
                <td>{{ row.organizationName }}</td>
                <td>
                  <span
                    class="status-badge"
                    :class="row.mappedBy ? 'tone-complete' : 'tone-neutral'"
                  >
                    {{ row.mappedBy ? tr('Reviewed') : tr('Independent source profile') }}
                  </span>
                </td>
                <td>
                  <button type="button" class="link" @click="mapping = row">
                    {{ tr('Review / change mapping →') }}
                  </button>
                </td>
              </tr>
              <tr v-if="!mappings.length">
                <td colspan="5" class="hint">{{ tr('No source profiles match this filter.') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <AppDialog
      v-if="mapping"
      :title="tr('Link to an organization')"
      :eyebrow="`${sourceName(mapping.source)} / ${mapping.name}`"
      @close="mapping = undefined"
    >
      <p class="hint">
        {{
          tr('Selecting an organization saves the mapping. Source observations remain separate.')
        }}
      </p>
      <OrgPicker exchange-only @select="link" />
    </AppDialog>
  </section>
</template>
