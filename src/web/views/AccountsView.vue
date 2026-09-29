<script setup lang="ts">
// 交易账户(frontend-spec 12.7):trader 与 admin。影响实盘的操作(新建、编辑、轮换、停用)直接提交,当场确认
// (12.4)暂缓;出错时留在原对话框且内容不丢。密钥输入提交后清空,界面从不显示密钥。
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { formatTime } from '../format';
import { tr } from '../i18n';
import { auditActionLabels } from '../../shared/audit';
import AppDialog from '../components/AppDialog.vue';
import AccountForm, { type AccountDraft, type Secrets } from '../components/AccountForm.vue';
import {
  authIdOf,
  flagLabels,
  settingsOf,
  statusLabel,
  tagName,
  type Account,
  type AccountDetail,
  type AccountSettings,
  type AccountStatus,
  type AccountTag,
  type EgressIp,
} from '../../shared/accounts';

const route = useRoute();
const router = useRouter();
const locale = computed(() => session.user?.locale ?? 'en');
const isAdmin = computed(() => session.user?.role === 'admin');
const accounts = ref<Account[]>([]);
const loadError = ref('');
async function load() {
  try {
    accounts.value = await api<Account[]>('/api/accounts');
    loadError.value = '';
  } catch (e) {
    loadError.value = errorText(e);
  }
}

// ---- 列表与筛选 ----
const filters = ref({ exchange: '', status: '', group: '', q: '', showTerminated: false });
const groupOf = (a: { tags: AccountTag[] }) => settingsOf(a.tags).portfolioGroup;
const groups = computed(() => [...new Set(accounts.value.map(groupOf).filter(Boolean))].sort());
const accountExchanges = computed(() => [...new Set(accounts.value.map((a) => a.exchange))].sort());
const shown = computed(() => {
  const f = filters.value;
  const q = f.q.trim().toLowerCase();
  return accounts.value.filter(
    (a) =>
      (f.showTerminated || f.status === 'terminated' || a.status !== 'terminated') &&
      (!f.exchange || a.exchange === f.exchange) &&
      (!f.status || a.status === f.status) &&
      (!f.group || groupOf(a) === f.group) &&
      (!q || a.accountName.toLowerCase().includes(q) || (a.owner ?? '').toLowerCase().includes(q)),
  );
});
const statusChoices = Object.entries(statusLabel) as [AccountStatus, string][];
/** Status 与 Portfolio group 之外的标签。 */
function otherTags(account: { tags: AccountTag[]; status: AccountStatus }): string[] {
  const labels: Record<string, string> = Object.fromEntries(
    Object.values(flagLabels).map(([tag, label]) => [tag, label]),
  );
  return account.tags.flatMap((tag): string[] => {
    const name = tagName(tag);
    if (['Terminated', 'ReadOnly', 'Test', 'PortfolioGroup'].includes(name)) return [];
    if (name === 'Initializing' && account.status === 'initializing') return [];
    const value = typeof tag === 'object' ? tag[name] : undefined;
    if (name === 'VipLevel') return [tr('VIP {0}', [value])];
    if (name === 'MarketMakerLevel') return [tr('Market maker {0}', [value])];
    if (name === 'Client')
      return [tr('Client: {0}', [(value as { client_name: string }).client_name])];
    if (name === 'WalletBlocked') return [tr('Wallet blocked')];
    if (name === 'ListingTagBlocklist') return [tr('Listing blocklist')];
    return [labels[name] ? tr(labels[name]) : name];
  });
}
const keyText = (fp: string | null) => (fp ? fp.slice(0, 8) : tr('Entered before v2'));

// ---- 详情抽屉(?account=)----
const detail = ref<AccountDetail | null>(null);
const detailError = ref('');
async function openDetail() {
  const authId = route.query.account ? String(route.query.account) : '';
  detailError.value = '';
  if (!authId) {
    detail.value = null;
    return;
  }
  try {
    detail.value = await api<AccountDetail>(`/api/accounts/${encodeURIComponent(authId)}`);
  } catch (e) {
    detail.value = null;
    detailError.value = errorText(e);
  }
}
const show = (authId: string | null) =>
  router.replace({ query: authId ? { ...route.query, account: authId } : {} });
watch(() => route.query.account, openDetail);
onMounted(async () => {
  await load();
  await openDetail();
});
const compact = (value: unknown) =>
  value === null || value === undefined ? '—' : JSON.stringify(value);

// ---- 提交 ----
const secrets = ref<Secrets>({ apiKey: '', apiSecret: '', apiPass: '' });
const clearSecrets = () => (secrets.value = { apiKey: '', apiSecret: '', apiPass: '' });
const busy = ref(false);
/** 提交一次影响实盘的操作;不论成败都清空密钥输入(12.7),错误交给原对话框显示。 */
async function submit(run: () => Promise<void>, fail: (message: string) => void) {
  busy.value = true;
  try {
    await run();
  } catch (e) {
    fail(errorText(e));
  } finally {
    clearSecrets();
    busy.value = false;
  }
}

// ---- 新建 ----
const adding = ref(false);
const addError = ref('');
function add(draft: AccountDraft) {
  addError.value = '';
  const authId = authIdOf(draft.exchange, draft.accountName);
  void submit(
    async () => {
      await api('/api/accounts', {
        method: 'POST',
        body: {
          exchange: draft.exchange,
          accountName: draft.accountName,
          settings: draft.settings,
          ipWhitelist: draft.ipWhitelist,
          owner: draft.owner,
          ...secrets.value,
          ...(draft.onboardingRecordId ? { onboardingRecordId: draft.onboardingRecordId } : {}),
        },
      });
      adding.value = false;
      await load();
      await show(authId);
    },
    (message) => (addError.value = message),
  );
}

// ---- 编辑:先看改前 / 改后,再确认 ----
const editing = ref<AccountDetail | null>(null);
const editError = ref('');
/** 编辑表单上次的内容:从对照页返回或保存失败后恢复。 */
const lastDraft = ref<AccountDraft | undefined>();
const review = ref<{
  draft: AccountDraft;
  rows: { field: string; before: string; after: string }[];
} | null>(null);
const settingLabels: [keyof AccountSettings, string][] = [
  ['type', 'Account type'],
  ['portfolioGroup', 'Portfolio group'],
  ...Object.entries(flagLabels).map(
    ([key, [, label]]) => [key, label] as [keyof AccountSettings, string],
  ),
  ['vipLevel', 'VIP level'],
  ['marketMakerLevel', 'Market maker level'],
  ['clientName', 'Client name'],
];
function reviewEdit(draft: AccountDraft) {
  const account = editing.value!;
  const before = settingsOf(account.tags);
  const types: Record<string, string> = { live: 'Live', test: 'Test', 'read-only': 'Read-only' };
  const text = (v: unknown) =>
    v === null || v === ''
      ? '—'
      : typeof v === 'boolean'
        ? v
          ? tr('Yes')
          : tr('No')
        : types[String(v)]
          ? tr(types[String(v)]!)
          : String(v);
  const rows = settingLabels
    .filter(([key]) => before[key] !== draft.settings[key])
    .map(([key, field]) => ({
      field: tr(field),
      before: text(before[key]),
      after: text(draft.settings[key]),
    }));
  const ipsBefore = (account.ipWhitelist ?? []).join(', ');
  const ipsAfter = [...new Set(draft.ipWhitelist)].join(', ');
  if (ipsBefore !== ipsAfter)
    rows.push({ field: tr('IP whitelist'), before: ipsBefore || '—', after: ipsAfter || '—' });
  if ((account.owner ?? '') !== draft.owner)
    rows.push({ field: tr('Owner'), before: text(account.owner), after: text(draft.owner) });
  if (!rows.length) {
    editError.value = 'Nothing has changed.';
    return;
  }
  editError.value = '';
  lastDraft.value = draft;
  review.value = { draft, rows };
}
function saveEdit() {
  const account = editing.value!;
  const draft = review.value!.draft;
  void submit(
    async () => {
      await api(`/api/accounts/${encodeURIComponent(account.authId)}`, {
        method: 'PATCH',
        body: {
          base: {
            accountTags: account.accountTags,
            ipWhitelist: account.ipWhitelist,
            owner: account.owner,
          },
          settings: draft.settings,
          ipWhitelist: draft.ipWhitelist,
          owner: draft.owner,
        },
      });
      review.value = null;
      editing.value = null;
      await load();
      await openDetail();
    },
    (message) => {
      review.value = null;
      editError.value = message;
    },
  );
}

// ---- 轮换与停用 ----
const rotating = ref(false);
const rotateError = ref('');
function rotate() {
  const account = detail.value!;
  rotateError.value = '';
  void submit(
    async () => {
      await api(`/api/accounts/${encodeURIComponent(account.authId)}/rotate`, {
        method: 'POST',
        body: secrets.value,
      });
      rotating.value = false;
      await load();
      await openDetail();
    },
    (message) => (rotateError.value = message),
  );
}
const terminating = ref(false);
const terminateName = ref('');
const terminateError = ref('');
function terminate() {
  const account = detail.value!;
  terminateError.value = '';
  void submit(
    async () => {
      await api(`/api/accounts/${encodeURIComponent(account.authId)}/terminate`, {
        method: 'POST',
        body: { accountName: terminateName.value },
      });
      terminating.value = false;
      terminateName.value = '';
      await load();
      await openDetail();
    },
    (message) => (terminateError.value = message),
  );
}

// ---- 已知出口 IP(admin)----
const egressOpen = ref(false);
const egressText = ref('');
const egressError = ref('');
const egressBusy = ref(false);
async function openEgress() {
  const options = await api<{ egressIps: EgressIp[] }>('/api/accounts/options');
  egressText.value = options.egressIps.map((e) => `${e.ip} ${e.label}`.trim()).join('\n');
  egressError.value = '';
  egressOpen.value = true;
}
async function saveEgress() {
  egressBusy.value = true;
  egressError.value = '';
  try {
    const egressIps = egressText.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ip, ...label] = line.split(/\s+/);
        return { ip: ip!, label: label.join(' ') };
      });
    await api('/api/accounts/egress-ips', { method: 'PUT', body: { egressIps } });
    egressOpen.value = false;
  } catch (e) {
    egressError.value = errorText(e);
  } finally {
    egressBusy.value = false;
  }
}
</script>
<template>
  <section class="page wide">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ tr('TRADING') }}</p>
        <h1>{{ tr('Accounts') }}</h1>
        <p>
          {{
            tr(
              'Exchange accounts and API keys used by the trading systems. Keys are write-only: they are never shown again after saving.',
            )
          }}
        </p>
      </div>
      <div v-if="!loadError" class="actions">
        <button v-if="isAdmin" type="button" class="ghost" @click="openEgress">
          {{ tr('Egress IPs') }}
        </button>
        <button
          type="button"
          @click="
            clearSecrets();
            addError = '';
            adding = true;
          "
        >
          {{ tr('Add account') }}
        </button>
      </div>
    </header>
    <p v-if="loadError" class="error" role="alert">{{ tr(loadError) }}</p>
    <template v-else>
      <div class="filters">
        <label>
          {{ tr('Exchange') }}
          <select v-model="filters.exchange">
            <option value="">{{ tr('All exchanges') }}</option>
            <option v-for="x in accountExchanges" :key="x" :value="x">{{ x }}</option>
          </select>
        </label>
        <label>
          {{ tr('Status') }}
          <select v-model="filters.status">
            <option value="">{{ tr('All statuses') }}</option>
            <option v-for="[value, label] in statusChoices" :key="value" :value="value">
              {{ tr(label) }}
            </option>
          </select>
        </label>
        <label>
          {{ tr('Portfolio group') }}
          <select v-model="filters.group">
            <option value="">{{ tr('All groups') }}</option>
            <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
          </select>
        </label>
        <label>
          {{ tr('Search') }}
          <input v-model="filters.q" :placeholder="tr('Account or owner')" maxlength="100" />
        </label>
        <label class="choice">
          <input v-model="filters.showTerminated" type="checkbox" />
          <span>{{ tr('Show terminated') }}</span>
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ tr('Account') }}</th>
              <th>{{ tr('Exchange') }}</th>
              <th>{{ tr('Status') }}</th>
              <th>{{ tr('Portfolio group') }}</th>
              <th>{{ tr('Other tags') }}</th>
              <th>{{ tr('IP whitelist') }}</th>
              <th>{{ tr('Owner') }}</th>
              <th>{{ tr('Key') }}</th>
              <th>{{ tr('Last change') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in shown" :key="a.authId" class="clickable" @click="show(a.authId)">
              <td>
                {{ a.accountName }}<br /><small>{{ a.authId }}</small>
              </td>
              <td>{{ a.exchange }}</td>
              <td>
                {{ a.tagsError ? tr('Invalid tags') : tr(statusLabel[a.status]) }}
              </td>
              <td>{{ groupOf(a) || '—' }}</td>
              <td>{{ otherTags(a).join(', ') || '—' }}</td>
              <td>{{ a.ipWhitelist?.length ?? 0 }}</td>
              <td>{{ a.owner || '—' }}</td>
              <td>
                <code v-if="a.keyFingerprint">{{ keyText(a.keyFingerprint) }}</code>
                <small v-else>{{ keyText(null) }}</small>
              </td>
              <td>{{ a.lastChange ? formatTime(a.lastChange, locale) : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!shown.length">{{ tr('No matching accounts.') }}</p>
      </div>
    </template>

    <AppDialog
      v-if="route.query.account && (detail || detailError)"
      drawer
      :title="detail?.accountName ?? tr('Account')"
      :eyebrow="detail?.authId"
      @close="show(null)"
    >
      <p v-if="detailError" class="error" role="alert">{{ tr(detailError) }}</p>
      <template v-else-if="detail">
        <dl class="decision-facts">
          <dt>{{ tr('Exchange') }}</dt>
          <dd>{{ detail.exchange }}</dd>
          <dt>{{ tr('Status') }}</dt>
          <dd>
            {{
              detail.tagsError
                ? tr('Invalid tags: {0}', [detail.tagsError])
                : tr(statusLabel[detail.status])
            }}
          </dd>
          <dt>{{ tr('Portfolio group') }}</dt>
          <dd>{{ groupOf(detail) || '—' }}</dd>
          <dt>{{ tr('Other tags') }}</dt>
          <dd>{{ otherTags(detail).join(', ') || '—' }}</dd>
          <dt>{{ tr('IP whitelist') }}</dt>
          <dd>{{ detail.ipWhitelist?.join(', ') || '—' }}</dd>
          <dt>{{ tr('Owner') }}</dt>
          <dd>{{ detail.owner || '—' }}</dd>
          <dt>{{ tr('Key') }}</dt>
          <dd>{{ keyText(detail.keyFingerprint) }}</dd>
        </dl>
        <details>
          <summary>{{ tr('Raw tags') }}</summary>
          <pre>{{ detail.accountTags }}</pre>
        </details>
        <details v-if="detail.verifiedAuthTags">
          <summary>
            {{ tr('Verified tags · {0}', [formatTime(detail.verifiedAt, locale)]) }}
          </summary>
          <pre>{{ detail.verifiedAuthTags }}</pre>
        </details>
        <div v-if="detail.status !== 'terminated'" class="actions wrap">
          <button
            type="button"
            :disabled="!!detail.tagsError"
            @click="
              editError = '';
              lastDraft = undefined;
              editing = detail;
            "
          >
            {{ tr('Edit') }}
          </button>
          <button
            type="button"
            class="ghost"
            @click="
              clearSecrets();
              rotateError = '';
              rotating = true;
            "
          >
            {{ tr('Rotate key') }}
          </button>
          <button
            type="button"
            class="danger"
            @click="
              terminateName = '';
              terminateError = '';
              terminating = true;
            "
          >
            {{ tr('Terminate') }}
          </button>
        </div>
        <h3>{{ tr('Onboarding records') }}</h3>
        <p v-if="!detail.onboarding.length">{{ tr('No onboarding record uses this account.') }}</p>
        <ul v-else>
          <li v-for="o in detail.onboarding" :key="o.recordId">
            <RouterLink :to="`/w/internal/organizations/${o.organizationId}/onboarding`">
              {{ o.organizationName }} · {{ o.title }}
            </RouterLink>
          </li>
        </ul>
        <h3>{{ tr('History') }}</h3>
        <p v-if="!detail.audit.length">{{ tr('No changes since v2.') }}</p>
        <table v-else>
          <thead>
            <tr>
              <th>{{ tr('Time') }}</th>
              <th>{{ tr('Actor') }}</th>
              <th>{{ tr('Action') }}</th>
              <th>{{ tr('Change') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in detail.audit" :key="e.id">
              <td>{{ formatTime(e.at, locale) }}</td>
              <td>{{ e.actorName }}</td>
              <td>{{ tr(auditActionLabels[e.action] ?? e.action) }}</td>
              <td>
                <small v-if="e.before !== null">{{ compact(e.before) }} → </small>
                <small>{{ compact(e.after) }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </AppDialog>

    <AppDialog v-if="adding" :title="tr('Add account')" wide :busy="busy" @close="adding = false">
      <AccountForm
        v-model:secrets="secrets"
        :busy="busy"
        :error="addError"
        @save="add"
        @close="adding = false"
      />
    </AppDialog>

    <AppDialog
      v-if="editing && !review"
      :title="tr('Edit {0}', [editing.accountName])"
      wide
      @close="editing = null"
    >
      <AccountForm
        v-model:secrets="secrets"
        :account="editing"
        :draft="lastDraft"
        :error="editError"
        @save="reviewEdit"
        @close="editing = null"
      />
    </AppDialog>
    <AppDialog v-if="review" :title="tr('Review changes')" :busy="busy" @close="review = null">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Field') }}</th>
            <th>{{ tr('Before') }}</th>
            <th>{{ tr('After') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in review.rows" :key="row.field">
            <td>{{ row.field }}</td>
            <td>{{ row.before }}</td>
            <td>{{ row.after }}</td>
          </tr>
        </tbody>
      </table>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="review = null">
          {{ tr('Back') }}
        </button>
        <button type="button" :disabled="busy" @click="saveEdit">{{ tr('Save changes') }}</button>
      </div>
    </AppDialog>

    <AppDialog
      v-if="rotating && detail"
      :title="tr('Rotate key')"
      :busy="busy"
      @close="rotating = false"
    >
      <form autocomplete="off" @submit.prevent="rotate">
        <p>
          {{
            tr(
              'The old key stops working for our systems immediately. Revoke it on the exchange after the new key is confirmed.',
            )
          }}
        </p>
        <label for="r-key">{{ tr('New API key') }}</label>
        <input id="r-key" v-model="secrets.apiKey" type="password" autocomplete="off" required />
        <label for="r-secret">{{ tr('New API secret') }}</label>
        <input
          id="r-secret"
          v-model="secrets.apiSecret"
          type="password"
          autocomplete="off"
          required
        />
        <label for="r-pass">{{ tr('New passphrase') }}</label>
        <input id="r-pass" v-model="secrets.apiPass" type="password" autocomplete="off" />
        <p v-if="rotateError" class="error" role="alert">{{ tr(rotateError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="busy" @click="rotating = false">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="busy">{{ tr('Rotate key') }}</button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="terminating && detail"
      :title="tr('Terminate account')"
      :busy="busy"
      @close="terminating = false"
    >
      <form @submit.prevent="terminate">
        <p>
          {{
            tr(
              'Trading systems stop using this account on their next reload. This does not revoke the key on the exchange.',
            )
          }}
        </p>
        <label for="t-name">{{ tr('Type {0} to confirm', [detail.accountName]) }}</label>
        <input id="t-name" v-model="terminateName" autocomplete="off" required />
        <p v-if="terminateError" class="error" role="alert">{{ tr(terminateError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="busy" @click="terminating = false">
            {{ tr('Cancel') }}
          </button>
          <button
            type="submit"
            class="danger"
            :disabled="busy || terminateName !== detail.accountName"
          >
            {{ tr('Terminate') }}
          </button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="egressOpen"
      :title="tr('Known egress IPs')"
      :busy="egressBusy"
      @close="egressOpen = false"
    >
      <form @submit.prevent="saveEgress">
        <label for="e-ips">{{ tr('One IP per line, optionally followed by a note') }}</label>
        <textarea id="e-ips" v-model="egressText" rows="5" placeholder="52.1.2.3 Neo EIP" />
        <p v-if="egressError" class="error" role="alert">{{ tr(egressError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="egressBusy" @click="egressOpen = false">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="egressBusy">{{ tr('Save') }}</button>
        </div>
      </form>
    </AppDialog>
  </section>
</template>
