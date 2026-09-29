<script setup lang="ts">
// 设置页:Language(frontend-spec 2.9)、Security 与 API tokens(12.6)。
import { computed, onMounted, ref } from 'vue';
import { api, atLeast, errorText, roleLabels, session, type Role } from '../api';
import { tr } from '../i18n';
import { formatTime } from '../format';
import AppDialog from '../components/AppDialog.vue';
import SecretOnce from '../components/SecretOnce.vue';
import StepUpDialog from '../components/StepUpDialog.vue';
const locale = computed(() => session.user?.locale ?? 'en');

// Language
const languages = [
  ['en', 'English'],
  ['zh-CN', '简体中文'],
  ['ko', '한국어'],
] as const;
const chosen = ref(session.user?.locale ?? 'en');
const langBusy = ref(false);
const langStatus = ref('');
const langError = ref('');
async function saveLanguage() {
  langBusy.value = true;
  try {
    await api('/api/preferences', { method: 'PATCH', body: { locale: chosen.value } });
    if (session.user) session.user.locale = chosen.value;
    langStatus.value = 'Language preference saved.';
  } catch (e) {
    langError.value = errorText(e);
  } finally {
    langBusy.value = false;
  }
}
function languageChanged() {
  langStatus.value = '';
  langError.value = '';
}

// Security
const pw = ref({ current: '', next: '', confirm: '' });
const pwBusy = ref(false);
const pwStatus = ref('');
const pwError = ref('');
async function changePassword() {
  pwStatus.value = '';
  pwError.value = '';
  if (pw.value.next !== pw.value.confirm) {
    pwError.value = 'The passwords do not match.';
    return;
  }
  pwBusy.value = true;
  try {
    await api('/api/security/password', {
      method: 'POST',
      body: { current: pw.value.current, next: pw.value.next },
    });
    pw.value = { current: '', next: '', confirm: '' };
    pwStatus.value = 'Password changed.';
  } catch (e) {
    pwError.value = errorText(e);
  } finally {
    pwBusy.value = false;
  }
}
const codesLeft = ref<number | null>(null);
const regenerating = ref(false);
const stepBusy = ref(false);
const stepError = ref('');
const newCodes = ref<string | null>(null);
async function regenerate(code: string) {
  stepBusy.value = true;
  stepError.value = '';
  try {
    const result = await api<{ recoveryCodes: string[] }>('/api/security/recovery-codes', {
      method: 'POST',
      body: { code },
    });
    regenerating.value = false;
    newCodes.value = result.recoveryCodes.join('\n');
    await loadSecurity();
  } catch (e) {
    stepError.value = errorText(e);
  } finally {
    stepBusy.value = false;
  }
}
async function loadSecurity() {
  codesLeft.value = (await api<{ recoveryCodesLeft: number }>('/api/security')).recoveryCodesLeft;
}

// API tokens
const tokenStates: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};
type Token = {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  state: string;
};
const tokens = ref<Token[]>([]);
const tokenRoles = computed(() =>
  (['reader', 'editor', 'admin'] as Role[]).filter(
    (r) => session.user && atLeast(session.user.role, r),
  ),
);
const creating = ref(false);
const tokenForm = ref({ name: '', role: 'reader' as Role, expiresInDays: 30 });
const tokenBusy = ref(false);
const tokenError = ref('');
const newToken = ref<string | null>(null);
async function loadTokens() {
  tokens.value = await api<Token[]>('/api/tokens');
}
async function createToken() {
  tokenBusy.value = true;
  tokenError.value = '';
  try {
    const result = await api<{ token: string }>('/api/tokens', {
      method: 'POST',
      body: tokenForm.value,
    });
    creating.value = false;
    tokenForm.value = { name: '', role: 'reader', expiresInDays: 30 };
    newToken.value = result.token;
    await loadTokens();
  } catch (e) {
    tokenError.value = errorText(e);
  } finally {
    tokenBusy.value = false;
  }
}
async function revoke(token: Token) {
  if (!confirm(tr('Revoke “{0}”? Agents using it stop working immediately.', [token.name]))) return;
  await api(`/api/tokens/${token.id}`, { method: 'DELETE' });
  await loadTokens();
}
onMounted(() => Promise.all([loadSecurity(), loadTokens()]));
</script>
<template>
  <section class="page">
    <h1>{{ tr('Settings') }}</h1>
    <p>{{ tr('Preferences for your account.') }}</p>
    <form class="panel" @submit.prevent="saveLanguage">
      <h2>{{ tr('Language') }}</h2>
      <label for="lang">{{ tr('Display language') }}</label>
      <select id="lang" v-model="chosen" @change="languageChanged">
        <option v-for="[value, label] in languages" :key="value" :value="value">{{ label }}</option>
      </select>
      <p class="hint">
        {{ tr('Names and original source text stay in their original language.') }}
      </p>
      <p v-if="langStatus" role="status">{{ tr(langStatus) }}</p>
      <p v-if="langError" class="error" role="alert">{{ tr(langError) }}</p>
      <button type="submit" :disabled="langBusy || chosen === session.user?.locale">
        {{ langBusy ? tr('Saving…') : tr('Save preferences') }}
      </button>
    </form>

    <div class="panel">
      <h2>{{ tr('Security') }}</h2>
      <form @submit.prevent="changePassword">
        <h3>{{ tr('Change password') }}</h3>
        <label for="pw-current">{{ tr('Current password') }}</label>
        <input
          id="pw-current"
          v-model="pw.current"
          type="password"
          autocomplete="current-password"
          required
        />
        <label for="pw-next">{{ tr('New password (12–200 characters)') }}</label>
        <input
          id="pw-next"
          v-model="pw.next"
          type="password"
          autocomplete="new-password"
          minlength="12"
          maxlength="200"
          required
        />
        <label for="pw-confirm">{{ tr('Confirm new password') }}</label>
        <input
          id="pw-confirm"
          v-model="pw.confirm"
          type="password"
          autocomplete="new-password"
          required
        />
        <p v-if="pwStatus" role="status">{{ tr(pwStatus) }}</p>
        <p v-if="pwError" class="error" role="alert">{{ tr(pwError) }}</p>
        <button type="submit" :disabled="pwBusy">{{ tr('Change password') }}</button>
      </form>
      <h3>{{ tr('Recovery codes') }}</h3>
      <p>{{ tr('{0} unused recovery codes.', [codesLeft ?? '—']) }}</p>
      <button type="button" class="ghost" @click="regenerating = true">
        {{ tr('Regenerate recovery codes') }}
      </button>
    </div>

    <div class="panel">
      <header class="page-head">
        <h2>{{ tr('API tokens') }}</h2>
        <button type="button" @click="creating = true">{{ tr('Create token') }}</button>
      </header>
      <p class="hint">
        {{
          tr(
            'For agents calling the Omniboard API. Tokens cannot change trading accounts or HFT settings.',
          )
        }}
      </p>
      <p v-if="!tokens.length">{{ tr('No API tokens.') }}</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ tr('Name') }}</th>
              <th>{{ tr('Role') }}</th>
              <th>{{ tr('Created') }}</th>
              <th>{{ tr('Expires') }}</th>
              <th>{{ tr('Last used') }}</th>
              <th>{{ tr('Status') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tk in tokens" :key="tk.id">
              <td>{{ tk.name }}</td>
              <td>{{ tr(roleLabels[tk.role as Role] ?? tk.role) }}</td>
              <td>{{ formatTime(tk.createdAt, locale) }}</td>
              <td>{{ formatTime(tk.expiresAt, locale) }}</td>
              <td>{{ formatTime(tk.lastUsedAt, locale) }}</td>
              <td>{{ tr(tokenStates[tk.state] ?? tk.state) }}</td>
              <td>
                <button
                  v-if="tk.state === 'active'"
                  type="button"
                  class="ghost"
                  @click="revoke(tk)"
                >
                  {{ tr('Revoke') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AppDialog
      v-if="creating"
      :title="tr('Create token')"
      :busy="tokenBusy"
      @close="creating = false"
    >
      <form @submit.prevent="createToken">
        <label for="tk-name">{{ tr('Name') }}</label>
        <input id="tk-name" v-model="tokenForm.name" maxlength="80" required />
        <label for="tk-role">{{ tr('Role') }}</label>
        <select id="tk-role" v-model="tokenForm.role">
          <option v-for="r in tokenRoles" :key="r" :value="r">{{ tr(roleLabels[r]) }}</option>
        </select>
        <label for="tk-exp">{{ tr('Expires in') }}</label>
        <select id="tk-exp" v-model.number="tokenForm.expiresInDays">
          <option v-for="days in [7, 30, 90]" :key="days" :value="days">
            {{ tr('{0} days', [days]) }}
          </option>
        </select>
        <p v-if="tokenError" class="error" role="alert">{{ tr(tokenError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="tokenBusy" @click="creating = false">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="tokenBusy">{{ tr('Create') }}</button>
        </div>
      </form>
    </AppDialog>
    <StepUpDialog
      v-if="regenerating"
      :summary="tr('Regenerate your recovery codes. The old codes stop working.')"
      :busy="stepBusy"
      :error="stepError"
      @confirm="regenerate"
      @close="regenerating = false"
    />
    <SecretOnce
      v-if="newCodes"
      :title="tr('New recovery codes')"
      :note="tr('Each code works once. They are shown only now.')"
      :value="newCodes"
      @close="newCodes = null"
    />
    <SecretOnce
      v-if="newToken"
      :title="tr('API token')"
      :note="tr('Copy this token now. It is shown only once.')"
      :value="newToken"
      @close="newToken = null"
    />
  </section>
</template>
