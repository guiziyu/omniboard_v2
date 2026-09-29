<script setup lang="ts">
// 机构目录与排名(frontend-spec 3)。筛选全写在 URL(replace),并按账号记忆(2.11);
// 进入详情页时组件保持缓存,返回时恢复滚动位置(2.13)。
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, atLeast, errorText, refreshSummary, session } from '../api';
import { displayMetric, formatTime } from '../format';
import { isTag, tagDefinitions, tagIds, type OrganizationTag } from '../../shared/tags';
import {
  columnsFor,
  defaultSort,
  reportingYear,
  type ColumnDefinition,
  type DirectoryOrganization,
  type MetricBasis,
} from '../../shared/columns';
import { useRememberedFilters } from '../remembered-filters';
import AppDialog from '../components/AppDialog.vue';
import ColumnHelp from '../components/ColumnHelp.vue';
import OrgLogo from '../components/OrgLogo.vue';
import MetricDialog from '../components/MetricDialog.vue';
import type { MetricPoint } from '../../shared/columns';
defineOptions({ name: 'DirectoryView' });
const PAGE_SIZE = 30;
const route = useRoute();
const router = useRouter();
useRememberedFilters('organizations');
const locale = computed(() => session.user?.locale ?? 'en');
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));

// ---- URL 状态(3.2):缺省与非法值在这里归一 ----
const activeTag = computed<OrganizationTag | ''>(() =>
  route.query.tag === undefined ? 'exchange' : isTag(route.query.tag) ? route.query.tag : '',
);
const available = computed(() => columnsFor(activeTag.value));
const sort = computed(() =>
  available.value.some((c) => c.id === route.query.sort) ||
  ['name', 'updated'].includes(String(route.query.sort))
    ? String(route.query.sort)
    : defaultSort(activeTag.value),
);
const sortColumn = computed(() => available.value.find((c) => c.id === sort.value));
const direction = computed(() => (route.query.direction === 'asc' ? 'asc' : 'desc'));
const unit = computed(() =>
  sortColumn.value?.units.includes(String(route.query.unit))
    ? String(route.query.unit)
    : (sortColumn.value?.units[0] ?? ''),
);
const year = computed(() =>
  /^(19|20|21)\d{2}$/.test(String(route.query.year)) ? String(route.query.year) : reportingYear(),
);
const basis = computed<MetricBasis>(() =>
  ['cmc_web', 'coingecko_web', 'manual'].includes(String(route.query.basis))
    ? (route.query.basis as MetricBasis)
    : 'preferred',
);
const page = computed(() => Math.max(1, Number(route.query.page) || 1));
const visible = computed(() =>
  available.value.filter(
    (c) =>
      c.id === sort.value ||
      (route.query.columns !== undefined
        ? String(route.query.columns).split(',').includes(c.id)
        : c.defaultVisible),
  ),
);
const years = computed(() =>
  [
    ...new Set([
      year.value,
      ...Array.from({ length: 16 }, (_, i) => String(new Date().getUTCFullYear() - i)),
    ]),
  ]
    .sort()
    .reverse(),
);

// ---- 数据 ----
const organizations = ref<DirectoryOrganization[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
let serial = 0;
// 最近一次加载的条件;从详情页返回且条件没变时不重新加载(2.13)。
let loadedKey: string | null = null;
async function load() {
  loadedKey = JSON.stringify(route.query);
  const current = ++serial; // 只采用最后一次请求的结果(0.5)
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      tag: activeTag.value,
      q: String(route.query.q ?? ''),
      sort: sort.value,
      direction: direction.value,
      basis: basis.value,
      year: year.value,
      page: String(page.value),
      pageSize: String(PAGE_SIZE),
    });
    if (unit.value) params.set('unit', unit.value);
    const result = await api<{ organizations: DirectoryOrganization[]; total: number }>(
      `/api/organizations?${params}`,
    );
    if (current !== serial) return;
    organizations.value = result.organizations;
    total.value = result.total;
  } catch (e) {
    if (current === serial) error.value = errorText(e);
  } finally {
    if (current === serial) loading.value = false;
  }
}
const approximateRanking = computed(() =>
  organizations.value.some((o) => {
    const qualifier = o.values[sort.value]?.qualifier;
    return qualifier && qualifier !== 'exact';
  }),
);
const extraTags = (org: DirectoryOrganization) =>
  org.tags.filter(
    (t) => t !== activeTag.value && !(activeTag.value === 'exchange' && t === 'company'),
  );
const showTagColumn = computed(() => organizations.value.some((o) => extraTags(o).length));

// ---- 操作(3.2) ----
function update(values: Record<string, string | undefined>) {
  void router.replace({
    query: { ...route.query, ...values, rankedOnly: undefined, page: undefined },
  });
}
function chooseTag(value: OrganizationTag | '') {
  update({
    tag: value || 'all',
    sort: undefined,
    unit: undefined,
    basis: undefined,
    columns: undefined,
    direction: undefined,
  });
}
function rank(columnId: string) {
  const same = sort.value === columnId;
  update({
    sort: columnId,
    direction: same ? (direction.value === 'desc' ? 'asc' : 'desc') : 'desc',
    unit: same ? unit.value : undefined,
  });
}
function toggleColumn(column: ColumnDefinition) {
  const ids = new Set(visible.value.map((c) => c.id));
  if (ids.has(column.id)) ids.delete(column.id);
  else ids.add(column.id);
  update({ columns: [...ids].join(',') });
}
const columnUnit = (column: ColumnDefinition) =>
  column.id === sort.value ? unit.value : column.units[0]!;
const ariaSort = (id: string) =>
  sort.value === id ? (direction.value === 'desc' ? 'descending' : 'ascending') : 'none';
const arrow = (id: string) => (sort.value === id ? (direction.value === 'desc' ? '↓' : '↑') : '↕');
function goToPage(next: number) {
  void router.replace({ query: { ...route.query, page: String(next) } });
}
function open(org: DirectoryOrganization) {
  void router.push({ path: `/w/internal/organizations/${org.id}/overview`, query: route.query });
}

// 搜索框:防抖 200 ms 写入 q;URL 的 q 变化时反向同步。
const q = ref(String(route.query.q ?? ''));
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(q, (value) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (value !== String(route.query.q ?? '')) update({ q: value || undefined });
  }, 200);
});
watch(
  () => (route.path === '/w/internal/organizations' ? JSON.stringify(route.query) : null),
  (query) => {
    if (query === null || query === loadedKey) return; // 在详情页(组件缓存中),或条件未变
    if (q.value !== String(route.query.q ?? '')) q.value = String(route.query.q ?? '');
    // 旧链接的 rankedOnly 去掉后重新加载,不再隐藏无值机构。
    if (route.query.rankedOnly !== undefined) {
      void router.replace({ query: { ...route.query, rankedOnly: undefined } });
      return;
    }
    void load();
  },
  { immediate: true },
);
watch(activeTag, () =>
  requestAnimationFrame(() =>
    document
      .querySelector('.tag-filters button[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
  ),
);

// 列选择器:点外部、焦点移出或 Escape 关闭;Escape 后焦点回到按钮;列说明开着时 Escape 先关它。
const columnPicker = ref<HTMLDetailsElement>();
function dismissColumns(event: Event) {
  if (
    columnPicker.value?.open &&
    event.target instanceof Node &&
    !columnPicker.value.contains(event.target)
  )
    columnPicker.value.open = false;
}
function columnKeydown(event: KeyboardEvent) {
  if (
    event.key !== 'Escape' ||
    !columnPicker.value?.open ||
    document.querySelector(':popover-open')
  )
    return;
  columnPicker.value.open = false;
  columnPicker.value.querySelector('summary')?.focus();
  event.preventDefault();
}
onMounted(() => {
  document.addEventListener('pointerdown', dismissColumns, true);
  document.addEventListener('focusin', dismissColumns);
  document.addEventListener('keydown', columnKeydown);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', dismissColumns, true);
  document.removeEventListener('focusin', dismissColumns);
  document.removeEventListener('keydown', columnKeydown);
  clearTimeout(debounce);
  serial++;
});

// 离开前记下滚动位置,返回(缓存激活)时恢复(2.13)。
let scrollY = 0;
onBeforeRouteLeave(() => {
  scrollY = window.scrollY;
});
onActivated(() => requestAnimationFrame(() => window.scrollTo(0, scrollY)));

const method = ref(false);

// 指标来源对话框(3.3、9.2):「按此观测排名」就地更新目录 query 并关闭对话框。
const metricTarget = ref<{ org: DirectoryOrganization; column: ColumnDefinition }>();
function explore(org: DirectoryOrganization, column: ColumnDefinition) {
  metricTarget.value = { org, column };
}
function rankWith(point: MetricPoint) {
  update({
    sort: point.columnId,
    unit: point.unit,
    basis: point.source,
    year: /^\d{4}$/.test(point.period) ? point.period : year.value,
  });
  metricTarget.value = undefined;
}
// 对话框开着时,对应机构的数据随列表重新加载而更新。
watch(organizations, (list) => {
  const open = metricTarget.value;
  const latest = open && list.find((o) => o.id === open.org.id);
  if (open && latest) open.org = latest;
});

// ---- 新建机构(2.6) ----
const creating = ref(false);
const form = ref({ name: '', description: '', tags: ['company'] as OrganizationTag[] });
const createBusy = ref(false);
const createError = ref('');
async function createOrganization() {
  createBusy.value = true;
  createError.value = '';
  try {
    const created = await api<{ id: string }>('/api/organizations', {
      method: 'POST',
      body: form.value,
    });
    creating.value = false;
    form.value = { name: '', description: '', tags: ['company'] };
    loadedKey = null; // 返回目录时重新加载,新机构出现在列表里
    void refreshSummary();
    await router.push({
      path: `/w/internal/organizations/${created.id}/overview`,
      query: route.query,
    });
  } catch (e) {
    createError.value = errorText(e);
  } finally {
    createBusy.value = false;
  }
}
</script>
<template>
  <section class="page wide">
    <header class="page-head">
      <div>
        <h1>Organizations</h1>
        <p>Rank, research and maintain your counterparties.</p>
      </div>
      <button v-if="canEdit" type="button" @click="creating = true">Add organization</button>
    </header>

    <div class="catalog-card">
      <div class="catalog-row">
        <div class="tag-filters" role="group" aria-label="Organization types">
          <button type="button" :aria-pressed="!activeTag" @click="chooseTag('')">All</button>
          <button
            v-for="key in tagIds"
            :key="key"
            type="button"
            :aria-pressed="activeTag === key"
            @click="chooseTag(key)"
          >
            {{ tagDefinitions[key].plural }}
          </button>
        </div>
        <div class="directory-total">
          <span>{{ loading ? '…' : total }} organizations</span>
          <button type="button" class="ghost" aria-label="Refresh organizations" @click="load">
            ↻
          </button>
        </div>
      </div>

      <div class="catalog-row toolbar">
        <input
          v-model="q"
          class="search"
          type="search"
          placeholder="Search organizations…"
          aria-label="Search organizations"
          maxlength="200"
        />
        <label class="inline-control">
          Rank by
          <select
            :value="sort"
            aria-label="Rank by"
            @change="
              update({
                sort: ($event.target as HTMLSelectElement).value,
                unit: undefined,
                direction: 'desc',
              })
            "
          >
            <option v-for="column in available" :key="column.id" :value="column.id">
              {{ column.title }}
            </option>
            <option value="name">Name</option>
            <option value="updated">Date added</option>
          </select>
        </label>
        <button type="button" class="link" @click="router.replace({ query: {} })">
          Reset filters
        </button>
        <details ref="columnPicker" class="column-picker">
          <summary>Columns</summary>
          <div class="column-menu">
            <div v-for="column in available" :key="column.id" class="column-choice">
              <label>
                <input
                  type="checkbox"
                  :checked="visible.some((c) => c.id === column.id)"
                  :disabled="column.id === sort"
                  @change="toggleColumn(column)"
                />
                {{ column.title }}
                <small v-if="column.id === sort">ranking</small>
              </label>
              <ColumnHelp
                :title="column.title"
                :description="column.description"
                :source-url="column.helpUrl"
              />
            </div>
          </div>
        </details>
      </div>

      <div class="catalog-row context">
        <strong>{{ sortColumn?.title ?? (sort === 'name' ? 'Name' : 'Date added') }}</strong>
        <select
          v-if="sortColumn && sortColumn.units.length > 1"
          :value="unit"
          aria-label="Ranking unit"
          @change="update({ unit: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="u in sortColumn.units" :key="u" :value="u">{{ u }}</option>
        </select>
        <span v-else-if="unit" class="hint">{{ unit }}</span>
        <label v-if="visible.some((c) => c.period === 'annual')" class="inline-control">
          Year
          <select
            :value="year"
            aria-label="Reporting year"
            @change="update({ year: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <button type="button" class="link" @click="method = true">ⓘ Ranking basis</button>
      </div>

      <p v-if="approximateRanking" class="caveat">
        Sorted by recorded bounds or estimates, not confirmed market size. Open a value to check
        coverage and definitions.
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="loading" class="hint">Loading rankings…</p>
      <div v-else class="table-wrap">
        <table class="ranking">
          <thead>
            <tr>
              <th class="rank-cell">{{ approximateRanking ? 'Order' : 'Rank' }}</th>
              <th :aria-sort="ariaSort('name')">
                <button type="button" class="sort" @click="rank('name')">
                  Organization <span>{{ arrow('name') }}</span>
                </button>
              </th>
              <th v-if="showTagColumn">Tags</th>
              <th
                v-for="column in visible"
                :key="column.id"
                class="numeric"
                :aria-sort="ariaSort(column.id)"
              >
                <div class="column-heading">
                  <button type="button" class="sort" @click="rank(column.id)">
                    {{ column.title }} <span>{{ arrow(column.id) }}</span>
                  </button>
                  <ColumnHelp
                    :title="column.title"
                    :description="column.description"
                    :source-url="column.helpUrl"
                  />
                </div>
                <small>
                  {{ columnUnit(column) }}
                  <template v-if="column.period === 'annual'">· {{ year }}</template>
                </small>
              </th>
              <th v-if="sort === 'updated'" :aria-sort="ariaSort('updated')">
                <button type="button" class="sort" @click="rank('updated')">
                  Date added <span>{{ arrow('updated') }}</span>
                </button>
              </th>
              <th><span class="visually-hidden">Open</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="org in organizations" :key="org.id">
              <td class="rank-cell">
                <button
                  v-if="org.rank && sortColumn?.kind === 'metric'"
                  type="button"
                  class="rank-number"
                  :class="{ podium: org.rank <= 3 && !approximateRanking }"
                  :aria-label="`Explain rank ${org.rank} for ${org.name}`"
                  @click="explore(org, sortColumn)"
                >
                  {{ org.rank }}
                </button>
                <span
                  v-else
                  class="rank-number"
                  :class="{ podium: org.rank !== null && org.rank <= 3 && !approximateRanking }"
                  >{{ org.rank ?? '—' }}</span
                >
              </td>
              <td>
                <button type="button" class="org-name" @click="open(org)">
                  <OrgLogo :name="org.name" :src="org.logoUrl" small />
                  <strong>{{ org.name }}</strong>
                </button>
              </td>
              <td v-if="showTagColumn">
                <span v-for="t in extraTags(org)" :key="t" class="tag">
                  {{ tagDefinitions[t].title }}
                </span>
              </td>
              <td
                v-for="column in visible"
                :key="column.id"
                class="numeric"
                :class="{ ranked: column.id === sort }"
              >
                <button
                  v-if="column.kind === 'metric'"
                  type="button"
                  class="metric-cell"
                  :class="{ missing: !org.values[column.id] }"
                  :aria-label="`Inspect ${column.title} for ${org.name}`"
                  :title="org.values[column.id]?.value ?? 'No matching observation'"
                  @click="explore(org, column)"
                >
                  {{ displayMetric(org.values[column.id], true) }}
                </button>
                <button
                  v-else
                  type="button"
                  class="link"
                  :aria-label="`Open records for ${org.name}`"
                  @click="open(org)"
                >
                  {{ org.recordCount }}
                </button>
              </td>
              <td v-if="sort === 'updated'">{{ formatTime(org.createdAt, locale) }}</td>
              <td>
                <button
                  type="button"
                  class="ghost"
                  :aria-label="`Open ${org.name} details`"
                  @click="open(org)"
                >
                  ›
                </button>
              </td>
            </tr>
            <tr v-if="!organizations.length">
              <td
                :colspan="visible.length + 3 + Number(showTagColumn) + (sort === 'updated' ? 1 : 0)"
              >
                <div class="empty">
                  <h3>No matching organizations</h3>
                  <p>
                    Add an organization or adjust the search. Metrics appear once a sourced value
                    has been recorded.
                  </p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="catalog-row pager">
        <span>
          {{ total ? (page - 1) * PAGE_SIZE + 1 : 0 }}–{{ Math.min(page * PAGE_SIZE, total) }} of
          {{ total }} organizations
        </span>
        <div>
          <button type="button" class="ghost" :disabled="page <= 1" @click="goToPage(page - 1)">
            Previous
          </button>
          <span>{{ page }}</span>
          <button
            type="button"
            class="ghost"
            :disabled="page * PAGE_SIZE >= total"
            @click="goToPage(page + 1)"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
    <p class="hint">Every metric retains its source and observation date.</p>

    <MetricDialog
      v-if="metricTarget"
      :organization="metricTarget.org"
      :column="metricTarget.column"
      :unit="columnUnit(metricTarget.column)"
      :year="year"
      :basis="basis"
      :selected-id="metricTarget.org.values[metricTarget.column.id]?.id"
      :rank="metricTarget.column.id === sort ? metricTarget.org.rank : undefined"
      @close="metricTarget = undefined"
      @updated="load"
      @rank-by="rankWith"
    />
    <AppDialog v-if="method" title="Ranking basis" @close="method = false">
      <p>{{ sortColumn?.description ?? 'Alphabetical or creation-date ordering.' }}</p>
      <label for="basis">Source selection</label>
      <select
        id="basis"
        :value="basis"
        @change="update({ basis: ($event.target as HTMLSelectElement).value })"
      >
        <option value="preferred">Preferred source</option>
        <option v-if="activeTag === 'exchange'" value="cmc_web">CoinMarketCap only</option>
        <option v-if="activeTag === 'exchange'" value="coingecko_web">CoinGecko only</option>
        <option value="manual">Team observations only</option>
      </select>
      <p>
        {{
          activeTag === 'exchange'
            ? 'Preferred source selects CoinMarketCap, then CoinGecko, then team observations.'
            : 'Use the latest matching team observation.'
        }}
        Only matching units and reporting periods are eligible. Values are never averaged or
        converted.
      </p>
      <p>
        Ranks are calculated across the selected tag before search and pagination. Equal values
        share a rank; missing values are unranked and appear last in either direction.
      </p>
      <p>
        Source identities stay independent until reviewed. Inspect a value to see its source and
        original evidence.
      </p>
    </AppDialog>

    <AppDialog
      v-if="creating"
      title="Add organization"
      :busy="createBusy"
      @close="creating = false"
    >
      <form @submit.prevent="createOrganization">
        <label for="org-name">Organization name</label>
        <input id="org-name" v-model="form.name" maxlength="160" required />
        <fieldset>
          <legend>Organization tags</legend>
          <p class="hint">Tags determine the available modules and metrics. Select one or more.</p>
          <div class="tag-choices">
            <label v-for="key in tagIds" :key="key" class="choice">
              <input v-model="form.tags" type="checkbox" :value="key" />
              <span>{{ tagDefinitions[key].title }}</span>
            </label>
          </div>
        </fieldset>
        <label for="org-description">Description</label>
        <textarea id="org-description" v-model="form.description" maxlength="3000" rows="4" />
        <p v-if="createError" class="error" role="alert">{{ createError }}</p>
        <div class="actions">
          <button type="button" class="ghost" :disabled="createBusy" @click="creating = false">
            Cancel
          </button>
          <button type="submit" :disabled="createBusy || !form.tags.length">Create</button>
        </div>
      </form>
    </AppDialog>
  </section>
</template>
