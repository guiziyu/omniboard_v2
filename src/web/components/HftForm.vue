<script setup lang="ts">
// HFT channel 的表单(frontend-spec 12.8):组合级字段与组覆盖表。校验与服务端共用 shared/hft;
// 数值按完整精度显示与输入(文本框,不做缩写)。通过后交给页面(编辑先做改前 / 改后对照)。
import { computed, ref } from 'vue';
import { tr } from '../i18n';
import {
  decimalText,
  fieldLabels,
  fieldProblem,
  fieldRules,
  groupLimitProblem,
  identityProblem,
  parseDecimal,
  settingsProblem,
  sortLimits,
  type HftField,
  type HftSettings,
} from '../../shared/hft';
const props = defineProps<{
  settings?: HftSettings;
  /** 新建时填写 channel 名。 */
  withChannel?: boolean;
  knownGroups: string[];
  busy?: boolean;
  error?: string;
  submitLabel: string;
}>();
const emit = defineEmits<{
  save: [value: { channel: string; settings: HftSettings }];
  close: [];
}>();

const numberFields = [
  'maxActiveGroups',
  'maxPortfolioGrossExposureUsd',
  'maxPortfolioAbsNetExposureUsd',
  'maxWalletGrossToAssetsRatio',
] as const;
const s = props.settings;
const form = ref({
  channel: '',
  portfolioGroup: s?.portfolioGroup ?? '',
  numbers: Object.fromEntries(numberFields.map((f) => [f, s ? decimalText(s[f]) : ''])) as Record<
    (typeof numberFields)[number],
    string
  >,
  limits: (s?.groupLimits ?? []).map((l) => ({
    predictionGroup: l.predictionGroup,
    gross: decimalText(l.maxGrossExposureUsd),
    net: decimalText(l.maxAbsNetExposureUsd),
  })),
});
const num = (text: string) => parseDecimal(text) ?? NaN;
const parsed = computed<HftSettings>(() => ({
  portfolioGroup: form.value.portfolioGroup,
  maxActiveGroups: num(form.value.numbers.maxActiveGroups),
  maxPortfolioGrossExposureUsd: num(form.value.numbers.maxPortfolioGrossExposureUsd),
  maxPortfolioAbsNetExposureUsd: num(form.value.numbers.maxPortfolioAbsNetExposureUsd),
  maxWalletGrossToAssetsRatio: num(form.value.numbers.maxWalletGrossToAssetsRatio),
  groupLimits: form.value.limits.map((l) => ({
    predictionGroup: l.predictionGroup,
    maxGrossExposureUsd: num(l.gross),
    maxAbsNetExposureUsd: num(l.net),
  })),
}));
/** 提交过一次之后显示所有问题;之前只显示已填内容的问题。 */
const tried = ref(false);
const fields = Object.keys(fieldLabels) as HftField[];
const filled = (field: HftField) =>
  field === 'portfolioGroup' ? form.value.portfolioGroup !== '' : form.value.numbers[field] !== '';
const fieldError = (field: HftField) =>
  tried.value || filled(field) ? fieldProblem(field, parsed.value) : null;
const channelError = computed(() =>
  tried.value || form.value.channel ? identityProblem(form.value.channel) : null,
);
const limitError = (i: number) => {
  const row = form.value.limits[i]!;
  if (!tried.value && !row.predictionGroup && !row.gross && !row.net) return null;
  const limits = parsed.value.groupLimits;
  return groupLimitProblem(limits[i]!, limits.slice(0, i));
};
const localError = ref('');
function submit() {
  tried.value = true;
  // 每个问题已显示在对应字段旁,这里只给一句总提示。
  localError.value =
    (props.withChannel && channelError.value) || settingsProblem(parsed.value)
      ? 'Fix the problems marked above.'
      : '';
  if (localError.value) return;
  emit('save', {
    channel: form.value.channel,
    settings: { ...parsed.value, groupLimits: sortLimits(parsed.value.groupLimits) },
  });
}
const groupHint = () =>
  tr(
    'Groups not listed use the per-group limits above. Names are BaseAsset_<asset> or Beta_<name>.',
  );
const addLimit = () => form.value.limits.push({ predictionGroup: '', gross: '', net: '' });
</script>
<template>
  <form class="hft-form" autocomplete="off" @submit.prevent="submit">
    <template v-if="withChannel">
      <label for="h-channel">{{ tr('Config channel') }}</label>
      <input id="h-channel" v-model="form.channel" maxlength="100" />
      <p class="hint">
        {{ tr('The channel name HFT is started with. It cannot be renamed or deleted.') }}
      </p>
      <p v-if="channelError" class="error">{{ tr(channelError) }}</p>
    </template>
    <template v-for="field in fields" :key="field">
      <label :for="`h-${field}`">{{ tr(fieldLabels[field]) }}</label>
      <input
        v-if="field === 'portfolioGroup'"
        :id="`h-${field}`"
        v-model="form.portfolioGroup"
        maxlength="100"
      />
      <input
        v-else
        :id="`h-${field}`"
        v-model="form.numbers[field]"
        inputmode="decimal"
        maxlength="40"
      />
      <p class="hint">{{ tr(fieldRules[field]) }}</p>
      <p v-if="fieldError(field)" class="error">{{ tr(fieldError(field)) }}</p>
    </template>

    <h3>{{ tr('Group overrides') }}</h3>
    <div class="table-wrap">
      <table class="hft-limits">
        <thead>
          <tr>
            <th>{{ tr('Prediction group') }}</th>
            <th>{{ tr('Max gross exposure (USD)') }}</th>
            <th>{{ tr('Max |net| exposure (USD)') }}</th>
            <th>
              <span class="visually-hidden">{{ tr('Remove') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, i) in form.limits" :key="i">
            <tr>
              <td>
                <input
                  v-model="row.predictionGroup"
                  :aria-label="tr('Prediction group {0}', [i + 1])"
                  list="h-groups"
                  maxlength="100"
                  placeholder="BaseAsset_BTC"
                />
              </td>
              <td>
                <input
                  v-model="row.gross"
                  :aria-label="tr('Max gross exposure {0}', [i + 1])"
                  inputmode="decimal"
                  maxlength="40"
                />
              </td>
              <td>
                <input
                  v-model="row.net"
                  :aria-label="tr('Max |net| exposure {0}', [i + 1])"
                  inputmode="decimal"
                  maxlength="40"
                />
              </td>
              <td>
                <button type="button" class="ghost" @click="form.limits.splice(i, 1)">
                  {{ tr('Remove') }}
                </button>
              </td>
            </tr>
            <tr v-if="limitError(i)">
              <td colspan="4" class="error">{{ tr(limitError(i)) }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <datalist id="h-groups">
      <option v-for="g in knownGroups" :key="g" :value="g" />
    </datalist>
    <p class="hint">
      {{ groupHint() }}
    </p>
    <button type="button" class="ghost" @click="addLimit">{{ tr('Add group override') }}</button>

    <p v-if="localError || error" class="error" role="alert">{{ tr(localError || error) }}</p>
    <div class="actions">
      <button type="button" class="ghost" :disabled="busy" @click="emit('close')">
        {{ withChannel ? tr('Cancel') : tr('Discard changes') }}
      </button>
      <button type="submit" :disabled="busy">{{ submitLabel }}</button>
    </div>
  </form>
</template>
