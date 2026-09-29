<script setup lang="ts">
// 数据浏览器与添加团队观测(frontend-spec 9.2、9.3),从 v1 MetricDialog.vue 迁移。
import { computed, reactive, ref, watch } from 'vue';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { displayMetric } from '../format';
import { openEvidence } from '../evidence';
import {
  metricPeriod,
  selectionPolicy,
  type ColumnDefinition,
  type MetricBasis,
  type MetricPoint,
} from '../../shared/columns';
import AppDialog from './AppDialog.vue';
type Match = { linkId: string; profileName: string; organizationId: string; points: MetricPoint[] };
const props = defineProps<{
  organization: { id: string; name: string };
  column: ColumnDefinition;
  unit: string;
  year: string;
  basis: MetricBasis;
  selectedId?: string;
  rank?: number | null;
}>();
const emit = defineEmits<{ close: []; updated: []; rankBy: [point: MetricPoint] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const isAdmin = computed(() => session.user?.role === 'admin');
const points = ref<MetricPoint[]>([]);
const candidates = ref<Match[]>([]);
const loading = ref(true);
const error = ref('');
const editing = ref(false);
const saving = ref(false);
const linking = ref(false);
const period = computed(() => metricPeriod(props.column, props.year));
const form = reactive({
  value: '',
  qualifier: 'exact',
  unit: props.unit,
  period: period.value,
  sourceName: '',
  sourceUrl: '',
  assumptions: '',
  rawText: '',
});
const relevant = computed(() => points.value.filter((p) => p.columnId === props.column.id));
const matches = computed(() =>
  candidates.value.flatMap((match) =>
    match.points
      .filter((point) => point.columnId === props.column.id)
      .map((point) => ({ ...point, linkId: match.linkId, profileName: match.profileName })),
  ),
);
let version = 0;
async function load() {
  const current = ++version;
  loading.value = true;
  try {
    const result = await api<{ points: MetricPoint[]; candidates: Match[] }>(
      `/api/organizations/${props.organization.id}/metrics`,
    );
    if (current !== version) return;
    points.value = result.points;
    candidates.value = result.candidates;
  } catch (e) {
    if (current === version) error.value = errorText(e);
  } finally {
    if (current === version) loading.value = false;
  }
}
watch(() => [props.organization.id, props.column.id], load, { immediate: true });
const eligible = (point: MetricPoint) => point.unit === props.unit && point.period === period.value;
async function save() {
  saving.value = true;
  error.value = '';
  try {
    await api(`/api/organizations/${props.organization.id}/metrics`, {
      method: 'POST',
      body: { columnId: props.column.id, ...form },
    });
    editing.value = false;
    await load();
    emit('updated');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
async function linkSource(linkId: string) {
  linking.value = true;
  error.value = '';
  try {
    await api(`/api/sources/mappings/${linkId}`, {
      method: 'PATCH',
      body: { organizationId: props.organization.id },
    });
    await load();
    emit('updated');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    linking.value = false;
  }
}
const unitText = (point: MetricPoint) => (point.unit === '/10' ? '' : tr(point.unit));
</script>
<template>
  <AppDialog
    :eyebrow="tr('{0} / DATA EXPLORER', [organization.name])"
    :title="tr(column.title)"
    :busy="saving || linking"
    wide
    @close="emit('close')"
  >
    <p class="metric-context">
      <span class="tag">{{ tr(unit) }}</span>
      <span class="tag">{{ tr(period) }}</span>
      <span v-if="rank" class="tag">{{ tr('Rank #{0}', [rank]) }}</span>
    </p>
    <p>{{ tr(column.description) }}</p>
    <div class="policy">
      <strong>{{ tr('How this value is selected') }}</strong>
      <p>
        {{
          tr(
            '{0} Use the latest observation within each source for this unit and period. Different currencies and years are not mixed. Values are never averaged.',
            [tr(selectionPolicy(column, basis))],
          )
        }}
      </p>
    </div>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="loading" class="hint">{{ tr('Loading observations…') }}</p>
    <template v-else>
      <article
        v-for="point in relevant"
        :key="point.id"
        class="observation"
        :class="{ chosen: point.id === selectedId }"
      >
        <header>
          <strong>{{ point.sourceName }}</strong>
          <span v-if="point.id === selectedId" class="tag">{{ tr('Displayed value') }}</span>
          <span v-else-if="!eligible(point)" class="tag">
            {{ tr('Different {0}', [point.unit !== unit ? tr('unit') : tr('period')]) }}
          </span>
          <span v-else class="tag">{{ tr('Alternative observation') }}</span>
        </header>
        <p class="observation-value">
          <strong :title="point.value">{{ displayMetric(point) }}</strong>
          {{ unitText(point) }} · {{ tr(point.period) }}
        </p>
        <p>{{ point.assumptions }}</p>
        <small>
          {{ tr('Captured {0} · Recorded number: {1}', [dateTime(point.capturedAt), point.value]) }}
        </small>
        <footer class="actions wrap">
          <button type="button" class="link" @click="openEvidence(point.evidenceId)">
            {{ tr('Original reference') }}
          </button>
          <a
            v-if="point.sourceUrl"
            :href="point.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            >{{ tr('Source page') }} ↗</a
          >
          <button type="button" class="ghost" @click="emit('rankBy', point)">
            {{ tr('Rank using this basis') }}
          </button>
        </footer>
      </article>
      <div v-if="!relevant.length" class="empty">
        <h3>{{ tr('No observation recorded') }}</h3>
        <p>
          {{
            tr(
              'Add a sourced value with its reporting period and assumptions. Missing data is never treated as zero.',
            )
          }}
        </p>
      </div>
      <p v-else class="hint">
        {{ tr('Only observations saved for this organization are used in its rankings.') }}
      </p>
      <section v-if="matches.length">
        <h3>{{ tr('Other source matches') }}</h3>
        <p class="hint">
          {{
            tr(
              "Same-name profiles awaiting identity review. These observations are excluded from this organization's values and rankings until an administrator links the source.",
            )
          }}
        </p>
        <article v-for="point in matches" :key="point.id" class="observation">
          <header>
            <strong>{{ point.sourceName }} · {{ point.profileName }}</strong>
            <span class="tag">{{ tr('Identity not confirmed') }}</span>
          </header>
          <p class="observation-value">
            <strong>{{ displayMetric(point) }}</strong> {{ unitText(point) }} ·
            {{ tr(point.period) }}
          </p>
          <p>{{ point.assumptions }}</p>
          <small>
            {{
              tr('Captured {0} · Recorded number: {1}', [dateTime(point.capturedAt), point.value])
            }}
          </small>
          <footer class="actions wrap">
            <button type="button" class="link" @click="openEvidence(point.evidenceId)">
              {{ tr('Original reference') }}
            </button>
            <a :href="point.sourceUrl" target="_blank" rel="noopener noreferrer"
              >{{ tr('Source page') }} ↗</a
            >
            <button
              v-if="isAdmin"
              type="button"
              class="ghost"
              :disabled="linking"
              @click="linkSource(point.linkId)"
            >
              {{ linking ? tr('Linking…') : tr('Confirm identity and link') }}
            </button>
          </footer>
        </article>
      </section>
    </template>
    <button v-if="canEdit && !editing" type="button" class="ghost" @click="editing = true">
      {{ tr('Add observation') }}
    </button>
    <form v-if="editing" class="metric-entry" @submit.prevent="save">
      <h3>{{ tr('Record a sourced value') }}</h3>
      <div class="form-grid">
        <label>
          {{ tr('Value') }}
          <input
            v-model="form.value"
            inputmode="decimal"
            pattern="(?:0|[1-9][0-9]{0,29})(?:[.][0-9]{1,18})?"
            required
            :placeholder="tr('Number, without separators')"
          />
        </label>
        <label>
          {{ tr('Unit') }}
          <select v-model="form.unit">
            <option v-for="option in column.units" :key="option" :value="option">
              {{ tr(option) }}
            </option>
          </select>
        </label>
      </div>
      <label>
        {{ tr('Number qualifier') }}
        <select v-model="form.qualifier">
          <option value="exact">{{ tr('Exact') }}</option>
          <option value="at_least">{{ tr('At least (≥)') }}</option>
          <option value="at_most">{{ tr('Up to (≤)') }}</option>
          <option value="more_than">{{ tr('More than (>)') }}</option>
          <option value="approximately">{{ tr('Approximately (≈)') }}</option>
        </select>
      </label>
      <label v-if="column.period === 'annual'">
        {{ tr('Reporting year') }}
        <input v-model="form.period" pattern="(?:19|20|21)[0-9]{2}" required placeholder="2025" />
      </label>
      <label>
        {{ tr('Source name') }}
        <input
          v-model="form.sourceName"
          required
          maxlength="160"
          :placeholder="tr('e.g. Annual report or national statistics office')"
        />
      </label>
      <label>
        {{ tr('Source URL (optional)') }}
        <input v-model="form.sourceUrl" type="url" maxlength="2000" placeholder="https://…" />
      </label>
      <label>
        {{ tr('Scope and assumptions') }}
        <textarea
          v-model="form.assumptions"
          required
          rows="3"
          maxlength="3000"
          :placeholder="tr(column.description)"
        />
      </label>
      <label>
        {{ tr('Original reference text') }}
        <textarea
          v-model="form.rawText"
          required
          rows="3"
          maxlength="100000"
          :placeholder="tr('Paste the original excerpt, including its date and reporting scope.')"
        />
      </label>
      <p class="hint">
        {{ tr('A new observation preserves previous values and their original references.') }}
      </p>
      <div class="actions">
        <button type="button" class="ghost" :disabled="saving" @click="editing = false">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="saving">
          {{ saving ? tr('Saving…') : tr('Save observation') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
