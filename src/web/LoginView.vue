<script setup lang="ts">
// frontend-spec 12.3:登录后停在原深链页面。
import { ref } from 'vue';
import { api, errorText, session, type User } from './api';
import { tr } from './i18n';
const props = defineProps<{ error?: string }>();
const email = ref('');
const password = ref('');
const code = ref('');
const useRecovery = ref(false);
const busy = ref(false);
const message = ref(props.error ?? '');
async function submit() {
  busy.value = true;
  message.value = '';
  try {
    const result = await api<{ user: User; recoveryCodesLeft: number | null }>('/api/login', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        ...(useRecovery.value ? { recoveryCode: code.value } : { code: code.value }),
      },
    });
    if (result.recoveryCodesLeft !== null)
      sessionStorage.setItem('omniboard.recoveryNotice', String(result.recoveryCodesLeft));
    session.user = result.user;
  } catch (e) {
    message.value = errorText(e);
  } finally {
    busy.value = false;
    code.value = '';
  }
}
</script>
<template>
  <form class="card" @submit.prevent="submit">
    <h1>{{ tr('Sign in') }}</h1>
    <label for="email">{{ tr('Email') }}</label>
    <input id="email" v-model="email" type="email" autocomplete="username" required />
    <label for="password">{{ tr('Password') }}</label>
    <input
      id="password"
      v-model="password"
      type="password"
      autocomplete="current-password"
      required
    />
    <label for="code">{{ useRecovery ? tr('Recovery code') : tr('Authenticator code') }}</label>
    <input
      id="code"
      v-model="code"
      :inputmode="useRecovery ? 'text' : 'numeric'"
      :autocomplete="useRecovery ? 'off' : 'one-time-code'"
      required
    />
    <button type="button" class="link" @click="useRecovery = !useRecovery">
      {{ useRecovery ? tr('Use an authenticator code') : tr('Use a recovery code') }}
    </button>
    <p v-if="message" class="error" role="alert">{{ tr(message) }}</p>
    <button type="submit" :disabled="busy">{{ tr('Sign in') }}</button>
  </form>
</template>
