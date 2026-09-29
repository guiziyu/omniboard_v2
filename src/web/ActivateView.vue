<script setup lang="ts">
// frontend-spec 12.2。二维码在界面那一步补;先显示可复制的密钥与 otpauth 链接。
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session, type User } from './api';
const route = useRoute();
const router = useRouter();
const base = `/api/activate/${encodeURIComponent(String(route.query.token ?? ''))}`;
const info = ref<{ name: string; email: string; purpose: 'activate' | 'reset' } | null>(null);
const setup = ref<{ secret: string; uri: string } | null>(null);
const password = ref('');
const confirm = ref('');
const code = ref('');
const codes = ref<string[]>([]);
const saved = ref(false);
const user = ref<User | null>(null);
const message = ref('');
const busy = ref(false);
onMounted(async () => {
  try {
    info.value = await api(base);
    setup.value = await api(`${base}/authenticator`, { method: 'POST' });
  } catch (e) {
    message.value = errorText(e);
  }
});
async function finish() {
  session.user = user.value;
  await router.replace('/w/internal/organizations');
}
async function complete() {
  if (info.value?.purpose === 'activate' && password.value !== confirm.value) {
    message.value = 'The passwords do not match.';
    return;
  }
  busy.value = true;
  message.value = '';
  try {
    const result = await api<{ user: User; recoveryCodes: string[] }>(`${base}/complete`, {
      method: 'POST',
      body: {
        ...(info.value?.purpose === 'activate' ? { password: password.value } : {}),
        code: code.value,
      },
    });
    codes.value = result.recoveryCodes;
    user.value = result.user;
  } catch (e) {
    message.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="card">
    <h1>Activate your account</h1>
    <p v-if="message" class="error" role="alert">{{ message }}</p>
    <template v-if="info && setup && !codes.length">
      <p>{{ info.name }} · {{ info.email }}</p>
      <form @submit.prevent="complete">
        <template v-if="info.purpose === 'activate'">
          <label for="password">Password (12–200 characters)</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="200"
            required
          />
          <label for="confirm">Confirm password</label>
          <input
            id="confirm"
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            required
          />
        </template>
        <p>Add this key to your authenticator app:</p>
        <p>
          <code>{{ setup.secret }}</code>
        </p>
        <p><a :href="setup.uri">Open in authenticator app</a></p>
        <label for="code">6-digit code</label>
        <input id="code" v-model="code" inputmode="numeric" autocomplete="one-time-code" required />
        <button type="submit" :disabled="busy">Continue</button>
      </form>
    </template>
    <template v-if="codes.length">
      <p>Save these recovery codes. Each works once, and they are shown only now.</p>
      <ul>
        <li v-for="c in codes" :key="c">
          <code>{{ c }}</code>
        </li>
      </ul>
      <label
        ><input v-model="saved" type="checkbox" style="width: auto" /> I have saved these
        codes</label
      >
      <button type="button" :disabled="!saved" @click="finish">Continue</button>
    </template>
  </section>
</template>
