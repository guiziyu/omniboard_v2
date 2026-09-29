<script setup lang="ts">
// 岗位目标与激励(frontend-spec 6.16),从 v1 PositionDrivers.vue 迁移。组织架构侧栏传一个职位,
// 人才库详情传此人所有组织架构职位;没有职位时整块不显示。表单内联,新增和编辑共用。
import { computed, reactive, ref, watch } from 'vue';
import { api, atLeast, errorText, session } from '../api';
import { locale, tr } from '../i18n';
import { openEvidence } from '../evidence';
import {
  driverBasisLabels,
  driverKindLabels,
  driverKinds,
  driverReviewState,
  type DriverTarget,
  type PositionDriver,
  type PositionDriverData,
} from '../../shared/position-drivers';
type Position = {
  id: string;
  organizationId: string;
  title: string;
  personName: string;
  organizationName?: string;
};
const props = defineProps<{ positions: Position[] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const rows = ref<PositionDriver[]>([]);
const loading = ref(false);
const error = ref('');
const saving = ref(false);
const editing = ref(false);
const selectedPosition = ref('');
const editId = ref('');
const revision = ref<number>();
const raw = ref('');
const sourceUrl = ref('');
const attachment = ref<{ filename: string; base64: string }>();
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): PositionDriverData => ({
  kind: 'okr',
  title: '',
  summary: '',
  applicability: 'unknown',
  pressure: 'unknown',
  period: '',
  observedOn: today(),
  validUntil: '',
  state: 'active',
  basis: 'team_report',
  attribution: '',
  uncertainty: '',
  targets: [],
});
const form = reactive<PositionDriverData>(blank());
let serial = 0;
const path = (p: Position) =>
  `/api/organizations/${encodeURIComponent(p.organizationId)}/positions/${encodeURIComponent(p.id)}/drivers`;
async function load() {
  const request = ++serial;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await Promise.all(props.positions.map((p) => api<PositionDriver[]>(path(p))));
    if (request === serial) rows.value = result.flat();
  } catch (e) {
    if (request === serial) error.value = errorText(e);
  } finally {
    if (request === serial) loading.value = false;
  }
}
watch(
  () => props.positions.map((p) => p.id).join(','),
  () => {
    editing.value = false;
    void load();
  },
  { immediate: true },
);
async function edit(row?: PositionDriver) {
  error.value = '';
  editing.value = true;
  editId.value = row?.id ?? '';
  revision.value = row?.revision;
  selectedPosition.value = row?.positionId ?? props.positions[0]?.id ?? '';
  const values = blank();
  if (row)
    for (const key of Object.keys(values) as (keyof PositionDriverData)[])
      (values as Record<string, unknown>)[key] = structuredClone(row[key]);
  Object.assign(form, values);
  raw.value = '';
  sourceUrl.value = '';
  attachment.value = undefined;
  // 编辑时回填原始证据文本和来源 URL;附件不回填,不重新上传就保留原附件。
  if (row) {
    const request = serial;
    try {
      const e = await api<{ text: string | null; evidence: { url: string } }>(
        '/api/evidence/' + encodeURIComponent(row.evidenceId),
      );
      if (request === serial && editId.value === row.id) {
        raw.value = e.text ?? '';
        sourceUrl.value = e.evidence.url;
      }
    } catch (e) {
      error.value = errorText(e);
    }
  }
}
const target = (): DriverTarget => ({
  audience: '',
  metric: '',
  comparison: 'increase_by',
  value: 0,
  unit: '',
  baseline: '',
});
async function fileChanged(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!file.size || file.size > 5_000_000) {
    error.value = tr('Attachments must be between 1 byte and 5 MB.');
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let value = '';
  for (const b of bytes) value += String.fromCharCode(b);
  attachment.value = { filename: file.name, base64: btoa(value) };
}
async function save() {
  const p = props.positions.find((item) => item.id === selectedPosition.value);
  if (!p) return;
  saving.value = true;
  error.value = '';
  try {
    await api(path(p) + (editId.value ? '/' + encodeURIComponent(editId.value) : ''), {
      method: editId.value ? 'PATCH' : 'POST',
      body: {
        data: form,
        rawText: raw.value,
        sourceUrl: sourceUrl.value,
        ...(revision.value ? { revision: revision.value } : {}),
        ...(attachment.value ? { attachment: attachment.value } : {}),
      },
    });
    editing.value = false;
    await load();
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
const prefixes = { increase_by: '+', at_least: '≥ ', at_most: '≤ ', equals: '' };
const amount = (t: DriverTarget) =>
  prefixes[t.comparison] + new Intl.NumberFormat(locale.value).format(t.value);
const scope = (v: PositionDriverData['applicability']) =>
  tr(
    {
      personal: 'Personal target / motivation',
      role_policy: 'Role policy · personal applicability unconfirmed',
      unknown: 'Applicability unknown',
    }[v],
  );
</script>
<template>
  <section v-if="positions.length" class="position-drivers" :aria-label="tr('Goals & incentives')">
    <header class="driver-heading">
      <h4>{{ tr('Goals & incentives') }}</h4>
      <button v-if="canEdit && !editing" type="button" class="link" @click="edit()">
        + {{ tr('Add insight') }}
      </button>
    </header>
    <p class="hint">
      {{ tr('Tied to this person’s role, not carried over to another employer.') }}
    </p>
    <p v-if="loading" class="hint">{{ tr('Loading…') }}</p>
    <p v-else-if="!rows.length && !editing" class="hint">
      {{ tr('No goal or incentive information recorded.') }}
    </p>
    <article
      v-for="d in rows"
      :key="d.id"
      class="driver-card"
      :class="['driver-' + d.kind, { 'driver-retired': d.state === 'retired' }]"
    >
      <div class="driver-meta">
        <strong>{{ tr(driverKindLabels[d.kind]) }}</strong>
        <span>{{ tr(driverReviewState(d, today())) }}</span>
      </div>
      <h5>{{ d.title }}</h5>
      <p class="hint">{{ d.personName }} · {{ d.roleTitle }} · {{ d.organizationName }}</p>
      <span class="driver-scope">{{ scope(d.applicability) }}</span>
      <p class="preserve-lines">{{ d.summary }}</p>
      <p v-if="d.pressure === 'none_reported'" class="driver-no-target">
        {{ tr('No KPI pressure reported') }}
      </p>
      <div v-if="d.targets.length" class="driver-targets">
        <div v-for="(t, i) in d.targets" :key="i" class="driver-target">
          <small>{{ t.audience }}</small>
          <strong class="driver-value">{{ amount(t) }}</strong>
          <span>{{ t.metric }} · {{ t.unit || tr('Unit not specified') }}</span>
          <small v-if="t.baseline">{{ tr('Comparison baseline') }}: {{ t.baseline }}</small>
        </div>
      </div>
      <p v-if="d.period" class="hint">{{ tr('Target period') }}: {{ d.period }}</p>
      <p v-if="d.uncertainty" class="driver-caveat">{{ d.uncertainty }}</p>
      <details>
        <summary>{{ tr('Source & validity') }}</summary>
        <p>{{ tr(driverBasisLabels[d.basis]) }} · {{ d.attribution }}</p>
        <p>
          {{ tr('Learned on') }}: {{ d.observedOn }} ·
          {{ d.validUntil ? tr('Review by') + ': ' + d.validUntil : tr('Expiry not specified') }}
        </p>
        <p class="hint">{{ tr('A reported statement is not independent verification.') }}</p>
        <div class="driver-actions">
          <button type="button" class="link" @click="openEvidence(d.evidenceId)">
            {{ tr('View evidence') }}
          </button>
          <button
            v-if="d.attachmentEvidenceId"
            type="button"
            class="link"
            @click="openEvidence(d.attachmentEvidenceId)"
          >
            {{ tr('Original attachment') }}
          </button>
          <button v-if="canEdit" type="button" class="link" @click="edit(d)">
            {{ tr('Edit') }} · v{{ d.revision }}
          </button>
        </div>
      </details>
    </article>
    <form v-if="editing" class="driver-form" @submit.prevent="save">
      <h5>{{ editId ? tr('Edit insight') : tr('Add insight') }}</h5>
      <label>
        {{ tr('Linked position') }}
        <select v-model="selectedPosition" :disabled="!!editId" required>
          <option v-for="p in positions" :key="p.id" :value="p.id">
            {{ p.personName }} · {{ p.title }} · {{ p.organizationName }}
          </option>
        </select>
      </label>
      <div class="form-grid">
        <label>
          {{ tr('Type') }}
          <select v-model="form.kind">
            <option v-for="k in driverKinds" :key="k" :value="k">
              {{ tr(driverKindLabels[k]) }}
            </option>
          </select>
        </label>
        <label>
          {{ tr('Applicability') }}
          <select v-model="form.applicability">
            <option
              v-for="s in ['unknown', 'personal', 'role_policy'] as const"
              :key="s"
              :value="s"
            >
              {{ scope(s) }}
            </option>
          </select>
        </label>
      </div>
      <label>
        {{ tr('Title') }}
        <input v-model="form.title" required maxlength="160" />
      </label>
      <label>
        {{ tr('Summary') }}
        <textarea v-model="form.summary" required maxlength="4000" rows="3" />
      </label>
      <div class="form-grid">
        <label>
          {{ tr('KPI pressure') }}
          <select v-model="form.pressure">
            <option value="unknown">{{ tr('Unknown') }}</option>
            <option value="none_reported">{{ tr('No KPI pressure reported') }}</option>
            <option value="target_reported">{{ tr('Target reported') }}</option>
          </select>
        </label>
        <label>
          {{ tr('Target period') }}
          <input v-model="form.period" maxlength="100" />
        </label>
      </div>
      <fieldset v-for="(t, i) in form.targets" :key="i" class="driver-target-editor">
        <legend>{{ tr('Quantitative target') }} {{ i + 1 }}</legend>
        <label>
          {{ tr('Applies to') }}
          <input v-model="t.audience" required maxlength="300" />
        </label>
        <label>
          {{ tr('Metric') }}
          <input v-model="t.metric" required maxlength="200" />
        </label>
        <div class="form-grid">
          <label>
            {{ tr('Comparison') }}
            <select v-model="t.comparison">
              <option value="increase_by">{{ tr('Increase by') }}</option>
              <option value="at_least">≥</option>
              <option value="at_most">≤</option>
              <option value="equals">=</option>
            </select>
          </label>
          <label>
            {{ tr('Target value') }}
            <input v-model.number="t.value" type="number" min="0" step="any" required />
          </label>
        </div>
        <label>
          {{ tr('Unit') }}
          <input v-model="t.unit" maxlength="60" :placeholder="tr('Leave blank if unknown')" />
        </label>
        <label>
          {{ tr('Comparison baseline') }}
          <input v-model="t.baseline" maxlength="300" />
        </label>
        <button type="button" class="link" @click="form.targets.splice(i, 1)">
          {{ tr('Remove target') }}
        </button>
      </fieldset>
      <button
        v-if="form.targets.length < 10"
        type="button"
        class="link"
        @click="form.targets.push(target())"
      >
        + {{ tr('Quantitative target') }}
      </button>
      <div class="form-grid">
        <label>
          {{ tr('Source type') }}
          <select v-model="form.basis">
            <option v-for="(label, key) in driverBasisLabels" :key="key" :value="key">
              {{ tr(label) }}
            </option>
          </select>
        </label>
        <label>
          {{ tr('Reported by / source') }}
          <input v-model="form.attribution" required maxlength="300" />
        </label>
        <label>
          {{ tr('Learned on') }}
          <input v-model="form.observedOn" type="date" required />
        </label>
        <label>
          {{ tr('Review by') }}
          <input v-model="form.validUntil" type="date" :min="form.observedOn" />
        </label>
      </div>
      <label>
        {{ tr('Unknowns / limitations') }}
        <textarea v-model="form.uncertainty" maxlength="4000" rows="2" />
      </label>
      <label>
        {{ tr('Original evidence') }}
        <textarea v-model="raw" required maxlength="100000" rows="4" />
      </label>
      <label>
        {{ tr('Source URL (optional)') }}
        <input v-model="sourceUrl" type="url" maxlength="2000" />
      </label>
      <label>
        {{ tr('Original attachment') }}
        <input type="file" @change="fileChanged" />
      </label>
      <label>
        {{ tr('Status') }}
        <select v-model="form.state">
          <option value="active">{{ tr('Active') }}</option>
          <option value="retired">{{ tr('Retired') }}</option>
        </select>
      </label>
      <div class="actions">
        <button type="button" class="ghost" :disabled="saving" @click="editing = false">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="saving">{{ tr(saving ? 'Saving…' : 'Save') }}</button>
      </div>
    </form>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
  </section>
</template>
