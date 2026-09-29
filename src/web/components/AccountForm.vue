<script setup lang="ts">
// 新建与编辑交易账户的表单(frontend-spec 12.7)。校验与服务端共用 shared/accounts;通过后交给页面
// (编辑先做改前 / 改后对照)。密钥输入不进草稿,由页面在提交后清空。
import { computed, ref, watch } from 'vue';
import { api } from '../api';
import { tr } from '../i18n';
import {
  authIdOf,
  exchanges,
  flagLabels,
  settingsOf,
  settingsProblem,
  whitelistProblems,
  type AccountDetail,
  type AccountOptions,
  type AccountSettings,
} from '../../shared/accounts';
export type AccountDraft = {
  exchange: string;
  accountName: string;
  settings: AccountSettings;
  ipWhitelist: string[];
  owner: string;
  onboardingRecordId: string;
};
export type Secrets = { apiKey: string; apiSecret: string; apiPass: string };
const props = defineProps<{
  account?: AccountDetail;
  /** 从对照页返回或保存失败时,恢复上次填的内容。 */
  draft?: AccountDraft;
  busy?: boolean;
  error?: string;
}>();
const secrets = defineModel<Secrets>('secrets', { required: true });
const emit = defineEmits<{ save: [draft: AccountDraft]; close: [] }>();
const editing = !!props.account;
const initial = props.account ? settingsOf(props.account.tags) : null;
const form = ref<{
  exchange: string;
  accountName: string;
  settings: AccountSettings;
  whitelist: string;
  owner: string;
  onboardingRecordId: string;
}>({
  exchange: props.account?.exchange ?? '',
  accountName: props.account?.accountName ?? '',
  settings: props.draft?.settings ??
    initial ?? {
      type: 'live',
      portfolioGroup: '',
      initializing: false,
      unified: false,
      lowLatency: false,
      arbitrage: false,
      additionalLeverage: false,
      vipLevel: null,
      marketMakerLevel: null,
      clientName: '',
    },
  whitelist: (props.draft?.ipWhitelist ?? props.account?.ipWhitelist ?? []).join('\n'),
  owner: props.draft?.owner ?? props.account?.owner ?? '',
  onboardingRecordId: '',
});
const options = ref<AccountOptions>({ egressIps: [], portfolioGroups: [], onboarding: [] });
const egressChoice = ref('');
async function loadOptions() {
  const query = !editing && form.value.exchange ? `?exchange=${form.value.exchange}` : '';
  options.value = await api<AccountOptions>(`/api/accounts/options${query}`).catch(
    () => options.value,
  );
  form.value.onboardingRecordId = '';
}
watch(() => form.value.exchange, loadOptions, { immediate: true });

const ips = computed(() =>
  form.value.whitelist
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);
const ipProblems = computed(() => whitelistProblems(ips.value, form.value.settings.type));
const trimmedName = computed(() => form.value.accountName.trim());
const localError = ref('');
function addEgress() {
  if (!egressChoice.value || ips.value.includes(egressChoice.value)) return;
  form.value.whitelist = [...ips.value, egressChoice.value].join('\n');
  egressChoice.value = '';
}
const level = (value: unknown) => (value === '' || value === null ? null : Number(value));
function submit() {
  const settings: AccountSettings = {
    ...form.value.settings,
    portfolioGroup: form.value.settings.portfolioGroup.trim(),
    clientName: form.value.settings.clientName.trim(),
    vipLevel: level(form.value.settings.vipLevel),
    marketMakerLevel: level(form.value.settings.marketMakerLevel),
  };
  localError.value =
    settingsProblem(settings) ||
    (ipProblems.value.lines.size ? 'Fix the IP whitelist.' : ipProblems.value.empty);
  if (localError.value) return;
  emit('save', {
    exchange: form.value.exchange,
    accountName: trimmedName.value,
    settings,
    ipWhitelist: ips.value,
    owner: form.value.owner.trim(),
    onboardingRecordId: form.value.onboardingRecordId,
  });
}
const typeChoices = [
  ['live', 'Live'],
  ['test', 'Test'],
  ['read-only', 'Read-only'],
] as const;
</script>
<template>
  <form autocomplete="off" @submit.prevent="submit">
    <template v-if="!editing">
      <label for="a-exchange">{{ tr('Exchange') }}</label>
      <select id="a-exchange" v-model="form.exchange" required>
        <option value="" disabled>{{ tr('Choose an exchange') }}</option>
        <option v-for="x in exchanges" :key="x" :value="x">{{ x }}</option>
      </select>
      <label for="a-name">{{ tr('Account name') }}</label>
      <input id="a-name" v-model="form.accountName" maxlength="100" required />
      <p class="hint">
        {{ tr('Auth ID:') }}
        <code>{{ form.exchange && trimmedName ? authIdOf(form.exchange, trimmedName) : '—' }}</code>
      </p>
    </template>
    <p v-else>
      {{ form.exchange }} · <code>{{ account!.authId }}</code>
    </p>

    <fieldset>
      <legend>{{ tr('Account type') }}</legend>
      <label v-for="[value, label] in typeChoices" :key="value" class="choice">
        <input v-model="form.settings.type" type="radio" name="account-type" :value="value" />
        <span>{{ tr(label) }}</span>
      </label>
    </fieldset>
    <label for="a-group">{{ tr('Portfolio group') }}</label>
    <input id="a-group" v-model="form.settings.portfolioGroup" maxlength="100" list="a-groups" />
    <datalist id="a-groups">
      <option v-for="g in options.portfolioGroups" :key="g" :value="g" />
    </datalist>
    <fieldset>
      <legend>{{ tr('Other tags') }}</legend>
      <label v-for="(pair, key) in flagLabels" :key="key" class="choice">
        <input v-model="form.settings[key]" type="checkbox" />
        <span>{{ tr(pair[1]) }}</span>
      </label>
    </fieldset>
    <label for="a-vip">{{ tr('VIP level') }}</label>
    <input id="a-vip" v-model="form.settings.vipLevel" type="number" min="0" max="255" step="1" />
    <label for="a-mm">{{ tr('Market maker level') }}</label>
    <input
      id="a-mm"
      v-model="form.settings.marketMakerLevel"
      type="number"
      min="0"
      max="255"
      step="1"
    />
    <label for="a-client">{{ tr('Client name') }}</label>
    <input id="a-client" v-model="form.settings.clientName" maxlength="100" />

    <label for="a-ips">{{ tr('IP whitelist') }}</label>
    <textarea
      id="a-ips"
      v-model="form.whitelist"
      rows="3"
      :placeholder="tr('One IPv4 or IPv6 address per line')"
    />
    <p v-for="[line, message] in ipProblems.lines" :key="line" class="error">
      {{ tr('Line {0}: {1}', [line + 1, tr(message)]) }}
    </p>
    <div v-if="options.egressIps.length" class="inline-control">
      <label for="a-egress" class="visually-hidden">{{ tr('Known egress IP') }}</label>
      <select id="a-egress" v-model="egressChoice">
        <option value="">{{ tr('Known egress IPs') }}</option>
        <option v-for="e in options.egressIps" :key="e.ip" :value="e.ip">
          {{ e.ip }}{{ e.label ? ` — ${e.label}` : '' }}
        </option>
      </select>
      <button type="button" class="ghost" :disabled="!egressChoice" @click="addEgress">
        {{ tr('Add known egress IP') }}
      </button>
    </div>

    <template v-if="!editing">
      <label for="a-key">{{ tr('API key') }}</label>
      <input id="a-key" v-model="secrets.apiKey" type="password" autocomplete="off" required />
      <label for="a-secret">{{ tr('API secret') }}</label>
      <input
        id="a-secret"
        v-model="secrets.apiSecret"
        type="password"
        autocomplete="off"
        required
      />
      <label for="a-pass">{{ tr('Passphrase') }}</label>
      <input id="a-pass" v-model="secrets.apiPass" type="password" autocomplete="off" />
      <label for="a-onboarding">{{ tr('Link onboarding record') }}</label>
      <select id="a-onboarding" v-model="form.onboardingRecordId">
        <option value="">{{ tr('None') }}</option>
        <option v-for="o in options.onboarding" :key="o.recordId" :value="o.recordId">
          {{ o.organizationName }} · {{ o.title }}
        </option>
      </select>
    </template>
    <label for="a-owner">{{ tr('Owner') }}</label>
    <input id="a-owner" v-model="form.owner" maxlength="100" />

    <p v-if="localError || error" class="error" role="alert">{{ tr(localError || error) }}</p>
    <div class="actions">
      <button type="button" class="ghost" :disabled="busy" @click="emit('close')">
        {{ tr('Cancel') }}
      </button>
      <button type="submit" :disabled="busy">
        {{ editing ? tr('Review changes') : tr('Save') }}
      </button>
    </div>
  </form>
</template>
