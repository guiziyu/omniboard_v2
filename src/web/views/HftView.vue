<script setup lang="ts">
// HFT 配置(frontend-spec 12.8):trader 与 admin。列表每个 channel 一张卡片;Channel 页(?channel=)直接编辑,
// 保存前显示改前 / 改后对照。当场确认(12.4)暂缓。HFT 启动时加载后冻结,改动在下次重启后生效(D4)。
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { formatTime } from '../format';
import AppDialog from '../components/AppDialog.vue';
import HftForm from '../components/HftForm.vue';
import {
  decimalText,
  hftChanges,
  type HftChange,
  type HftChannel,
  type HftChannelDetail,
  type HftSettings,
} from '../../shared/hft';

const route = useRoute();
const router = useRouter();
const locale = computed(() => session.user?.locale ?? 'en');
const channels = ref<HftChannel[]>([]);
const loadError = ref('');
async function load() {
  try {
    channels.value = await api<HftChannel[]>('/api/hft');
    loadError.value = '';
  } catch (e) {
    loadError.value = errorText(e);
  }
}

// ---- Channel 页 ----
const current = computed(() => (route.query.channel ? String(route.query.channel) : ''));
const detail = ref<HftChannelDetail | null>(null);
const detailError = ref('');
/** 换一个 key 让表单回到库里的值(保存成功、放弃改动、重新载入)。 */
const formKey = ref(0);
async function openChannel() {
  detailError.value = '';
  saveError.value = '';
  if (!current.value) {
    detail.value = null;
    return;
  }
  try {
    detail.value = await api<HftChannelDetail>(`/api/hft/${encodeURIComponent(current.value)}`);
    formKey.value++;
  } catch (e) {
    detail.value = null;
    detailError.value = errorText(e);
  }
}
watch(current, openChannel);
onMounted(async () => {
  await load();
  await openChannel();
});
const n = decimalText;
const actionLabel: Record<string, string> = {
  'hft_config.create': 'Channel created',
  'hft_config.update': 'Config saved',
};

// ---- 保存:先看改前 / 改后,再写入 ----
const busy = ref(false);
const saveError = ref('');
const review = ref<{ settings: HftSettings; rows: HftChange[] } | null>(null);
function reviewSave(value: { settings: HftSettings }) {
  const rows = hftChanges(detail.value!, value.settings);
  if (!rows.length) {
    saveError.value = 'Nothing has changed.';
    return;
  }
  saveError.value = '';
  review.value = { settings: value.settings, rows };
}
async function save() {
  const channel = detail.value!;
  busy.value = true;
  try {
    await api(`/api/hft/${encodeURIComponent(channel.channel)}`, {
      method: 'PUT',
      body: { base: channel.updateAt, settings: review.value!.settings },
    });
    review.value = null;
    await load();
    await openChannel();
  } catch (e) {
    // 409 等错误留在表单上,表单内容不丢。
    review.value = null;
    saveError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

// ---- 新建 channel ----
const adding = ref(false);
const addError = ref('');
async function add(value: { channel: string; settings: HftSettings }) {
  busy.value = true;
  addError.value = '';
  try {
    await api('/api/hft', { method: 'POST', body: value });
    adding.value = false;
    await load();
    await router.push({ query: { channel: value.channel } });
  } catch (e) {
    addError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
const knownGroups = computed(() => [
  ...new Set(channels.value.flatMap((c) => c.groupLimits.map((l) => l.predictionGroup))),
]);
</script>
<template>
  <section class="page wide">
    <template v-if="!current">
      <header class="page-head">
        <div>
          <p class="eyebrow">TRADING</p>
          <h1>HFT config</h1>
          <p>Risk limits HFT loads when it starts. Changes take effect after HFT restarts.</p>
        </div>
        <div v-if="!loadError" class="actions">
          <button
            type="button"
            @click="
              addError = '';
              adding = true;
            "
          >
            Add channel
          </button>
        </div>
      </header>
      <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>
      <p v-else-if="!channels.length">No channels yet.</p>
      <div v-else class="hft-cards">
        <RouterLink
          v-for="c in channels"
          :key="c.channel"
          class="hft-card"
          :to="{ query: { channel: c.channel } }"
        >
          <h2>{{ c.channel }}</h2>
          <dl>
            <dt>Portfolio group</dt>
            <dd>{{ c.portfolioGroup }}</dd>
            <dt>Max active groups</dt>
            <dd>{{ c.maxActiveGroups }}</dd>
            <dt>Per group</dt>
            <dd>
              gross {{ n(c.maxPortfolioGrossExposureUsd) }} · |net|
              {{ n(c.maxPortfolioAbsNetExposureUsd) }} · wallet ratio
              {{ n(c.maxWalletGrossToAssetsRatio) }}
            </dd>
            <dt>Group overrides</dt>
            <dd>{{ c.groupLimits.length }}</dd>
            <dt>Updated</dt>
            <dd>{{ formatTime(c.updateAt, locale) }}</dd>
          </dl>
        </RouterLink>
      </div>
    </template>

    <template v-else>
      <RouterLink class="back" :to="{ query: {} }">← All channels</RouterLink>
      <p v-if="detailError" class="error" role="alert">{{ detailError }}</p>
      <template v-else-if="detail">
        <header class="page-head">
          <div>
            <p class="eyebrow">HFT CHANNEL</p>
            <h1>{{ detail.channel }}</h1>
            <p>Updated {{ formatTime(detail.updateAt, locale) }}</p>
          </div>
        </header>
        <p class="notice-inline">
          Changes take effect after HFT restarts. The running process keeps the limits it started
          with.
        </p>
        <HftForm
          :key="formKey"
          :settings="detail"
          :known-groups="detail.knownGroups"
          :busy="busy"
          :error="saveError"
          submit-label="Review changes"
          @save="reviewSave"
          @close="
            saveError = '';
            formKey++;
          "
        />
        <p v-if="saveError.startsWith('This channel changed')">
          <button type="button" class="ghost" @click="openChannel">Reload</button>
        </p>

        <h3>History</h3>
        <p v-if="!detail.audit.length">No changes since v2.</p>
        <table v-else>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in detail.audit" :key="e.id">
              <td>{{ formatTime(e.at, locale) }}</td>
              <td>{{ e.actorName }}</td>
              <td>{{ actionLabel[e.action] ?? e.action }}</td>
              <td>
                <ul v-if="e.before" class="plain">
                  <li v-for="row in hftChanges(e.before, e.after)" :key="row.field">
                    {{ row.field }}: {{ row.before }} → {{ row.after }}
                  </li>
                </ul>
                <small v-else>
                  {{ e.after.portfolioGroup }} · {{ e.after.groupLimits.length }} group overrides
                </small>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>

    <AppDialog v-if="review" title="Review changes" :busy="busy" @close="review = null">
      <p>HFT keeps its current limits until it restarts.</p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in review.rows" :key="row.field">
            <td>{{ row.field }}</td>
            <td>{{ row.before }}</td>
            <td>{{ row.after }}</td>
          </tr>
        </tbody>
      </table>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="review = null">Back</button>
        <button type="button" :disabled="busy" @click="save">Save changes</button>
      </div>
    </AppDialog>

    <AppDialog v-if="adding" title="Add channel" wide :busy="busy" @close="adding = false">
      <HftForm
        with-channel
        :known-groups="knownGroups"
        :busy="busy"
        :error="addError"
        submit-label="Add channel"
        @save="add"
        @close="adding = false"
      />
    </AppDialog>
  </section>
</template>
