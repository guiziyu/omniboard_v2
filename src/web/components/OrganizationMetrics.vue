<script setup lang="ts">
// 指标快照与详细指标(frontend-spec 4.9),从 v1 OrganizationMetrics.vue 迁移。
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { displayMetric } from '../format';
import { effectiveTags } from '../../shared/tags';
import {
  choosePoint,
  columns as allColumns,
  reportingYear,
  type ColumnDefinition,
  type MetricPoint,
} from '../../shared/columns';
import type { Organization } from '../../shared/types';
import ColumnHelp from './ColumnHelp.vue';
import MetricDialog from './MetricDialog.vue';
const props = defineProps<{
  organization: Organization;
  overview?: boolean;
  recordedOnly?: boolean;
}>();
const router = useRouter();
const columns = computed(() => {
  const tags = effectiveTags(props.organization.tags);
  return allColumns.filter((c) => c.kind === 'metric' && c.tags.some((t) => tags.includes(t)));
});
const points = ref<MetricPoint[]>([]);
const year = ref(reportingYear());
const error = ref('');
const loading = ref(false);
const target = ref<ColumnDefinition>();
const years = computed(() =>
  [
    ...new Set([
      year.value,
      ...Array.from({ length: 16 }, (_, i) => String(new Date().getUTCFullYear() - i)),
    ]),
  ]
    .sort()
    .reverse(),
);
let serial = 0;
async function load() {
  const current = ++serial;
  error.value = '';
  loading.value = true;
  try {
    const result = await api<{ points: MetricPoint[] }>(
      `/api/organizations/${props.organization.id}/metrics`,
    );
    if (current === serial) points.value = result.points;
  } catch (e) {
    if (current === serial) error.value = errorText(e);
  } finally {
    if (current === serial) loading.value = false;
  }
}
watch(() => props.organization.id, load, { immediate: true });
const value = (column: ColumnDefinition) =>
  choosePoint(points.value, column, column.units[0]!, year.value, 'preferred');
const visibleColumns = computed(() =>
  props.overview || props.recordedOnly ? columns.value.filter((c) => value(c)) : columns.value,
);
const unitLabel = (column: ColumnDefinition) =>
  column.units[0] === '/10' || column.units[0] === 'USD' ? '' : tr(column.units[0]);
// 「按此观测排名」:跳到目录(9.2)。
function rank(point: MetricPoint) {
  const column = columns.value.find((c) => c.id === point.columnId)!;
  void router.push({
    path: '/w/internal/organizations',
    query: {
      tag: column.tags[0],
      sort: column.id,
      unit: point.unit,
      year: /^\d{4}$/.test(point.period) ? point.period : year.value,
      basis: point.source,
    },
  });
}
</script>
<template>
  <div class="organization-metrics">
    <div v-if="!overview || columns.some((c) => c.period === 'annual')" class="metric-toolbar">
      <p class="hint">
        {{ tr('Click a value to inspect sources or add a referenced observation.') }}
      </p>
      <label v-if="columns.some((c) => c.period === 'annual')" class="inline-control">
        {{ tr('Reporting year') }}
        <select v-model="year" :aria-label="tr('Profile reporting year')">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </label>
    </div>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="loading" class="hint" role="status">{{ tr('Loading metrics…') }}</p>
    <div v-else-if="!error && !overview" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Metric') }}</th>
            <th>{{ tr('Value') }}</th>
            <th>{{ tr('Period') }}</th>
            <th>{{ tr('Captured') }}</th>
            <th>{{ tr('Reference') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="column in visibleColumns" :key="column.id">
            <td>
              {{ tr(column.title) }}
              <ColumnHelp
                :title="tr(column.title)"
                :description="tr(column.description)"
                :source-url="column.helpUrl"
              />
            </td>
            <td>
              <button type="button" class="link" @click="target = column">
                {{ displayMetric(value(column), true) }}
              </button>
              <small>{{ unitLabel(column) }}</small>
            </td>
            <td>{{ column.period === 'annual' ? year : tr(column.period) }}</td>
            <td>{{ dateTime(value(column)?.capturedAt) }}</td>
            <td>
              <button type="button" class="link" @click="target = column">
                {{ tr(value(column) ? 'Inspect sources' : 'No observation') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!error" class="metric-grid">
      <article v-for="column in visibleColumns" :key="column.id" class="metric-tile">
        <div class="metric-label">
          <span>{{ tr(column.title) }}</span>
          <ColumnHelp
            :title="tr(column.title)"
            :description="tr(column.description)"
            :source-url="column.helpUrl"
          />
        </div>
        <button
          type="button"
          class="metric-value"
          :aria-label="
            tr('{0}: {1} {2}. Inspect sources for {3}', [
              tr(column.title),
              displayMetric(value(column)),
              tr(column.units[0]),
              organization.name,
            ])
          "
          @click="target = column"
        >
          <strong>{{ displayMetric(value(column), true) }}</strong>
          <small>
            {{ unitLabel(column) }}
            <template v-if="column.period === 'annual'">· {{ year }}</template>
          </small>
        </button>
      </article>
    </div>
    <p v-if="!loading && !error && !visibleColumns.length" class="hint">
      {{ tr('No recorded metrics for this period.') }}
    </p>
    <MetricDialog
      v-if="target"
      :organization="organization"
      :column="target"
      :unit="target.units[0]!"
      :year="year"
      basis="preferred"
      :selected-id="value(target)?.id"
      @close="target = undefined"
      @updated="load"
      @rank-by="rank"
    />
  </div>
</template>
