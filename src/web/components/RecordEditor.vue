<script setup lang="ts">
// 记录编辑器(frontend-spec 5.6;组织架构 6.4、人员变动 6.8),从 v1 RecordEditor.vue 迁移。
// 讨论(5.9)的编辑:只改正文,正文本身作为新的原引用保存。
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { tr } from '../i18n';
import { useDraft } from '../draft';
import { defaultsFor, knowledgeFields } from '../../shared/knowledge';
import { descendants } from '../../shared/org-chart';
import { datePrecision } from '../../shared/movement-date';
import {
  movementDateLabels,
  movementPerspective,
  movementTransition,
  movementType,
} from '../../shared/people-movements';
import type { ModuleRecord, TabDefinition } from '../../shared/types';
import AppDialog from './AppDialog.vue';
import KnowledgeFields from './KnowledgeFields.vue';
const props = defineProps<{
  organization: { id: string; name: string };
  tab: TabDefinition;
  record?: ModuleRecord;
  // 同一 tab 的记录:组织架构图用来列出可选上级。
  records?: ModuleRecord[];
  // 路线图空态的分栏按钮预选计划类型(10.11)。
  planType?: string;
}>();
const chart = props.tab.kind === 'chart';
const timeline = props.tab.kind === 'timeline';
const comments = props.tab.kind === 'comments';
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
    ...(props.planType ? { planType: props.planType } : {}),
    ...props.record?.structured,
    ...(timeline
      ? {
          eventDatePrecision:
            props.record?.structured.eventDatePrecision ||
            datePrecision(props.record?.eventDate || ''),
          dateLabel: props.record?.structured.dateLabel || '',
          dateBasis: props.record?.structured.dateBasis || 'unknown',
          fromRole: props.record?.structured.fromRole || '',
          toRole: props.record?.structured.toRole || '',
          fromOrganization: props.record?.structured.fromOrganization || '',
          toOrganization: props.record?.structured.toOrganization || '',
        }
      : {}),
  } as Record<string, string>,
  ...(chart
    ? {
        reportsTo: props.record?.reportsTo || '',
        relationshipKind: props.record?.relationshipKind || 'unconfirmed',
        relationshipNote: '',
      }
    : {}),
  ...(timeline
    ? { eventDate: props.record?.eventDate || '', eventType: props.record?.eventType || '' }
    : {}),
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
const roadmap = props.tab.id === 'roadmap';
const title = computed(() =>
  roadmap
    ? props.record
      ? tr('Edit milestone')
      : tr('Add milestone')
    : chart
      ? props.record
        ? tr('Edit person')
        : tr('Add person')
      : comments && !props.record
        ? tr('Add discussion')
        : props.record
          ? tr('Edit record')
          : tr('Add organization knowledge'),
);
// ---- 组织架构图(6.4):上级只能是非后代、可见性与表单一致的人员 ----
const invalidParents = computed(() =>
  props.record ? descendants(props.records ?? [], props.record.id) : new Set<string>(),
);
const parentChoices = computed(() =>
  (props.records ?? []).filter(
    (r) => !invalidParents.value.has(r.id) && r.visibility === form.visibility,
  ),
);
const relationshipChanged = computed(
  () =>
    !!props.record &&
    chart &&
    (form.reportsTo !== props.record.reportsTo ||
      (!!form.reportsTo && form.relationshipKind !== props.record.relationshipKind)),
);
// ---- 人员变动(6.8):改精度时截断已填日期;实时预览本机构视角的分类 ----
function changeDatePrecision() {
  const precision = form.structured.eventDatePrecision;
  const value = form.eventDate ?? '';
  form.eventDate =
    precision === 'unknown'
      ? ''
      : precision === 'year'
        ? value.slice(0, 4)
        : precision === 'month'
          ? value.slice(0, 7)
          : value.length === 10
            ? value
            : '';
}
const movementForm = computed(() => ({
  eventType: form.eventType ?? '',
  structured: form.structured,
}));
const movementPreview = computed(() =>
  movementType(movementPerspective(movementForm.value, props.organization.name)),
);
const movementEndpoints = computed(() =>
  movementTransition(movementForm.value, props.organization.name),
);
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
      body: {
        ...form,
        ...(comments
          ? {
              title: form.body.trim().split('\n')[0]!.slice(0, 160),
              rawText: form.body,
              reuseReference: false,
            }
          : {}),
        attachment,
      },
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
      <label v-if="!comments" for="record-title">
        {{ chart ? tr('Role / job title') : tr('Title') }}
      </label>
      <input
        v-if="!comments"
        id="record-title"
        v-model="form.title"
        required
        maxlength="160"
        :placeholder="
          chart
            ? tr('e.g. Head of Institutional Sales')
            : tr('Summarize this information in one sentence.')
        "
      />
      <div v-if="chart || timeline" class="form-grid">
        <label>
          {{ tr('Person name') }}
          <input v-model="form.personName" required maxlength="100" :placeholder="tr('Name')" />
        </label>
        <label v-if="chart">
          {{ tr('Reports to') }}
          <select v-model="form.reportsTo">
            <option value="">{{ tr('No recorded manager / Top level') }}</option>
            <option v-for="parent in parentChoices" :key="parent.id" :value="parent.id">
              {{ parent.personName }} · {{ parent.title }}
            </option>
          </select>
        </label>
        <template v-if="timeline">
          <label>
            {{ tr('Event described by source') }}
            <select v-model="form.eventType" required>
              <option value="" disabled>{{ tr('Select a type') }}</option>
              <option value="joined">{{ tr('Joined') }}</option>
              <option value="left">{{ tr('Departed') }}</option>
              <option value="role_change">{{ tr('Role change') }}</option>
            </select>
          </label>
          <label>
            {{ tr('Date meaning') }}
            <select v-model="form.structured.dateBasis">
              <option v-for="(label, basis) in movementDateLabels" :key="basis" :value="basis">
                {{ tr(label) }}
              </option>
            </select>
          </label>
          <label>
            {{ tr('Date precision') }}
            <select v-model="form.structured.eventDatePrecision" @change="changeDatePrecision">
              <option value="day">{{ tr('Exact day published') }}</option>
              <option value="month">{{ tr('Month only') }}</option>
              <option value="year">{{ tr('Year only') }}</option>
              <option value="unknown">{{ tr('Date not published') }}</option>
            </select>
          </label>
          <label v-if="form.structured.eventDatePrecision !== 'unknown'">
            {{
              form.structured.eventDatePrecision === 'month' ? tr('Event month') : tr('Event date')
            }}
            <input
              v-model="form.eventDate"
              :type="
                form.structured.eventDatePrecision === 'year'
                  ? 'text'
                  : form.structured.eventDatePrecision === 'month'
                    ? 'month'
                    : 'date'
              "
              :pattern="form.structured.eventDatePrecision === 'year' ? '[0-9]{4}' : undefined"
              required
            />
          </label>
          <label>
            {{ tr('Date wording in source') }}
            <input
              v-model="form.structured.dateLabel"
              maxlength="500"
              :placeholder="tr('e.g. Post: 2mo ago; exact joining date not stated')"
            />
          </label>
        </template>
      </div>
      <fieldset v-if="timeline" class="form-section">
        <legend>{{ tr('Before and after') }}</legend>
        <p class="hint">
          {{ tr('Only enter details stated by the source. Leave unknown values empty.') }}
        </p>
        <div class="form-grid">
          <label>
            {{ tr('Previous organization') }}
            <input
              v-model="form.structured.fromOrganization"
              maxlength="200"
              :placeholder="movementEndpoints.fromOrganization || tr('Not recorded')"
            />
          </label>
          <label>
            {{ tr('Next organization') }}
            <input
              v-model="form.structured.toOrganization"
              maxlength="200"
              :placeholder="movementEndpoints.toOrganization || tr('Not recorded')"
            />
          </label>
          <label>
            {{ tr('Previous role') }}
            <input v-model="form.structured.fromRole" maxlength="200" />
          </label>
          <label>
            {{ tr('New role') }}
            <input v-model="form.structured.toRole" maxlength="200" />
          </label>
        </div>
        <p class="hint" role="status">
          {{
            tr('In {0}, this will appear as: {1}', [organization.name, tr(movementPreview.label)])
          }}
        </p>
      </fieldset>
      <template v-if="chart">
        <label v-if="form.reportsTo">
          {{ tr('Reporting relationship') }}
          <select v-model="form.relationshipKind">
            <option value="unconfirmed">{{ tr('Unconfirmed relationship · Dashed line') }}</option>
            <option value="confirmed">{{ tr('Confirmed direct report · Solid line') }}</option>
          </select>
        </label>
        <label v-if="form.reportsTo || relationshipChanged">
          {{ tr('Relationship evidence / reason for change') }}
          <textarea
            v-model="form.relationshipNote"
            :required="relationshipChanged && form.reuseReference"
            rows="3"
            maxlength="100000"
            :placeholder="
              tr(
                'Original correspondence or a first-hand note, including who confirmed it and when. New positions can use the original reference below.',
              )
            "
          />
        </label>
      </template>
      <KnowledgeFields v-if="knowledgeFields[tab.id]" :tab-id="tab.id" :model="form.structured" />
      <div v-if="chart || timeline || tab.id === 'contacts'" class="form-grid">
        <label v-if="tab.id === 'contacts'">
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
      <label for="record-body">{{ comments ? tr('Message') : tr('Notes') }}</label>
      <textarea
        id="record-body"
        v-model="form.body"
        required
        rows="4"
        maxlength="20000"
        :placeholder="tr('Record a fact, observation or follow-up…')"
      />
      <div v-if="!comments" class="form-grid">
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
          {{ roadmap ? tr('Evidence review') : tr('Team review and follow-up') }}
          <select v-model="form.status">
            <option value="unverified">{{ tr('Needs review') }}</option>
            <option value="confirmed">{{ tr('Marked confirmed') }}</option>
            <option value="in_progress">{{ tr('Follow-up in progress') }}</option>
            <option value="done">{{ tr('Follow-up complete') }}</option>
          </select>
        </label>
      </div>
      <fieldset v-if="!comments" class="form-section">
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
          {{ saving ? tr('Saving…') : chart ? tr('Save person') : tr('Save record') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
