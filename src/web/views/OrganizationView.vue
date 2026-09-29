<script setup lang="ts">
// 机构详情页框架(frontend-spec 4.1、4.2 tab 交互)与两机构对比(4.5、4.6),从 v1 OrganizationPage.vue 迁移。
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { shortSource, tagName } from '../labels';
import { knowledgeFields } from '../../shared/knowledge';
import type { ModuleData, Organization, TabDefinition } from '../../shared/types';
import AppDialog from '../components/AppDialog.vue';
import ComparisonMatrix from '../components/ComparisonMatrix.vue';
import Icon from '../components/Icon.vue';
import ModuleView from '../components/ModuleView.vue';
import OrgLogo from '../components/OrgLogo.vue';
import OrgPicker from '../components/OrgPicker.vue';
type Side = { organization: Organization; module: ModuleData };
const route = useRoute();
const router = useRouter();
const left = ref<Side>();
const right = ref<Side>();
const tabs = ref<TabDefinition[]>([]);
const loading = ref(false);
const error = ref('');
const loadedPath = ref('');
// 内容只在新 tab 的数据到达后才替换,不会在新 tab 下显示旧模块内容。
const showingCurrent = computed(() => loadedPath.value === route.path);
const comparing = computed(() => !!route.params.left);
const tabId = computed(() => String(route.params.tab || 'overview'));
const currentTab = computed(() => tabs.value.find((t) => t.id === tabId.value));
const organization = computed(() => left.value?.organization);
// 对比模式存在组件内,不进 URL;字段对比只用于有字段契约且不是 onboarding 的 tab(4.5)。
const compareMode = ref<'matrix' | 'details'>('matrix');
const matrixAvailable = computed(
  () => comparing.value && !!knowledgeFields[tabId.value] && tabId.value !== 'onboarding',
);
const mobileSide = ref<'left' | 'right'>('left');
const picking = ref(false);
const replacing = ref<'left' | 'right'>('right');
const base = () =>
  comparing.value
    ? `/w/internal/compare/${String(route.params.left)}/${String(route.params.right)}`
    : `/w/internal/organizations/${String(route.params.id)}`;
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
  if (!route.params.id && !route.params.left) return;
  const current = ++serial;
  const tab = tabId.value;
  const path = route.path;
  // 旧的 Stats tab 并入 Overview 的指标区(§1 重定向)。
  if (tab === 'stats') {
    await router.replace({ path: `${base()}/overview`, query: route.query, hash: '#metrics' });
    return;
  }
  // 换机构时清空身份区;同一机构内切换 tab 时身份区与导航保持不变。
  const [leftId, rightId] = comparing.value
    ? [String(route.params.left), String(route.params.right)]
    : [String(route.params.id), ''];
  if (left.value?.organization.id !== leftId || (right.value?.organization.id ?? '') !== rightId) {
    left.value = undefined;
    right.value = undefined;
    tabs.value = [];
    picking.value = false;
  }
  loading.value = true;
  error.value = '';
  try {
    if (rightId) {
      const data = await api<{ tabs: TabDefinition[]; left: Side; right: Side }>(
        `/api/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}&tab=${encodeURIComponent(tab)}`,
      );
      if (current !== serial) return;
      // 已合并为别名的旧 ID → 规范 ID,保留 tab 与 query。
      if (data.left.organization.id !== leftId || data.right.organization.id !== rightId) {
        await router.replace({
          path: `/w/internal/compare/${data.left.organization.id}/${data.right.organization.id}/${tab}`,
          query: route.query,
        });
        return;
      }
      left.value = data.left;
      right.value = data.right;
      tabs.value = data.tabs.filter((t) => t.id !== 'stats');
    } else {
      const detail = await api<{ organization: Organization; tabs: TabDefinition[] }>(
        `/api/organizations/${encodeURIComponent(leftId)}`,
      );
      if (current !== serial) return;
      if (detail.organization.id !== leftId) {
        await router.replace({
          path: `/w/internal/organizations/${detail.organization.id}/${tab}`,
          query: route.query,
        });
        return;
      }
      tabs.value = detail.tabs.filter((t) => t.id !== 'stats');
      if (!detail.tabs.some((t) => t.id === tab)) {
        left.value = {
          organization: detail.organization,
          module: { organizationId: leftId, tabId: tab, status: 'not_applicable' },
        };
        throw new Error('This module is not configured for this organization.');
      }
      const module = await api<ModuleData>(
        `/api/organizations/${encodeURIComponent(leftId)}/tabs/${tab}`,
      );
      if (current !== serial) return;
      left.value = { organization: detail.organization, module };
    }
    loadedPath.value = path;
    await nextTick();
    centerTab();
    if (route.hash === '#metrics')
      (
        document.getElementById('metrics') ?? document.querySelector('.overview-snapshot')
      )?.scrollIntoView({ block: 'start' });
  } catch (e) {
    if (current === serial) error.value = errorText(e);
  } finally {
    if (current === serial) loading.value = false;
  }
}
watch(() => route.path, load, { immediate: true });
function chooseTab(id: string) {
  void router.push({ path: `${base()}/${id}`, query: route.query });
}
function close() {
  void router.push({ path: '/w/internal/organizations', query: route.query });
}
function replaceSide(side: 'left' | 'right') {
  replacing.value = side;
  picking.value = true;
}
// 选中后的跳转(2.15):新对比 当前/选中;替换左侧 选中/右;替换右侧 左/选中。都保留 query。
function compareWith(id: string) {
  picking.value = false;
  const [a, b] = !comparing.value
    ? [left.value!.organization.id, id]
    : replacing.value === 'left'
      ? [id, right.value!.organization.id]
      : [left.value!.organization.id, id];
  void router.push({ path: `/w/internal/compare/${a}/${b}/${tabId.value}`, query: route.query });
}
function swap() {
  mobileSide.value = 'left';
  void router.push({
    path: `/w/internal/compare/${String(route.params.right)}/${String(route.params.left)}/${tabId.value}`,
    query: route.query,
  });
}
const notApplicable = (tab: string) =>
  [left.value, right.value].some(
    (s) => s?.module?.tabId === tab && s.module.status === 'not_applicable',
  );
const subtitle = computed(
  () =>
    organization.value?.sources.map((s) => shortSource(s.source)).join(' + ') ||
    tr('Team-maintained organization profile'),
);
const sides = computed(() =>
  [
    { key: 'left' as const, letter: 'A', side: left.value },
    { key: 'right' as const, letter: 'B', side: right.value },
  ].filter((s) => s.side),
);
</script>
<template>
  <section class="page wide organization-page">
    <nav class="breadcrumbs" :aria-label="tr('Breadcrumb')">
      <button type="button" class="link" :aria-label="tr('Back to organizations')" @click="close">
        {{ tr('← Organizations') }}
      </button>
      <Icon name="chevron" :size="13" />
      <span>
        {{
          comparing ? tr('Compare organizations') : organization?.name || tr('Organization profile')
        }}
      </span>
      <span class="page-actions">
        <template v-if="comparing">
          <button
            v-if="matrixAvailable && compareMode === 'details'"
            type="button"
            class="link"
            @click="compareMode = 'matrix'"
          >
            {{ tr('Compare the same fields') }}
          </button>
          <button type="button" class="link" @click="replaceSide('left')">
            {{ tr('Replace left') }}
          </button>
          <button type="button" class="link" @click="replaceSide('right')">
            {{ tr('Replace right') }}
          </button>
          <button type="button" class="link" @click="swap">
            <Icon name="compare" :size="15" /> {{ tr('Swap sides') }}
          </button>
        </template>
        <button v-else-if="organization" type="button" class="ghost" @click="replaceSide('right')">
          <Icon name="compare" :size="16" /> {{ tr('Compare organizations') }}
        </button>
      </span>
    </nav>
    <header v-if="comparing" class="org-head">
      <div>
        <h1>{{ tr('Organization comparison') }}</h1>
        <p class="hint">
          {{ tr('Compare available capabilities, resources and evidence across organizations.') }}
        </p>
      </div>
    </header>
    <header v-else-if="organization" class="org-head">
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
        <span v-if="comparing && notApplicable(tab.id)" class="tab-dot" />
      </button>
    </nav>
    <div v-if="comparing && left && right" class="mobile-side-tabs segmented">
      <button
        v-for="s in sides"
        :key="s.key"
        type="button"
        :aria-pressed="mobileSide === s.key"
        @click="mobileSide = s.key"
      >
        {{ s.letter }} · {{ s.side!.organization.name }}
      </button>
    </div>
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
      <template v-else-if="left && currentTab && showingCurrent">
        <div v-if="right && matrixAvailable && compareMode === 'matrix'">
          <button type="button" class="link comparison-mode" @click="compareMode = 'details'">
            {{ tr('Open full records side by side') }}
          </button>
          <ComparisonMatrix :left="left" :right="right" :tab-id="tabId" @replace="replaceSide" />
        </div>
        <div v-else-if="right" class="compare-columns">
          <div
            v-for="s in sides"
            :key="s.key"
            class="compare-side"
            :class="{ 'mobile-hidden': mobileSide !== s.key }"
          >
            <div class="compare-identity">
              <span class="side-letter" :class="{ b: s.key === 'right' }">{{ s.letter }}</span>
              <OrgLogo :name="s.side!.organization.name" :src="s.side!.organization.logoUrl" />
              <div>
                <h3>{{ s.side!.organization.name }}</h3>
                <span v-for="tag in s.side!.organization.tags" :key="tag" class="tag">
                  {{ tagName(tag) }}
                </span>
              </div>
            </div>
            <ModuleView
              :key="s.side!.organization.id + tabId"
              :organization="s.side!.organization"
              :data="s.side!.module"
              :tab="currentTab"
              compact
              @refresh="load"
            />
          </div>
        </div>
        <ModuleView
          v-else
          :key="left.organization.id + tabId"
          :organization="left.organization"
          :data="left.module"
          :tab="currentTab"
          @refresh="load"
        />
      </template>
    </div>
    <footer class="panel-footer">
      <span>{{ tr('Internal workspace') }}</span>
      <span>
        {{
          comparing
            ? tr('Values with different units are not directly compared.')
            : tr('Omnitra · Research with references')
        }}
      </span>
    </footer>
    <AppDialog v-if="picking" :title="tr('Select an organization')" @close="picking = false">
      <OrgPicker
        :exclude="
          comparing && replacing === 'left' ? right?.organization.id : left?.organization.id
        "
        @select="compareWith($event.id)"
      />
    </AppDialog>
  </section>
</template>
