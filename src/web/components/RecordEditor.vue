<script setup lang="ts">
// 记录编辑器(frontend-spec 5.6),从 v1 RecordEditor.vue 迁移。组织架构图、人员变动、讨论的专属字段
// 随各自模块一起迁移(registry.ts pendingModules)。
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { tr } from '../i18n';
import { useDraft } from '../draft';
import { defaultsFor, knowledgeFields } from '../../shared/knowledge';
import type { ModuleRecord, TabDefinition } from '../../shared/types';
import AppDialog from './AppDialog.vue';
import KnowledgeFields from './KnowledgeFields.vue';
const props = defineProps<{
  organization: { id: string; name: string };
  tab: TabDefinition;
  record?: ModuleRecord;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const form = reactive({
  title: props.record?.title || '',
  body: props.record?.body || '',
  scope: props.record?.scope || tr('Organization-wide'),
  status: props.record?.status || 'unverified',
  visibility: props.record?.visibility || 'team',
  personName: props.record?.personName || '',
  personEmail: props.record?.personEmail || '',
  structured: {
    ...defaultsFor(props.tab.id),
    ...(knowledgeFields[props.tab.id]
      ? {
          owner: session.user?.name || '',
          reviewedOn: new Date().toISOString().slice(0, 10),
        }
      : {}),
    ...props.record?.structured,
  } as Record<string, string>,
  rawText: '',
  reuseReference: !!props.record,
  sourceUrl: '',
  revision: props.record?.revision,
});
const {
  hasDraft,
  restore,
  clear: clearDraft,
  storageError,
} = useDraft(
  `record:${props.organization.id}:${props.tab.id}:${props.record?.id || 'new'}:${props.record?.revision || 0}`,
  () => ({ ...form }),
  (value) => Object.assign(form, value),
);
const initialForm = JSON.stringify(form);
const dirty = () => JSON.stringify(form) !== initialForm;
const discardPrompt = ref(false);
function closeEditor() {
  if (dirty()) discardPrompt.value = true;
  else emit('close');
}
const router = useRouter();
const removeGuard = router.beforeEach(
  () =>
    !dirty() ||
    window.confirm(
      tr(
        'Leave the editor? Your text draft stays in this tab; attachments must be selected again.',
      ),
    ),
);
onUnmounted(removeGuard);
const title = computed(() => (props.record ? tr('Edit record') : tr('Add organization knowledge')));
const error = ref('');
const saving = ref(false);
const file = ref<File>();
async function save() {
  saving.value = true;
  error.value = '';
  try {
    let attachment: { filename: string; base64: string } | undefined;
    if (file.value) {
      if (file.value.size > 5_000_000) throw new Error('The attachment limit is 5 MB.');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]!);
        reader.onerror = reject;
        reader.readAsDataURL(file.value!);
      });
      attachment = { filename: file.value.name, base64 };
    }
    const base = `/api/organizations/${props.organization.id}/tabs/${props.tab.id}/records`;
    await api(props.record ? `${base}/${props.record.id}` : base, {
      method: props.record ? 'PATCH' : 'POST',
      body: { ...form, attachment },
    });
    clearDraft();
    emit('saved');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <AppDialog
    :title="title"
    :eyebrow="`${organization.name} / ${tr(tab.title)}`"
    :busy="saving"
    wide
    @close="closeEditor"
  >
    <form class="record-editor" @submit.prevent="save">
      <div v-if="hasDraft" class="notice">
        <span>{{ tr('An unsent draft is available in this tab.') }}</span>
        <span>
          <button type="button" class="link" @click="restore">{{ tr('Restore draft') }}</button>
          <button type="button" class="link" @click="clearDraft">{{ tr('Discard draft') }}</button>
        </span>
      </div>
      <p v-if="storageError" role="alert" class="error">{{ storageError }}</p>
      <div v-if="discardPrompt" class="notice" role="alert">
        <span>{{
          tr('Close the editor and keep its text draft? Attachments are not saved.')
        }}</span>
        <span>
          <button type="button" class="ghost" @click="emit('close')">
            {{ tr('Keep draft and close') }}
          </button>
          <button type="button" class="link" @click="discardPrompt = false">
            {{ tr('Continue editing') }}
          </button>
        </span>
      </div>
      <label for="record-title">{{ tr('Title') }}</label>
      <input
        id="record-title"
        v-model="form.title"
        required
        maxlength="160"
        :placeholder="tr('Summarize this information in one sentence.')"
      />
      <KnowledgeFields v-if="knowledgeFields[tab.id]" :tab-id="tab.id" :model="form.structured" />
      <div v-if="tab.id === 'contacts'" class="form-grid">
        <label>
          {{ tr('Person name (optional)') }}
          <input v-model="form.personName" maxlength="100" />
        </label>
        <label>
          {{ tr('Person email (if known)') }}
          <input
            v-model="form.personEmail"
            type="email"
            maxlength="200"
            :placeholder="tr('Leave empty if not published or confirmed')"
          />
        </label>
      </div>
      <label for="record-body">{{ tr('Notes') }}</label>
      <textarea
        id="record-body"
        v-model="form.body"
        required
        rows="4"
        maxlength="20000"
        :placeholder="tr('Record a fact, observation or follow-up…')"
      />
      <div class="form-grid">
        <label>
          {{ tr('Scope') }}
          <input
            v-model="form.scope"
            required
            maxlength="300"
            :placeholder="tr('e.g. Institutional / Spot / Europe')"
          />
        </label>
        <label>
          {{ tr('Team review and follow-up') }}
          <select v-model="form.status">
            <option value="unverified">{{ tr('Needs review') }}</option>
            <option value="confirmed">{{ tr('Marked confirmed') }}</option>
            <option value="in_progress">{{ tr('Follow-up in progress') }}</option>
            <option value="done">{{ tr('Follow-up complete') }}</option>
          </select>
        </label>
      </div>
      <fieldset class="form-section">
        <legend>{{ tr('Keep the original reference') }}</legend>
        <p class="hint">
          {{
            tr(
              'Original text and attachments are saved separately. Every edit preserves the previous version.',
            )
          }}
        </p>
        <label v-if="record" class="choice">
          <input v-model="form.reuseReference" type="checkbox" />
          <span>{{ tr('Keep the existing original reference') }}</span>
        </label>
        <template v-if="!form.reuseReference">
          <label for="record-raw">{{ tr('Original text') }}</label>
          <textarea
            id="record-raw"
            v-model="form.rawText"
            required
            rows="3"
            maxlength="100000"
            :placeholder="
              tr(
                'Paste the original email, meeting note or page excerpt. For your own observations, include what you observed and when.',
              )
            "
          />
          <label for="record-url">{{ tr('Source URL (optional)') }}</label>
          <input id="record-url" v-model="form.sourceUrl" type="url" placeholder="https://…" />
        </template>
        <label for="record-file">{{ tr('Attachment (optional, up to 5 MB)') }}</label>
        <input
          id="record-file"
          type="file"
          @change="file = ($event.target as HTMLInputElement).files?.[0]"
        />
      </fieldset>
      <template v-if="session.user?.role === 'admin'">
        <label for="record-visibility">{{ tr('Visibility') }}</label>
        <select id="record-visibility" v-model="form.visibility" :disabled="!!record">
          <option value="team">{{ tr('Internal team') }}</option>
          <option value="admin">{{ tr('Administrators only') }}</option>
        </select>
      </template>
      <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
      <div class="actions">
        <span class="hint push">
          {{
            record
              ? tr('Current version v{0}', [record.revision])
              : tr('Edits retain the original reference.')
          }}
        </span>
        <button type="button" class="ghost" :disabled="saving" @click="closeEditor">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="saving">
          {{ saving ? tr('Saving…') : tr('Save record') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
