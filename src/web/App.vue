<script setup lang="ts">
// 骨架外壳:启动检查会话 → 激活页 / 登录页 / 工作区占位。路由与页面在后续步骤按 frontend-spec 补齐。
import { onMounted, ref } from 'vue';
import { api, ApiError, type User } from './api';
import LoginView from './LoginView.vue';
import ActivateView from './ActivateView.vue';
const user = ref<User | null>(null);
const loading = ref(true);
const error = ref('');
const activateToken = new URLSearchParams(location.search).get('token');
const activating = ref(location.pathname === '/activate' && !!activateToken);
onMounted(async () => {
  try {
    user.value = (await api<{ user: User | null }>('/api/session')).user;
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
});
function signedIn(next: User) {
  user.value = next;
  if (activating.value) {
    activating.value = false;
    history.replaceState(null, '', '/w/internal/organizations');
  }
}
async function logout() {
  await api('/api/logout', { method: 'POST' });
  user.value = null;
}
</script>
<template>
  <main v-if="loading" class="boot">Opening your workspace…</main>
  <ActivateView v-else-if="activating && activateToken" :token="activateToken" @done="signedIn" />
  <LoginView v-else-if="!user" :error="error" @done="signedIn" />
  <main v-else class="shell">
    <header>
      <strong>Omniboard</strong>
      <span>{{ user.name }} · {{ user.role }}</span>
      <button type="button" @click="logout">Sign out</button>
    </header>
    <p>Workspace pages are not built yet.</p>
  </main>
</template>
<style>
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #fff;
  color: #111;
}
.boot,
.shell,
.card {
  max-width: 420px;
  margin: 10vh auto;
  padding: 0 16px;
}
.shell {
  max-width: 960px;
}
.shell header {
  display: flex;
  gap: 16px;
  align-items: center;
}
label {
  display: block;
  margin: 12px 0 4px;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
}
button {
  margin-top: 16px;
  padding: 8px 16px;
}
.error {
  color: #b00020;
}
code {
  word-break: break-all;
}
</style>
