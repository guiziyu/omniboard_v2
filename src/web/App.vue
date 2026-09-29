<script setup lang="ts">
// 外壳(frontend-spec 2.1、2.3、2.4):启动检查会话;未登录时在当前 URL 上显示登录页;
// 登录后是侧栏 + 顶栏 + 页面。激活页不需要登录。
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { api, errorText, session, type User } from './api';
import LoginView from './LoginView.vue';
const route = useRoute();
const loading = ref(true);
const bootError = ref('');
const menuOpen = ref(false);
// 用恢复码登录后提示剩余数量(frontend-spec 12.3)。
const recoveryLeft = ref<string | null>(null);
function readRecoveryNotice() {
  try {
    recoveryLeft.value = sessionStorage.getItem('omniboard.recoveryNotice');
    sessionStorage.removeItem('omniboard.recoveryNotice');
  } catch {
    recoveryLeft.value = null;
  }
}
const isAdmin = computed(() => session.user?.role === 'admin');
const initials = computed(() =>
  (session.user?.name ?? '')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);
onMounted(async () => {
  try {
    session.user = (await api<{ user: User | null }>('/api/session')).user;
  } catch (e) {
    bootError.value = errorText(e);
  } finally {
    loading.value = false;
  }
});
watch(
  () => session.user?.id,
  (id) => id && readRecoveryNotice(),
);
watch(
  () => session.user?.locale,
  (locale) => (document.documentElement.lang = locale ?? 'en'),
);
watch(
  () => route.path,
  () => (menuOpen.value = false),
);
async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => undefined);
  session.user = null;
}
</script>
<template>
  <main v-if="loading" class="boot">Opening your workspace…</main>
  <RouterView v-else-if="route.path === '/activate'" />
  <LoginView v-else-if="!session.user" :error="bootError" />
  <div v-else class="layout" :class="{ open: menuOpen }">
    <aside class="sidebar">
      <RouterLink to="/w/internal/organizations" class="brand">Omniboard</RouterLink>
      <nav aria-label="Main">
        <RouterLink to="/w/internal/organizations">Organizations</RouterLink>
        <template v-if="isAdmin">
          <p class="group">Administration</p>
          <RouterLink to="/w/internal/members">Team members</RouterLink>
          <RouterLink to="/w/internal/audit">Audit log</RouterLink>
        </template>
      </nav>
      <div class="bottom">
        <RouterLink to="/w/internal/settings">Settings</RouterLink>
        <div class="me">
          <span class="avatar" aria-hidden="true">{{ initials }}</span>
          <span>
            <strong>{{ session.user.name }}</strong>
            <small>{{ session.user.role }}</small>
          </span>
          <button type="button" class="ghost" @click="logout">Sign out</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button type="button" class="ghost menu" aria-label="Menu" @click="menuOpen = !menuOpen">
          ☰
        </button>
        <span>Omniboard / {{ route.meta.title ?? 'Organizations' }}</span>
      </header>
      <p v-if="recoveryLeft !== null" class="notice" role="status">
        <span>
          You used a recovery code. {{ recoveryLeft }} codes left.
          <RouterLink v-if="Number(recoveryLeft) < 3" to="/w/internal/settings"
            >Generate new codes</RouterLink
          >
        </span>
        <button type="button" class="ghost" @click="recoveryLeft = null">Dismiss</button>
      </p>
      <RouterView />
    </div>
  </div>
</template>
