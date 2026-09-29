<script setup lang="ts">
// 外壳(frontend-spec 2.1、2.3、2.4):启动检查会话;未登录时在当前 URL 上显示登录页;
// 登录后是侧栏 + 顶栏 + 页面。激活页不需要登录。
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import {
  api,
  atLeast,
  errorText,
  refreshSummary,
  roleLabels,
  session,
  summary,
  type User,
} from './api';
import LoginView from './LoginView.vue';
import EvidenceDrawer from './components/EvidenceDrawer.vue';
import Icon from './components/Icon.vue';
import { evidenceId } from './evidence';
import { tr } from './i18n'; // 同时同步 <html lang>(frontend-spec 2.10)
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
const isTrader = computed(() => !!session.user && atLeast(session.user.role, 'trader'));
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
  (id) => {
    if (!id) return;
    readRecoveryNotice();
    void refreshSummary().catch(() => undefined);
  },
);
// 详情页、对比页不属于其他导航项时,Organizations 保持高亮(frontend-spec 2.3)。
const inOrganizations = computed(() =>
  ['/w/internal/organizations', '/w/internal/compare/'].some((p) => route.path.startsWith(p)),
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
  <main v-if="loading" class="boot">{{ tr('Opening your workspace…') }}</main>
  <RouterView v-else-if="route.path === '/activate'" />
  <LoginView v-else-if="!session.user" :error="bootError" />
  <div v-else class="layout" :class="{ open: menuOpen }">
    <aside class="sidebar">
      <RouterLink to="/w/internal/organizations" class="brand">Omniboard</RouterLink>
      <nav :aria-label="tr('Main')">
        <RouterLink to="/w/internal/work">{{ tr('Work') }}</RouterLink>
        <RouterLink to="/w/internal/intelligence">{{ tr('Intelligence inbox') }}</RouterLink>
        <RouterLink
          to="/w/internal/organizations"
          :class="{ 'router-link-active': inOrganizations }"
          class="count-link"
        >
          {{ tr('Organizations') }}
          <span v-if="summary.organizations !== null" class="count">{{
            summary.organizations
          }}</span>
        </RouterLink>
        <RouterLink to="/w/internal/talent">{{ tr('Talent directory') }}</RouterLink>
        <RouterLink to="/w/internal/connectors">{{ tr('Connectors') }}</RouterLink>
        <!-- 交易账户与 HFT 配置仅 trader / admin 可见(frontend-spec 12.12)。 -->
        <template v-if="isTrader">
          <p class="group">{{ tr('Trading') }}</p>
          <RouterLink to="/w/internal/accounts">{{ tr('Accounts') }}</RouterLink>
          <RouterLink to="/w/internal/hft">{{ tr('HFT config') }}</RouterLink>
        </template>
        <!-- Data sources 所有角色可见,管理操作在页内限 admin(frontend-spec 2.3、9.5)。 -->
        <p class="group">{{ tr('Administration') }}</p>
        <RouterLink to="/w/internal/sources">{{ tr('Data sources') }}</RouterLink>
        <template v-if="isAdmin">
          <RouterLink to="/w/internal/members">{{ tr('Team members') }}</RouterLink>
          <RouterLink to="/w/internal/audit">{{ tr('Audit log') }}</RouterLink>
        </template>
      </nav>
      <div class="bottom">
        <RouterLink to="/w/internal/settings">{{ tr('Settings') }}</RouterLink>
        <div class="me">
          <span class="avatar" aria-hidden="true">{{ initials }}</span>
          <span>
            <strong>{{ session.user.name }}</strong>
            <small>{{ tr(roleLabels[session.user.role]) }}</small>
          </span>
          <button type="button" class="ghost" @click="logout">{{ tr('Sign out') }}</button>
        </div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button
          type="button"
          class="ghost menu"
          :aria-label="tr('Menu')"
          @click="menuOpen = !menuOpen"
        >
          ☰
        </button>
        <span>Omniboard / {{ tr(String(route.meta.title ?? 'Organizations')) }}</span>
        <RouterLink
          to="/w/internal/activity"
          class="topbar-activity"
          :aria-label="tr('Activity history')"
          :title="tr('Activity history')"
        >
          <Icon name="clock" :size="18" />
        </RouterLink>
      </header>
      <p v-if="recoveryLeft !== null" class="notice" role="status">
        <span>
          {{ tr('You used a recovery code. {0} codes left.', [recoveryLeft]) }}
          <RouterLink v-if="Number(recoveryLeft) < 3" to="/w/internal/settings">{{
            tr('Generate new codes')
          }}</RouterLink>
        </span>
        <button type="button" class="ghost" @click="recoveryLeft = null">
          {{ tr('Dismiss') }}
        </button>
      </p>
      <!-- 目录页进入详情时保持缓存,返回时不重新加载(frontend-spec 2.13)。 -->
      <RouterView v-slot="{ Component }">
        <KeepAlive include="DirectoryView">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </div>
    <EvidenceDrawer v-if="evidenceId" :id="evidenceId" @close="evidenceId = null" />
  </div>
</template>
