<script setup lang="ts">
// 情报列表与详情(frontend-spec 8.1、8.2),从 v1 IntelligenceInbox.vue 迁移。v1 未挂载的 preview 模式不迁移。
// 打开详情不会标为已读;已读按成员 + 记录 + revision 保存,不改变评审状态或证据等级。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import { openEvidence } from '../evidence';
import { tabs } from '../../shared/registry';
import { knowledgeFields } from '../../shared/knowledge';
import {
  taskStates,
  type IntelligenceDetail,
  type IntelligenceFeed,
  type IntelligenceItem,
  type WorkFeed,
} from '../../shared/operations';
import {
  evidencePresentation,
  fieldValueLabel,
  readableNote,
  readableTitle,
  reviewPresentation,
} from '../presentation';
import AppDialog from './AppDialog.vue';
const props = defineProps<{
  organizationId: string;
  initialRecordId: string;
  refreshVersion: number;
  reviewAlerts: WorkFeed['alerts'];
}>();
const emit = defineEmits<{
  task: [id: string, organizationId: string];
  create: [organizationId: string, sourceRecordId: string];
  review: [alert: WorkFeed['alerts'][number]];
  close: [];
}>();
const triage = ref<'all' | 'review' | 'expired'>('all');
const scope = ref<'related' | 'all'>('related');
const view = ref<'unread' | 'all'>('unread');
const data = ref<IntelligenceFeed>();
const detail = ref<IntelligenceDetail>();
const selectedId = ref('');
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const detailError = ref('');
const feedback = ref('');
const processed = ref(new Set<string>());
const inspector = ref<HTMLElement>();
const queue = ref<string[]>([]);
let serial = 0;
let detailSerial = 0;
const position = computed(() => queue.value.indexOf(selectedId.value));
const canCreate = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const tabName = (id: string) => tr(tabs.find((t) => t.id === id)?.title || id.replaceAll('_', ' '));
const label = (id: string) =>
  tr(
    knowledgeFields[detail.value?.item.tabId || '']?.find((f) => f.id === id)?.label ||
      id.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '),
  );
const fieldText = (id: string, value: string) =>
  fieldValueLabel({ id }, value) || tr('Not recorded');
const levelStatus = computed(() =>
  detail.value ? evidencePresentation(detail.value.item.verification) : undefined,
);
const relatedTasks = computed(() => detail.value?.tasks.filter((t) => t.link === 'direct') || []);
const otherTasks = computed(
  () => detail.value?.tasks.filter((t) => t.link === 'organization') || [],
);

async function load(more = false) {
  const request = ++serial;
  loading.value = true;
  error.value = '';
  try {
    const query = new URLSearchParams({
      scope: scope.value,
      view: view.value,
      queue: triage.value,
      organizationId: props.organizationId,
      limit: '30',
      offset: String(more ? data.value?.items.length || 0 : 0),
    });
    const result = await api<IntelligenceFeed>('/api/intelligence?' + query);
    if (request !== serial) return;
    // 「Load more」追加,按 ID 去重(新记录插到前面时偏移会重复)。
    data.value =
      more && data.value
        ? {
            ...result,
            items: [
              ...data.value.items,
              ...result.items.filter((i) => !data.value!.items.some((e) => e.id === i.id)),
            ],
          }
        : result;
  } catch (e) {
    if (request === serial) error.value = errorText(e);
  } finally {
    if (request === serial) loading.value = false;
  }
}
watch(
  () => [props.organizationId, scope.value, view.value, triage.value],
  () => {
    data.value = undefined;
    feedback.value = '';
    void load();
  },
  { immediate: true },
);
watch(
  () => props.refreshVersion,
  () => void load(),
);
async function open(item: IntelligenceItem | string, newQueue = true) {
  const id = typeof item === 'string' ? item : item.id;
  // 打开时把当前列表的顺序存为本次浏览队列,已处理数清零。
  if (newQueue) {
    queue.value = data.value?.items.map((i) => i.id) || [];
    if (!queue.value.includes(id)) queue.value = [id];
    processed.value = new Set();
  }
  selectedId.value = id;
  detail.value = undefined;
  detailError.value = '';
  feedback.value = '';
  const request = ++detailSerial;
  try {
    const result = await api<IntelligenceDetail>('/api/intelligence/' + encodeURIComponent(id));
    if (request !== detailSerial) return;
    detail.value = result;
    await nextTick();
    inspector.value?.closest('.dialog')?.scrollTo({ top: 0 });
  } catch (e) {
    if (request === detailSerial) detailError.value = errorText(e);
  }
}
watch(
  () => props.initialRecordId,
  (id) => {
    if (id && id !== selectedId.value) void open(id);
  },
  { immediate: true },
);
function close() {
  detailSerial++;
  selectedId.value = '';
  detail.value = undefined;
  emit('close');
}
async function setRead(read: boolean) {
  const current = detail.value;
  if (!current) return;
  await api(`/api/intelligence/${encodeURIComponent(current.item.id)}/read`, {
    method: 'POST',
    body: { revision: current.item.revision, read },
  });
  current.item.read = read;
}
async function read(next = false) {
  if (!detail.value || busy.value) return;
  busy.value = true;
  detailError.value = '';
  const id = selectedId.value;
  const wasRead = detail.value.item.read;
  const nextId = queue.value[position.value + 1];
  try {
    await setRead(true);
    if (!wasRead) processed.value.add(id);
    feedback.value = 'Marked read. Evidence status is unchanged.';
    await load();
    if (next && selectedId.value === id) {
      if (nextId) await open(nextId, false);
      else {
        const count = processed.value.size;
        close();
        feedback.value = tr('You reached the end of this batch. {0} records marked read.', [count]);
      }
    }
  } catch (e) {
    detailError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
async function unread() {
  if (!detail.value || busy.value) return;
  busy.value = true;
  detailError.value = '';
  try {
    await setRead(false);
    processed.value.delete(selectedId.value);
    await load();
    feedback.value = 'Marked unread.';
  } catch (e) {
    detailError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function create() {
  if (!detail.value) return;
  const { organizationId, id } = detail.value.item;
  close();
  emit('create', organizationId, id);
}
function openTask(id: string) {
  const org = detail.value?.item.organizationId || props.organizationId;
  close();
  emit('task', id, org);
}
// 自动刷新:页面可见、没有打开详情、没有保存进行中。
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    if (!document.hidden && !selectedId.value && !busy.value) void load();
  }, 30000);
});
onUnmounted(() => {
  serial++;
  detailSerial++;
  clearInterval(timer);
});
</script>
<template>
  <section class="intelligence-inbox">
    <details v-if="reviewAlerts.length" class="evidence-review-queue" open>
      <summary>
        {{ tr('Evidence to review') }}
        <span class="count">{{ reviewAlerts.length }}</span>
      </summary>
      <p class="hint">
        {{
          tr(
            'Conflicts and validity checks remain here until the evidence is resolved. Reading does not resolve them.',
          )
        }}
      </p>
      <button
        v-for="alert in reviewAlerts"
        :key="alert.id"
        type="button"
        class="attention-row"
        @click="emit('review', alert)"
      >
        <strong>{{ alert.title }}</strong>
        <span>
          {{
            alert.detail
              .split(' · ')
              .map((part) => tr(part))
              .join(' · ')
          }}
        </span>
      </button>
    </details>
    <p class="hint">
      {{
        organizationId
          ? tr('Information recorded for this organization.')
          : scope === 'all'
            ? tr('The latest recorded information across all organizations you can access.')
            : tr('Based on organizations you follow and your assigned or unassigned team work.')
      }}
    </p>
    <div class="intel-controls">
      <label>
        {{ tr('Relevance') }}
        <select v-model="scope" :disabled="!!organizationId">
          <option value="related">{{ tr('For my work & following') }}</option>
          <option value="all">{{ tr('All organizations') }}</option>
        </select>
      </label>
      <label>
        {{ tr('Show') }}
        <select v-model="view">
          <option value="unread">{{ tr('Unread revisions') }}</option>
          <option value="all">{{ tr('All information') }}</option>
        </select>
      </label>
      <label>
        {{ tr('Review queue') }}
        <select v-model="triage" @change="view = 'all'">
          <option value="all">{{ tr('All information') }}</option>
          <option value="review">{{ tr('Needs review') }}</option>
          <option value="expired">{{ tr('Review overdue') }}</option>
        </select>
      </label>
      <span class="hint">{{ tr('{0} records', [data?.total || 0]) }}</span>
      <button type="button" class="link" :disabled="loading" @click="load()">
        {{ tr('Refresh') }}
      </button>
    </div>
    <p v-if="error" class="error" role="alert">
      {{ tr(error) }}
      <button type="button" class="link" @click="load()">{{ tr('Retry') }}</button>
    </p>
    <p v-if="feedback && !selectedId" class="notice-inline" role="status">{{ tr(feedback) }}</p>
    <p v-if="loading && !data" class="hint">{{ tr('Loading intelligence…') }}</p>
    <ul v-if="data?.items.length" class="intel-list">
      <li v-for="i in data.items" :key="i.id">
        <button type="button" class="intel-row" :class="{ unread: !i.read }" @click="open(i)">
          <span class="intel-row-meta">
            {{ i.organizationName }} · {{ tabName(i.tabId) }}
            <span v-if="!i.read" class="intel-unread">{{ tr('New to you') }}</span>
          </span>
          <strong>{{ readableTitle(i.title) }}</strong>
          <span class="intel-row-summary">
            {{
              readableNote(i.summary) ||
              i.scope ||
              tr('Open the recorded information and its original source.')
            }}
          </span>
          <span class="intel-row-bottom">
            <span class="status-badge" :class="'tone-' + reviewPresentation(i.status).tone">
              {{ reviewPresentation(i.status).label }}
            </span>
            <span>
              {{ i.revision > 1 ? tr('Updated · v{0}', [i.revision]) : tr('Recorded') }} ·
              {{ dateTime(i.updatedAt) }}
            </span>
          </span>
          <span v-if="i.reasons.length" class="intel-reason">
            {{ i.reasons.map((reason) => tr(reason)).join(' · ') }}
          </span>
        </button>
      </li>
    </ul>
    <div v-if="data && !data.items.length" class="empty intel-empty">
      <h3>
        {{
          view === 'unread'
            ? tr('You are caught up in this scope')
            : tr('No information in this scope')
        }}
      </h3>
      <p>
        {{
          tr('Follow an organization or broaden the scope to explore more recorded intelligence.')
        }}
      </p>
      <button
        v-if="scope === 'related' && !organizationId"
        type="button"
        class="ghost"
        @click="scope = 'all'"
      >
        {{ tr('Explore all organizations') }}
      </button>
      <button v-else-if="view === 'unread'" type="button" class="ghost" @click="view = 'all'">
        {{ tr('Include read information') }}
      </button>
    </div>
    <button
      v-if="data?.hasMore"
      type="button"
      class="ghost"
      :disabled="loading"
      @click="load(true)"
    >
      {{ tr('Load more') }}
    </button>
    <p class="hint intel-footnote">
      {{
        tr(
          'Read status is personal and applies to this revision. Reading does not confirm or verify a claim.',
        )
      }}
    </p>
    <AppDialog
      v-if="selectedId"
      :title="detail?.item.organizationName || tr('Recorded information')"
      :eyebrow="tr('INTELLIGENCE')"
      :busy="busy"
      wide
      @close="close"
    >
      <div ref="inspector" class="intel-inspector">
        <nav class="intel-navigation" :aria-label="tr('Intelligence queue')">
          <button
            type="button"
            class="link"
            :disabled="busy || position <= 0"
            @click="open(queue[position - 1]!, false)"
          >
            {{ tr('← Previous') }}
          </button>
          <span class="hint">{{ tr('{0} of {1}', [position + 1, queue.length]) }}</span>
          <button
            type="button"
            class="link"
            :disabled="busy || position >= queue.length - 1"
            @click="open(queue[position + 1]!, false)"
          >
            {{ tr('Next →') }}
          </button>
        </nav>
        <p v-if="detailError" class="error" role="alert">{{ tr(detailError) }}</p>
        <template v-if="detail">
          <span class="hint">
            {{
              tr('{0} · Recorded {1}', [
                tabName(detail.item.tabId),
                dateTime(detail.item.updatedAt),
              ])
            }}
          </span>
          <h3>{{ readableTitle(detail.item.title) }}</h3>
          <div class="work-actions">
            <span
              v-if="detail.item.verification"
              class="status-badge"
              :class="'tone-' + levelStatus?.tone"
            >
              {{ levelStatus?.label }}
            </span>
            <span
              class="status-badge"
              :class="'tone-' + reviewPresentation(detail.item.status).tone"
            >
              {{ reviewPresentation(detail.item.status).label }}
            </span>
            <span v-if="detail.item.read" class="hint">{{ tr('Read by you') }}</span>
          </div>
          <p v-if="detail.item.reasons.length" class="intel-reason">
            {{ detail.item.reasons.map((reason) => tr(reason)).join(' · ') }}
          </p>
          <p class="preserve-lines">{{ readableNote(detail.body) }}</p>
          <p v-if="detail.item.scope" class="hint">
            {{ tr('Scope: {0}', [detail.item.scope]) }}
          </p>
          <section v-if="detail.changes.length" class="intel-changes">
            <h4>{{ tr('What changed') }}</h4>
            <dl>
              <div v-for="c in detail.changes" :key="c.field">
                <dt>{{ label(c.field) }}</dt>
                <dd>
                  <del>{{ fieldText(c.field, c.before) }}</del>
                  <strong>{{ fieldText(c.field, c.after) }}</strong>
                </dd>
              </div>
            </dl>
          </section>
          <p v-else-if="detail.item.revision > 1" class="hint">
            {{
              detail.hasPrevious
                ? tr(
                    'No text or structured-field change in the available comparison. Check the source and full history for other changes.',
                  )
                : tr('An earlier revision is not available for comparison.')
            }}
          </p>
          <div class="intel-source">
            <div>
              <strong>{{ sourceName(detail.source.source, detail.source.url) }}</strong>
              <small class="hint">
                {{ tr('Captured {0}', [dateTime(detail.source.capturedAt)]) }}
              </small>
            </div>
            <button type="button" class="link" @click="openEvidence(detail.item.evidenceId)">
              {{ tr('Inspect evidence') }}
            </button>
          </div>
          <details v-if="Object.keys(detail.structured).length" class="intel-fields">
            <summary>{{ tr('All recorded fields') }}</summary>
            <dl class="intel-grid">
              <div v-for="(v, k) in detail.structured" :key="k">
                <dt>{{ label(String(k)) }}</dt>
                <dd>{{ fieldText(String(k), v) }}</dd>
              </div>
            </dl>
          </details>
          <section class="intel-connections">
            <h4>{{ tr('Connected work') }}</h4>
            <button
              v-for="t in relatedTasks"
              :key="t.id"
              type="button"
              class="context-link"
              @click="openTask(t.id)"
            >
              {{ t.title }}
              <small class="hint">
                {{
                  tr('Linked through this reference or a shared object · {0}', [
                    tr(taskStates[t.state]),
                  ])
                }}
              </small>
            </button>
            <p v-if="!relatedTasks.length" class="hint">
              {{ tr('No task is directly linked to this information yet.') }}
            </p>
            <button v-if="canCreate" type="button" class="ghost" @click="create">
              + {{ tr('Create evidence-backed follow-up') }}
            </button>
          </section>
          <details v-if="otherTasks.length" class="intel-fields">
            <summary>
              {{ tr('Other work at {0} · {1}', [detail.item.organizationName, otherTasks.length]) }}
            </summary>
            <button
              v-for="t in otherTasks"
              :key="t.id"
              type="button"
              class="context-link"
              @click="openTask(t.id)"
            >
              {{ t.title }}
              <small class="hint">{{
                tr('Same organization · {0}', [tr(taskStates[t.state])])
              }}</small>
              <small class="hint">
                {{ tr('Relevance to this information has not been established.') }}
              </small>
            </button>
          </details>
          <section v-if="detail.objects.length" class="intel-connections">
            <h4>{{ tr('Related objects') }}</h4>
            <RouterLink
              v-for="o in detail.objects"
              :key="o.id"
              class="context-link"
              :to="{
                path: `/w/internal/organizations/${detail.item.organizationId}/relationships`,
                query: { object: o.id },
              }"
            >
              {{ o.name }}
              <small class="hint">{{ tr(o.kind) }}</small>
            </RouterLink>
          </section>
          <details v-if="detail.contacts.length" class="intel-fields">
            <summary>{{ tr('Contacts at this organization') }}</summary>
            <p class="hint">{{ tr('Contact relevance to this topic is not confirmed.') }}</p>
            <RouterLink
              v-for="c in detail.contacts"
              :key="c.id"
              class="context-link"
              :to="{
                path: `/w/internal/organizations/${detail.item.organizationId}/contacts`,
                query: { record: c.id },
              }"
            >
              {{ c.name || c.title }}
              <small v-if="c.name" class="hint">{{ c.title }}</small>
            </RouterLink>
          </details>
          <RouterLink
            :to="{
              path: `/w/internal/organizations/${detail.item.organizationId}/${detail.item.tabId}`,
              query: { record: detail.item.id },
            }"
          >
            {{ tr('Open full record & review options') }} ↗
          </RouterLink>
          <p v-if="feedback" class="notice-inline" role="status">{{ tr(feedback) }}</p>
        </template>
        <p v-else-if="!detailError" class="hint">{{ tr('Loading information…') }}</p>
        <div v-if="detail" class="actions">
          <button
            type="button"
            class="ghost"
            :disabled="busy"
            @click="detail.item.read ? unread() : read()"
          >
            {{ detail.item.read ? tr('Mark unread') : tr('Mark read') }}
          </button>
          <button type="button" :disabled="busy" @click="read(true)">
            {{
              busy
                ? tr('Saving…')
                : position < queue.length - 1
                  ? tr('Mark read & next')
                  : tr('Mark read & finish')
            }}
          </button>
        </div>
      </div>
    </AppDialog>
  </section>
</template>
