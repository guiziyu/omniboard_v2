<script setup lang="ts">
// 机构详情页框架(frontend-spec 4.1、4.2 tab 交互),从 v1 OrganizationPage.vue 迁移(不含对比,见 4.5)。
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { shortSource, tagName } from '../labels';
import type { ModuleData, Organization, TabDefinition } from '../../shared/types';
import Icon from '../components/Icon.vue';
import ModuleView from '../components/ModuleView.vue';
import OrgLogo from '../components/OrgLogo.vue';
const route = useRoute();
const router = useRouter();
const organization = ref<Organization>();
const module = ref<ModuleData>();
const tabs = ref<TabDefinition[]>([]);
const loading = ref(false);
const error = ref('');
const loadedPath = ref('');
// 内容只在新 tab 的数据到达后才替换,不会在新 tab 下显示旧模块内容。
const showingCurrent = computed(() => loadedPath.value === route.path);
const tabId = computed(() => String(route.params.tab || 'overview'));
const currentTab = computed(() => tabs.value.find((t) => t.id === tabId.value));
const nav = ref<HTMLElement>();
function centerTab() {
  const active = nav.value?.querySelector<HTMLElement>('[aria-current="page"]');
  if (active && nav.value)
    nav.value.scrollLeft +=
      active.getBoundingClientRect().left -
      nav.value.getBoundingClientRect().left -
      nav.value.clientWidth / 2 +
      active.clientWidth / 2;
}
let resizeObserver: ResizeObserver | undefined;
watch(nav, (element) => {
  resizeObserver?.disconnect();
  if (element) {
    resizeObserver = new ResizeObserver(centerTab);
    resizeObserver.observe(element);
  }
});
let serial = 0;
onUnmounted(() => {
  serial++;
  resizeObserver?.disconnect();
});
async function load() {
  if (!route.params.id) return;
  const current = ++serial;
  const id = String(route.params.id);
  const tab = tabId.value;
  const path = route.path;
  // 旧的 Stats tab 并入 Overview 的指标区(§1 重定向)。
  if (tab === 'stats') {
    await router.replace({
      path: `/w/internal/organizations/${id}/overview`,
      query: route.query,
      hash: '#metrics',
    });
    return;
  }
  // 换机构时清空身份区;同一机构内切换 tab 时身份区与导航保持不变。
  if (organization.value && organization.value.id !== id) {
    organization.value = undefined;
    tabs.value = [];
  }
  loading.value = true;
  error.value = '';
  try {
    const detail = await api<{ organization: Organization; tabs: TabDefinition[] }>(
      `/api/organizations/${encodeURIComponent(id)}`,
    );
    if (current !== serial) return;
    // 已合并为别名的旧 ID → 规范 ID,保留 tab 与 query。
    if (detail.organization.id !== id) {
      await router.replace({
        path: `/w/internal/organizations/${detail.organization.id}/${tab}`,
        query: route.query,
      });
      return;
    }
    organization.value = detail.organization;
    tabs.value = detail.tabs.filter((t) => t.id !== 'stats');
    if (!detail.tabs.some((t) => t.id === tab))
      throw new Error('This module is not configured for this organization.');
    const data = await api<ModuleData>(`/api/organizations/${encodeURIComponent(id)}/tabs/${tab}`);
    if (current !== serial) return;
    module.value = data;
    loadedPath.value = path;
    await nextTick();
    centerTab();
    if (route.hash === '#metrics')
      document.getElementById('metrics')?.scrollIntoView({ block: 'start' });
  } catch (e) {
    if (current === serial) error.value = errorText(e);
  } finally {
    if (current === serial) loading.value = false;
  }
}
watch(() => route.path, load, { immediate: true });
function chooseTab(id: string) {
  void router.push({
    path: `/w/internal/organizations/${route.params.id}/${id}`,
    query: route.query,
  });
}
function close() {
  void router.push({ path: '/w/internal/organizations', query: route.query });
}
const subtitle = computed(
  () =>
    organization.value?.sources.map((s) => shortSource(s.source)).join(' + ') ||
    tr('Team-maintained organization profile'),
);
</script>
<template>
  <section class="page wide organization-page">
    <nav class="breadcrumbs" :aria-label="tr('Breadcrumb')">
      <button type="button" class="link" :aria-label="tr('Back to organizations')" @click="close">
        {{ tr('← Organizations') }}
      </button>
      <Icon name="chevron" :size="13" />
      <span>{{ organization?.name || tr('Organization profile') }}</span>
    </nav>
    <header v-if="organization" class="org-head">
      <div>
        <h1>
          {{ organization.name }}
          <span v-for="tag in organization.tags" :key="tag" class="tag">{{ tagName(tag) }}</span>
        </h1>
        <p class="hint">
          {{ subtitle }}
          <span v-if="organization.sources.length">{{ tr('· Original page available') }}</span>
        </p>
      </div>
      <OrgLogo :name="organization.name" :src="organization.logoUrl" />
    </header>
    <nav v-if="tabs.length" ref="nav" class="module-tabs" :aria-label="tr('Organization modules')">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :aria-current="tab.id === tabId ? 'page' : undefined"
        @click="chooseTab(tab.id)"
      >
        {{ tr(tab.title) }}
      </button>
    </nav>
    <div class="panel-content" :aria-busy="loading">
      <p v-if="loading && showingCurrent" class="hint" role="status">
        {{ tr('Refreshing organization details…') }}
      </p>
      <div v-if="error && showingCurrent" class="error" role="alert">
        <p>{{ tr('Could not refresh: {0} Showing the last loaded information.', [tr(error)]) }}</p>
        <button type="button" class="ghost" @click="load">{{ tr('Retry refresh') }}</button>
      </div>
      <p v-if="loading && !showingCurrent" class="hint">
        {{ tr('Loading organization details…') }}
      </p>
      <div v-else-if="error && !showingCurrent" class="empty">
        <h3>{{ tr(error) }}</h3>
        <button type="button" class="ghost" @click="chooseTab('overview')">
          {{ tr('Back to Overview') }}
        </button>
      </div>
      <ModuleView
        v-else-if="organization && module && currentTab && showingCurrent"
        :key="organization.id + tabId"
        :organization="organization"
        :data="module"
        :tab="currentTab"
        @refresh="load"
      />
    </div>
    <footer class="panel-footer">
      <span>{{ tr('Internal workspace') }}</span>
      <span>{{ tr('Omnitra · Research with references') }}</span>
    </footer>
  </section>
</template>
