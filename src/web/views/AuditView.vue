<script setup lang="ts">
// 审计日志(frontend-spec 12.10):仅 admin;筛选写在 URL;每页 50 条,「Load more」继续;
// ?event=<id> 定位并展开该事件(留给通知邮件的链接;发邮件是 TODO,12.11)。
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { formatTime } from '../format';
type Event = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  via: 'session' | 'agent_token' | 'cli' | 'system';
  agentTokenName: string | null;
  action: string;
  targetTable: string;
  targetKey: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  stepUp: boolean;
};
const actionLabel: Record<string, string> = {
  'auth.create': 'Account created',
  'auth.update_tags': 'Account tags changed',
  'auth.update_whitelist': 'IP whitelist changed',
  'auth.update_owner': 'Account owner changed',
  'auth.rotate_key': 'API key rotated',
  'auth.terminate': 'Account terminated',
  'hft_config.create': 'HFT channel created',
  'hft_config.update': 'HFT config saved',
  'hft_restart.request': 'HFT restart requested',
  'member.invite': 'Member invited',
  'member.role': 'Role changed',
  'member.disable': 'Member disabled',
  'member.enable': 'Member enabled',
  'member.reset_totp': 'Authenticator reset',
  'session.revoke': 'Signed out everywhere',
  'agent_token.create': 'API token created',
  'agent_token.revoke': 'API token revoked',
  'login.locked': 'Sign-in locked',
};
const categories = [
  ['', 'All'],
  ['accounts', 'Accounts'],
  ['hft', 'HFT'],
  ['members', 'Members'],
  ['tokens', 'Tokens'],
  ['login', 'Login'],
] as const;
const filterKeys = ['actor', 'category', 'target', 'from', 'to'] as const;
type Filters = Record<(typeof filterKeys)[number], string>;
const route = useRoute();
const router = useRouter();
const locale = computed(() => session.user?.locale ?? 'en');
const filters = ref<Filters>(
  Object.fromEntries(filterKeys.map((k) => [k, String(route.query[k] ?? '')])) as Filters,
);
const events = ref<Event[]>([]);
const members = ref<{ id: string; name: string }[]>([]);
const expanded = ref(new Set<string>());
const error = ref('');
const loading = ref(false);
const done = ref(false);
let requestSeq = 0;
function query(before?: string) {
  const params = new URLSearchParams();
  for (const k of filterKeys) if (filters.value[k]) params.set(k, filters.value[k]);
  if (before) params.set('before', before);
  return params.toString();
}
async function load(more = false) {
  const seq = ++requestSeq; // 只采用最后一次请求的结果(frontend-spec 0.5)
  loading.value = true;
  error.value = '';
  try {
    const eventId = !more && route.query.event ? String(Number(route.query.event) + 1) : undefined;
    const before = more ? events.value.at(-1)?.id : eventId;
    const page = await api<Event[]>(`/api/audit?${query(before)}`);
    if (seq !== requestSeq) return;
    events.value = more ? [...events.value, ...page] : page;
    done.value = page.length < 50;
    if (!more && route.query.event) expanded.value = new Set([String(route.query.event)]);
  } catch (e) {
    if (seq === requestSeq) error.value = errorText(e);
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}
function applyFilters() {
  const next: Record<string, string> = {};
  for (const k of filterKeys) if (filters.value[k]) next[k] = filters.value[k];
  void router.replace({ query: next });
}
watch(
  () => route.fullPath,
  () => {
    filters.value = Object.fromEntries(
      filterKeys.map((k) => [k, String(route.query[k] ?? '')]),
    ) as Filters;
    void load();
  },
);
onMounted(async () => {
  await load();
  members.value = await api<{ id: string; name: string }[]>('/api/members').catch(() => []);
});
function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
/** 改前/改后对照:列出两边所有字段,值不同的标出。 */
function diff(event: Event) {
  const keys = [
    ...new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})]),
  ];
  const show = (v: unknown) =>
    v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  return keys.map((key) => {
    const before = event.before?.[key];
    const after = event.after?.[key];
    return {
      key,
      before: show(before),
      after: show(after),
      changed: JSON.stringify(before) !== JSON.stringify(after),
    };
  });
}
</script>
<template>
  <section class="page">
    <h1>Audit log</h1>
    <p>
      Changes to accounts, HFT settings, members and tokens. Entries cannot be edited or deleted.
    </p>
    <form class="filters" @submit.prevent="applyFilters">
      <label>
        Actor
        <select v-model="filters.actor">
          <option value="">Anyone</option>
          <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </label>
      <label>
        Category
        <select v-model="filters.category">
          <option v-for="[value, label] in categories" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </label>
      <label>Target <input v-model="filters.target" maxlength="200" /></label>
      <label>From <input v-model="filters.from" type="date" /></label>
      <label>To <input v-model="filters.to" type="date" /></label>
      <button type="submit">Apply</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Step-up</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="e in events" :key="e.id">
            <tr class="clickable" :aria-expanded="expanded.has(e.id)" @click="toggle(e.id)">
              <td>{{ formatTime(e.at, locale) }}</td>
              <td>
                {{ e.actorName }}
                <small v-if="e.agentTokenName">via token {{ e.agentTokenName }}</small>
                <small v-else-if="e.via === 'cli'">via command line</small>
              </td>
              <td>{{ actionLabel[e.action] ?? e.action }}</td>
              <td>
                <code>{{ e.targetKey }}</code>
              </td>
              <td>{{ e.stepUp ? '✓' : '' }}</td>
            </tr>
            <tr v-if="expanded.has(e.id)" class="detail">
              <td colspan="5">
                <p>
                  <code>{{ e.targetTable }}</code> · event {{ e.id }}
                </p>
                <table v-if="diff(e).length">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in diff(e)" :key="row.key" :class="{ changed: row.changed }">
                      <td>{{ row.key }}</td>
                      <td>
                        <code>{{ row.before }}</code>
                      </td>
                      <td>
                        <code>{{ row.after }}</code>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-if="!events.length && !loading">No matching events.</p>
      <button
        v-if="events.length && !done"
        type="button"
        class="ghost"
        :disabled="loading"
        @click="load(true)"
      >
        Load more
      </button>
    </div>
  </section>
</template>
