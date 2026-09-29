<script setup lang="ts">
// 团队成员页(frontend-spec 12.5)。非 admin 无论从哪里进入都显示同一个错误(v1 待核项在此统一)。
import { computed, onMounted, ref } from 'vue';
import { api, errorText, roleLabels, roles, session, type Role } from '../api';
import { tr } from '../i18n';
import { formatTime } from '../format';
import AppDialog from '../components/AppDialog.vue';
import SecretOnce from '../components/SecretOnce.vue';
type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: string | null;
  activeTokens: number;
};
type Token = {
  id: string;
  name: string;
  role: string;
  expiresAt: string;
  lastUsedAt: string | null;
  state: string;
};
const roleHelp: Record<Role, string> = {
  reader: 'Reads team information. Cannot change anything.',
  editor: 'Adds and edits organizations, records and tasks.',
  trader: 'Editor, plus trading accounts, API keys and HFT configuration.',
  admin: 'Everything, plus members, data sources and the audit log.',
};
const statusLabel = { invited: 'Invited', active: 'Active', disabled: 'Disabled' } as const;
const tokenStates: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};
const members = ref<Member[]>([]);
const loadError = ref('');
const locale = computed(() => session.user?.locale ?? 'en');
async function load() {
  try {
    members.value = await api<Member[]>('/api/members');
    loadError.value = '';
  } catch (e) {
    loadError.value = errorText(e);
  }
}
onMounted(load);

// Add member
const adding = ref(false);
const form = ref({ name: '', email: '', role: 'reader' as Role });
const busy = ref(false);
const formError = ref('');
const link = ref<{ title: string; value: string } | null>(null);
const linkNote = () =>
  tr('Send this link to the member. It expires in 72 hours and is shown only once.');
async function addMember() {
  busy.value = true;
  formError.value = '';
  try {
    const result = await api<{ inviteLink: string }>('/api/members', {
      method: 'POST',
      body: form.value,
    });
    adding.value = false;
    form.value = { name: '', email: '', role: 'reader' };
    link.value = { title: tr('Invite link'), value: result.inviteLink };
    await load();
  } catch (e) {
    formError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

// Manage one member
const current = ref<Member | null>(null);
const nextRole = ref<Role>('reader');
const tokens = ref<Token[]>([]);
const actionError = ref('');
async function manage(member: Member) {
  current.value = member;
  nextRole.value = member.role;
  actionError.value = '';
  tokens.value = await api<Token[]>(`/api/members/${member.id}/tokens`).catch(() => []);
}
async function act(path: string, body: unknown = {}, method = 'POST') {
  if (!current.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    const result = await api<{ inviteLink?: string }>(`/api/members/${current.value.id}${path}`, {
      method,
      body,
    });
    if (result.inviteLink) link.value = { title: tr('New link'), value: result.inviteLink };
    await load();
    const fresh = members.value.find((m) => m.id === current.value?.id);
    if (fresh) await manage(fresh);
    if (result.inviteLink) current.value = null;
  } catch (e) {
    actionError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const isSelf = computed(() => current.value?.id === session.user?.id);
function confirmAct(message: string, path: string) {
  if (confirm(tr(message))) void act(path);
}
</script>
<template>
  <section class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ tr('WORKSPACE ACCESS') }}</p>
        <h1>{{ tr('Team members') }}</h1>
        <p>{{ tr('Manage reader, editor, trader and administrator access.') }}</p>
      </div>
      <button v-if="!loadError" type="button" @click="adding = true">
        {{ tr('Add member') }}
      </button>
    </header>
    <p v-if="loadError" class="error" role="alert">{{ tr(loadError) }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Member') }}</th>
            <th>{{ tr('Email') }}</th>
            <th>{{ tr('Role') }}</th>
            <th>{{ tr('Status') }}</th>
            <th>{{ tr('Last login') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id">
            <td>{{ m.name }}</td>
            <td>{{ m.email }}</td>
            <td>{{ tr(roleLabels[m.role]) }}</td>
            <td>{{ tr(statusLabel[m.status]) }}</td>
            <td>{{ formatTime(m.lastLoginAt, locale) }}</td>
            <td>
              <button type="button" class="ghost" @click="manage(m)">{{ tr('Manage') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppDialog v-if="adding" :title="tr('Add member')" :busy="busy" @close="adding = false">
      <form @submit.prevent="addMember">
        <label for="m-name">{{ tr('Name') }}</label>
        <input id="m-name" v-model="form.name" maxlength="80" required />
        <label for="m-email">{{ tr('Email') }}</label>
        <input id="m-email" v-model="form.email" type="email" maxlength="200" required />
        <fieldset>
          <legend>{{ tr('Role') }}</legend>
          <label v-for="r in roles" :key="r" class="choice">
            <input v-model="form.role" type="radio" name="role" :value="r" />
            <span
              ><strong>{{ tr(roleLabels[r]) }}</strong> — {{ tr(roleHelp[r]) }}</span
            >
          </label>
        </fieldset>
        <p v-if="formError" class="error" role="alert">{{ tr(formError) }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="busy" @click="adding = false">
            {{ tr('Cancel') }}
          </button>
          <button type="submit" :disabled="busy">{{ tr('Create invite') }}</button>
        </div>
      </form>
    </AppDialog>

    <AppDialog v-if="current" :title="current.name" :busy="busy" @close="current = null">
      <p>{{ current.email }} · {{ tr(statusLabel[current.status]) }}</p>
      <form v-if="!isSelf" class="inline" @submit.prevent="act('', { role: nextRole }, 'PATCH')">
        <label for="m-role">{{ tr('Role') }}</label>
        <select id="m-role" v-model="nextRole">
          <option v-for="r in roles" :key="r" :value="r">{{ tr(roleLabels[r]) }}</option>
        </select>
        <button type="submit" :disabled="busy || nextRole === current.role">
          {{ tr('Change role') }}
        </button>
      </form>
      <p v-else>{{ tr('You cannot change your own role or disable yourself.') }}</p>
      <div class="actions wrap">
        <button
          v-if="current.status === 'invited'"
          type="button"
          class="ghost"
          :disabled="busy"
          @click="act('/resend-invite')"
        >
          {{ tr('Resend invite') }}
        </button>
        <button
          v-if="current.status === 'active'"
          type="button"
          class="ghost"
          :disabled="busy"
          @click="act('/sign-out')"
        >
          {{ tr('Sign out everywhere') }}
        </button>
        <button
          v-if="current.status === 'active'"
          type="button"
          class="ghost"
          :disabled="busy"
          @click="
            confirmAct(
              'Reset this member’s authenticator? They are signed out and need a new link.',
              '/reset-authenticator',
            )
          "
        >
          {{ tr('Reset authenticator') }}
        </button>
        <button
          v-if="current.status !== 'disabled' && !isSelf"
          type="button"
          class="danger"
          :disabled="busy"
          @click="
            confirmAct(
              'Disable this member? Their session ends and all API tokens are revoked.',
              '/disable',
            )
          "
        >
          {{ tr('Disable') }}
        </button>
        <button
          v-if="current.status === 'disabled'"
          type="button"
          :disabled="busy"
          @click="act('/enable')"
        >
          {{ tr('Enable') }}
        </button>
      </div>
      <p v-if="actionError" class="error" role="alert">{{ tr(actionError) }}</p>
      <h3>{{ tr('API tokens') }}</h3>
      <p v-if="!tokens.length">{{ tr('No API tokens.') }}</p>
      <table v-else>
        <thead>
          <tr>
            <th>{{ tr('Name') }}</th>
            <th>{{ tr('Role') }}</th>
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
            <td>{{ formatTime(tk.expiresAt, locale) }}</td>
            <td>{{ formatTime(tk.lastUsedAt, locale) }}</td>
            <td>{{ tr(tokenStates[tk.state] ?? tk.state) }}</td>
            <td>
              <button
                v-if="tk.state === 'active'"
                type="button"
                class="ghost"
                :disabled="busy"
                @click="act(`/tokens/${tk.id}`, undefined, 'DELETE')"
              >
                {{ tr('Revoke') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </AppDialog>

    <SecretOnce
      v-if="link"
      :title="link.title"
      :note="linkNote()"
      :value="link.value"
      @close="link = null"
    />
  </section>
</template>
