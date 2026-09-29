<script setup lang="ts">
// 讨论(Comments tab)与联系人对话记录(frontend-spec 5.9),从 v1 DiscussionPanel.vue 迁移。
import { computed, ref } from 'vue';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { useDraft } from '../draft';
import type { ModuleData, ModuleRecord, Organization } from '../../shared/types';
import Icon from './Icon.vue';
const props = defineProps<{
  organization: Organization;
  records: ModuleRecord[];
  // 有值时是该联系人的对话记录:只列 relatedRecord 等于它的讨论,新消息继承它的可见性。
  contact?: ModuleRecord;
}>();
const emit = defineEmits<{ refresh: []; edit: [record: ModuleRecord] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const body = ref('');
const replying = ref<ModuleRecord>();
const busy = ref(false);
const error = ref('');
const visibility = ref<'team' | 'admin'>(props.contact?.visibility || 'team');
const local = ref<ModuleRecord[]>([]);
const loaded = ref(!props.contact);
const records = computed(() => (props.contact ? local.value : props.records));
const roots = computed(() =>
  records.value.filter(
    (r) => !r.structured.replyTo || !records.value.some((p) => p.id === r.structured.replyTo),
  ),
);
const replies = (id: string) => records.value.filter((r) => r.structured.replyTo === id);
const composeId = computed(() => (props.contact ? 'conversation-compose' : 'discussion-compose'));
const { hasDraft, restore, clear, storageError } = useDraft(
  `discussion:${props.organization.id}:${props.contact?.id || 'general'}`,
  () => ({
    body: body.value,
    visibility: replying.value?.visibility || visibility.value,
    replyId: replying.value?.id || '',
  }),
  (v) => {
    body.value = v.body;
    visibility.value = v.visibility === 'admin' ? 'admin' : 'team';
    replying.value = records.value.find((record) => record.id === v.replyId);
  },
);
async function loadContactHistory() {
  if (!props.contact) return;
  try {
    const data = await api<ModuleData>(`/api/organizations/${props.organization.id}/tabs/comments`);
    local.value = (data.records ?? []).filter(
      (r) => r.structured.relatedRecord === props.contact?.id,
    );
  } catch (e) {
    error.value = errorText(e);
  } finally {
    loaded.value = true;
  }
}
void loadContactHistory();
async function save() {
  if (!body.value.trim() || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api(`/api/organizations/${props.organization.id}/tabs/comments/records`, {
      method: 'POST',
      body: {
        // 消息正文本身就是原引用。
        title: body.value.trim().split('\n')[0]!.slice(0, 160),
        body: body.value,
        rawText: body.value,
        scope: 'Organization-wide',
        status: 'unverified',
        visibility: replying.value?.visibility || props.contact?.visibility || visibility.value,
        structured: {
          replyTo: replying.value?.id || '',
          relatedRecord: props.contact?.id || replying.value?.structured.relatedRecord || '',
          occurredOn: '',
        },
      },
    });
    body.value = '';
    replying.value = undefined;
    clear();
    await loadContactHistory();
    emit('refresh');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function reply(record: ModuleRecord) {
  replying.value = record;
  document.getElementById(composeId.value)?.focus();
}
</script>
<template>
  <section class="discussion-panel">
    <form v-if="canEdit" class="discussion-compose" @submit.prevent="save">
      <label :for="composeId">
        {{ tr(contact ? 'Record a conversation' : 'Share an update or ask the team') }}
      </label>
      <p v-if="replying" class="hint">
        {{ tr('Replying to {0}', [replying.author]) }}
        <button type="button" class="link" @click="replying = undefined">
          {{ tr('Cancel reply') }}
        </button>
      </p>
      <div v-if="hasDraft" class="notice">
        <span>{{ tr('An unsent draft is available in this tab.') }}</span>
        <span>
          <button type="button" class="link" @click="restore">{{ tr('Restore draft') }}</button>
          <button type="button" class="link" @click="clear">{{ tr('Discard draft') }}</button>
        </span>
      </div>
      <textarea
        :id="composeId"
        v-model="body"
        required
        maxlength="20000"
        rows="3"
        :placeholder="tr('What changed, what did you learn, or what needs a decision?')"
      />
      <footer>
        <small>{{ tr('Your message is saved as its original reference.') }}</small>
        <select
          v-if="session.user?.role === 'admin' && !replying && !contact"
          v-model="visibility"
          :aria-label="tr('Visibility')"
        >
          <option value="team">{{ tr('Internal team') }}</option>
          <option value="admin">{{ tr('Administrators only') }}</option>
        </select>
        <button type="submit" :disabled="busy || !body.trim()">
          {{ tr(busy ? 'Saving…' : 'Post update') }}
        </button>
      </footer>
    </form>
    <p v-if="error || storageError" role="alert" class="error">
      {{ tr(error) || storageError }}
    </p>
    <p v-if="loaded && !records.length" class="hint">
      {{
        tr(
          contact
            ? 'No conversations recorded yet.'
            : 'No discussion yet. Start with a question or a short update.',
        )
      }}
    </p>
    <article
      v-for="record in roots"
      :id="'record-' + record.id"
      :key="record.id"
      class="discussion-message"
    >
      <header>
        <strong>{{ record.author }}</strong>
        <small>{{ dateTime(record.updatedAt) }}</small>
        <span v-if="record.visibility === 'admin'" class="tag">
          <Icon name="lock" :size="11" /> {{ tr('Administrator') }}
        </span>
      </header>
      <p class="record-body">{{ record.body }}</p>
      <footer>
        <button v-if="canEdit" type="button" class="link" @click="reply(record)">
          {{ tr('Reply') }}
        </button>
        <button type="button" class="link" @click="openEvidence(record.evidenceId)">
          {{ tr('Original reference') }}
        </button>
        <button v-if="!contact && canEdit" type="button" class="link" @click="emit('edit', record)">
          {{ tr('Edit') }}
        </button>
        <RouterLink
          v-if="canEdit"
          :to="{
            path: '/w/internal/work',
            query: { organizationId: organization.id, sourceRecord: record.id },
          }"
        >
          {{ tr('Create follow-up task') }}
        </RouterLink>
      </footer>
      <article
        v-for="response in replies(record.id)"
        :id="'record-' + response.id"
        :key="response.id"
        class="discussion-reply"
      >
        <header>
          <strong>{{ response.author }}</strong>
          <small>{{ dateTime(response.updatedAt) }}</small>
        </header>
        <p class="record-body">{{ response.body }}</p>
        <button type="button" class="link" @click="openEvidence(response.evidenceId)">
          {{ tr('Original reference') }}
        </button>
      </article>
    </article>
  </section>
</template>
