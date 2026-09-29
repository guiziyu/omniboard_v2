<script setup lang="ts">
// frontend-spec 12.3
import { ref } from 'vue';
import { api, ApiError, type User } from './api';
const props = defineProps<{ error?: string }>();
const emit = defineEmits<{ done: [user: User] }>();
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
      alert(`You used a recovery code. ${result.recoveryCodesLeft} codes left.`);
    emit('done', result.user);
  } catch (e) {
    message.value = (e as ApiError).message;
  } finally {
    busy.value = false;
    code.value = '';
  }
}
</script>
<template>
  <form class="card" @submit.prevent="submit">
    <h1>Sign in</h1>
    <label for="email">Email</label>
    <input id="email" v-model="email" type="email" autocomplete="username" required />
    <label for="password">Password</label>
    <input
      id="password"
      v-model="password"
      type="password"
      autocomplete="current-password"
      required
    />
    <label for="code">{{ useRecovery ? 'Recovery code' : 'Authenticator code' }}</label>
    <input
      id="code"
      v-model="code"
      :inputmode="useRecovery ? 'text' : 'numeric'"
      :autocomplete="useRecovery ? 'off' : 'one-time-code'"
      required
    />
    <a href="#" @click.prevent="useRecovery = !useRecovery">
      {{ useRecovery ? 'Use an authenticator code' : 'Use a recovery code' }}
    </a>
    <p v-if="message" class="error" role="alert">{{ message }}</p>
    <button type="submit" :disabled="busy">Sign in</button>
  </form>
</template>
