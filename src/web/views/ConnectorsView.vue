<script setup lang="ts">
// Connector 看板(frontend-spec 11.6–11.8),从 v1 ConnectorsView.vue 迁移。数据每次直接读 quant 的只读视图
// (proposal §6),没有投影和「Refresh from quant」;页头说明数据截至何时。
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { faces, type Face } from '../../shared/verification-contract';
import type {
  BoardLeaf,
  CellView,
  ConnectorBoard,
  CredentialColumn,
  FaceSummary,
  LeafDetail,
  VenueBoard,
} from '../../shared/integration';
import { fieldOptionLabel } from '../presentation';
const route = useRoute();
const router = useRouter();
const board = ref<ConnectorBoard>();
const venue = ref<VenueBoard>();
const leaf = ref<LeafDetail>();
const error = ref('');
const selectedVenue = computed(() => String(route.query.venue || ''));
const selectedLeaf = computed(() => String(route.query.leaf || ''));
const faceLabels: Record<Face, string> = {
  market: 'Market data',
  wallet: 'Wallet events',
  wallet_action: 'Wallet actions',
  trading: 'Trading',
  transfer: 'Transfers',
  asset_network: 'Assets and networks',
};
async function loadBoard() {
  try {
    board.value = await api<ConnectorBoard>('/api/connectors');
  } catch (e) {
    error.value = errorText(e);
  }
}
async function loadVenue() {
  venue.value = undefined;
  error.value = '';
  if (!selectedVenue.value) return;
  try {
    venue.value = await api<VenueBoard>(
      '/api/connectors/' + encodeURIComponent(selectedVenue.value),
    );
  } catch (e) {
    error.value = errorText(e);
  }
}
async function loadLeaf() {
  leaf.value = undefined;
  if (!selectedVenue.value || !selectedLeaf.value) return;
  try {
    leaf.value = await api<LeafDetail>(
      '/api/connectors/' +
        encodeURIComponent(selectedVenue.value) +
        '/leaves/' +
        encodeURIComponent(selectedLeaf.value),
    );
  } catch (e) {
    error.value = errorText(e);
  }
}
onMounted(loadBoard);
watch(selectedVenue, loadVenue, { immediate: true });
watch(selectedLeaf, loadLeaf, { immediate: true });
const openVenue = (key: string) =>
  void router.push({ path: '/w/internal/connectors', query: { venue: key } });
const openLeaf = (key: string) =>
  void router.push({
    path: '/w/internal/connectors',
    query: { venue: selectedVenue.value, leaf: key },
  });
const closeLeaf = () =>
  void router.push({ path: '/w/internal/connectors', query: { venue: selectedVenue.value } });
const short = (revision: string) => revision.slice(0, 12);
function faceSummary(summary: FaceSummary): string {
  if (!summary.declared) return tr('Not declared');
  return tr('{0} passed · {1} failed · {2} awaiting · {3} unverified', [
    summary.passed,
    summary.failed,
    summary.awaiting,
    summary.unverified + summary.stale,
  ]);
}
function stateText(item: BoardLeaf): string {
  if (item.state === 'awaiting_resource' && item.awaiting.length)
    return tr('Awaiting resource: {0} · {1}', [
      fieldOptionLabel('resourceType', item.awaiting[0]!.resource),
      item.awaiting[0]!.owner || tr('owner not recorded'),
    ]);
  return (
    {
      passed: tr('passed'),
      failed: tr('failed'),
      skipped: tr('skipped'),
      stale: tr('Stale'),
      no_result: tr('No result yet'),
      awaiting_resource: tr('Awaiting resource'),
    }[item.state] || item.state
  );
}
function cellText(cell: CellView | null): string {
  if (!cell) return '—';
  if (cell.status === 'passed' && cell.stale) return tr('Stale');
  return (
    { passed: tr('passed'), failed: tr('failed'), skipped: tr('skipped') }[cell.status] ||
    cell.status
  );
}
function cellClass(cell: CellView | null, item: BoardLeaf) {
  if (!cell) return 'conn-' + (item.state === 'awaiting_resource' ? 'amber' : 'grey');
  if (cell.status === 'failed') return 'conn-red';
  if (cell.status === 'passed' && !cell.stale) return 'conn-green';
  return 'conn-amber';
}
function columnText(column: CredentialColumn): string {
  if (column.accountKind === 'production') return tr('Production accounts are not tracked here');
  if (!column.credentials) return tr('No test account record');
  return (
    fieldOptionLabel('resourceStage', column.credentials.resourceStage) +
    ' · ' +
    (column.credentials.owner || tr('owner not recorded')) +
    ' · ' +
    (column.credentials.accountRefPresent ? tr('account ref recorded') : tr('no account ref'))
  );
}
const columnKey = (column: CredentialColumn) => column.environment + '/' + column.accountKind;
const cellOf = (item: BoardLeaf, column: CredentialColumn) => item.cells[columnKey(column)] ?? null;
</script>
<template>
  <section class="page wide connectors">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ tr('QUANT VERIFICATION') }}</p>
        <h1>{{ tr('Connectors') }}</h1>
        <p class="hint">
          {{
            tr(
              'Declared features and live-test results read from the quant verification views. Colours follow the contract: red = a leaf failed, amber = unverified, stale or awaiting a resource, green = all passed and fresh, grey = not declared.',
            )
          }}
        </p>
      </div>
    </header>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="board" class="hint">
      {{
        board.declaredAt
          ? tr('Data as of: latest declaration {0} · latest verification {1}', [
              dateTime(board.declaredAt),
              board.verifiedAt ? dateTime(board.verifiedAt) : tr('none yet'),
            ])
          : tr('No connector declaration has been recorded by quant yet.')
      }}
      · {{ tr('Stale after {0} days', [board.staleDays]) }}
    </p>
    <template v-if="!selectedVenue">
      <div class="table-wrap">
        <table class="conn-matrix">
          <thead>
            <tr>
              <th>{{ tr('Venue') }}</th>
              <th v-for="face in faces" :key="face">{{ tr(faceLabels[face]) }}</th>
              <th>{{ tr('Declared as of') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in board?.venues || []" :key="item.venueKey">
              <td>
                <button type="button" class="link" @click="openVenue(item.venueKey)">
                  {{ item.venueKey }}
                </button>
                <small>{{ tr('{0} leaves', [item.declaredCount]) }}</small>
              </td>
              <td
                v-for="face in faces"
                :key="face"
                class="conn-cell"
                :class="'conn-' + item.faces[face].color"
                :title="faceSummary(item.faces[face])"
              >
                <span class="conn-dot" aria-hidden="true" />
                {{ faceSummary(item.faces[face]) }}
              </td>
              <td>
                <code>{{ short(item.buildRevision) }}</code>
                <span v-if="item.buildDirty"> · {{ tr('dirty') }}</span>
                <small>{{ dateTime(item.observedAt) }}</small>
              </td>
            </tr>
            <tr v-if="board && !board.venues.length">
              <td :colspan="faces.length + 2" class="hint">
                {{
                  tr(
                    'No connector declarations yet. quant records them when a connector build runs its catalog snapshot.',
                  )
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="board?.alerts.length" class="panel conn-alerts">
        <h3>{{ tr('Needs attention') }}</h3>
        <article v-for="alert in board.alerts" :key="alert.id">
          <strong>{{ alert.title }}</strong>
          <p class="hint">{{ alert.detail }}</p>
        </article>
      </section>
    </template>
    <template v-else-if="venue">
      <button type="button" class="link" @click="router.push('/w/internal/connectors')">
        {{ tr('← All connectors') }}
      </button>
      <section class="panel conn-venue-card">
        <h2>{{ venue.venue.venueKey }}</h2>
        <p class="hint">{{ venue.venue.sourceId }} · {{ venue.venue.cratePath }}</p>
        <dl class="conn-asof">
          <div>
            <dt>{{ tr('Declared') }}</dt>
            <dd>
              <code>{{ venue.venue.buildRevision }}</code>
              <span v-if="venue.venue.buildDirty" class="tag">{{ tr('dirty') }}</span>
              <small>{{ dateTime(venue.venue.observedAt) }}</small>
            </dd>
          </div>
          <div>
            <dt>{{ tr('Verified') }}</dt>
            <dd>
              {{
                venue.venue.verifiedAt
                  ? dateTime(venue.venue.verifiedAt)
                  : tr('No verification result yet')
              }}
            </dd>
          </div>
          <div>
            <dt>{{ tr('Runtime') }}</dt>
            <dd>
              <a
                v-if="venue.grafanaUrl"
                :href="venue.grafanaUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ tr('see Grafana') }}
              </a>
              <span v-else>{{ tr('see Grafana') }}</span>
            </dd>
          </div>
        </dl>
        <p v-if="venue.venue.organizations.length" class="work-actions">
          {{ tr('Organizations') }}:
          <RouterLink
            v-for="org in venue.venue.organizations"
            :key="org.id"
            :to="`/w/internal/organizations/${org.id}/onboarding`"
          >
            {{ org.name }}
          </RouterLink>
        </p>
        <p v-else class="hint">{{ tr('No onboarding record refers to this venue yet.') }}</p>
      </section>
      <div class="table-wrap">
        <table class="conn-tree">
          <thead>
            <tr>
              <th>{{ tr('Feature key') }}</th>
              <th v-for="column in venue.columns" :key="columnKey(column)">
                {{ column.environment }} · {{ tr(column.accountKind) }}
                <small>{{ columnText(column) }}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in venue.faces" :key="group.face">
              <tr class="conn-face-row" :class="'conn-' + group.color">
                <th :colspan="venue.columns.length + 1">
                  <span class="conn-dot" aria-hidden="true" />
                  {{ tr(faceLabels[group.face]) }}
                  <small>{{ faceSummary(group.summary) }} · {{ group.ownerPath }}</small>
                </th>
              </tr>
              <tr v-for="item in group.leaves" :key="item.featureKey">
                <td>
                  <button type="button" class="link" @click="openLeaf(item.featureKey)">
                    {{ item.featureKey }}
                  </button>
                  <small :class="'conn-text-' + item.color">{{ stateText(item) }}</small>
                </td>
                <td
                  v-for="column in venue.columns"
                  :key="columnKey(column)"
                  class="conn-cell"
                  :class="cellClass(cellOf(item, column), item)"
                  :title="cellOf(item, column) ? dateTime(cellOf(item, column)!.observedAt) : ''"
                >
                  {{ cellText(cellOf(item, column)) }}
                </td>
              </tr>
              <tr v-if="!group.leaves.length">
                <td :colspan="venue.columns.length + 1" class="hint">
                  {{ group.summary.declared ? tr('Declared without leaves') : tr('Not declared') }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <section
        v-if="selectedLeaf && leaf"
        class="panel conn-leaf-page"
        :aria-label="leaf.featureKey"
      >
        <header class="work-heading">
          <div>
            <p class="eyebrow">{{ leaf.face ? tr(faceLabels[leaf.face]) : '' }}</p>
            <h3>{{ leaf.featureKey }}</h3>
          </div>
          <button type="button" class="ghost" :aria-label="tr('Close')" @click="closeLeaf">
            ✕
          </button>
        </header>
        <p v-if="leaf.leaf" :class="'conn-text-' + leaf.leaf.color">{{ stateText(leaf.leaf) }}</p>
        <p class="hint">
          {{ tr('Prerequisites') }}:
          {{
            leaf.leaf?.prerequisites.map((p) => fieldOptionLabel('resourceType', p)).join(', ') ||
            tr('none')
          }}
        </p>
        <p class="hint">
          {{ tr('Default owner by scaffold-layout') }}: <code>{{ leaf.ownerPath || '—' }}</code>
        </p>
        <h4>{{ tr('Latest verification rows') }}</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ tr('Environment') }}</th>
                <th>{{ tr('Account kind') }}</th>
                <th>{{ tr('Status') }}</th>
                <th>{{ tr('Observed') }}</th>
                <th>{{ tr('Run') }}</th>
                <th>{{ tr('Build') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in leaf.rows" :key="row.environment + row.accountKind">
                <td>{{ row.environment }}</td>
                <td>{{ tr(row.accountKind) }}</td>
                <td>
                  {{ tr(row.status) }}
                  <small v-if="row.skipReason">{{ row.skipReason }}</small>
                  <small v-if="row.errorText">{{ row.errorText }}</small>
                </td>
                <td>{{ dateTime(row.observedAt) }}</td>
                <td>
                  <code>{{ row.runId }}</code>
                </td>
                <td>
                  <code>{{ short(row.buildRevision) }}</code>
                  <span v-if="row.buildDirty"> · {{ tr('dirty') }}</span>
                </td>
              </tr>
              <tr v-if="!leaf.rows.length">
                <td colspan="6" class="hint">{{ tr('No verification result yet') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h4>{{ tr('Attempts for requests covering this leaf') }}</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ tr('Request') }}</th>
                <th>{{ tr('Suite') }}</th>
                <th>{{ tr('Environment') }}</th>
                <th>{{ tr('Status') }}</th>
                <th>{{ tr('Started') }}</th>
                <th>{{ tr('Build') }}</th>
                <th>{{ tr('Next step') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="attempt in leaf.attempts" :key="attempt.runId">
                <td>
                  <code>{{ attempt.requestId }}</code>
                  <small>{{ attempt.requestedAs }}</small>
                </td>
                <td>{{ attempt.suite }}</td>
                <td>{{ attempt.environment }} · {{ attempt.accountName }}</td>
                <td>
                  {{ attempt.finishedAt ? tr(attempt.status) : tr('running') }}
                  <small>
                    {{ attempt.passedCount }} / {{ attempt.failedCount }} /
                    {{ attempt.skippedCount }}
                  </small>
                </td>
                <td>{{ dateTime(attempt.startedAt) }}</td>
                <td>
                  <code>{{ short(attempt.buildRevision) }}</code>
                  <span v-if="attempt.buildDirty"> · {{ tr('dirty') }}</span>
                </td>
                <td>{{ attempt.blockers.map((b) => b.next_step).join(' · ') }}</td>
              </tr>
              <tr v-if="!leaf.attempts.length">
                <td colspan="7" class="hint">{{ tr('No request has covered this leaf yet.') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <p v-else-if="selectedVenue && !error" class="hint">{{ tr('Loading connector…') }}</p>
  </section>
</template>
