<script setup lang="ts">
// 导入 / 更新个人履历(frontend-spec 6.13),从 v1 PersonProfileImport.vue 迁移。
// 提交前先在前端按同一套规则校验,只显示第一条错误;服务端按保存后的完整履历再校验一次。
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorText, session } from '../api';
import { tr } from '../i18n';
import {
  careerPositionSchema,
  careerTransitionProblem,
  personProfileSchema,
  type PersonCareer,
  type PersonProfileInput,
  type PersonSourceProfile,
} from '../../shared/person-profile';
import type { IdentitySearch } from '../../shared/identities';
import type { WorkFeed } from '../../shared/operations';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ identityId?: string; name?: string; profileId?: string }>();
const emit = defineEmits<{ close: []; saved: [identityId: string, unchanged: boolean] }>();
const form = reactive<PersonProfileInput>({
  url: '',
  name: props.name ?? '',
  identityId: props.identityId ?? '',
  reason: '',
  visibility: 'team',
  observedOn: new Date().toISOString().slice(0, 10),
  rawText: '',
  note: '',
  positions: [],
});
const organizations = ref<WorkFeed['organizations']>([]);
const people = ref<IdentitySearch['objects']>([]);
const busy = ref(false);
const error = ref('');
const loaded = ref(false);
const isAdmin = computed(() => session.user?.role === 'admin');
const add = () =>
  form.positions.push({
    ...careerPositionSchema.parse({ key: crypto.randomUUID(), organizationName: '_', role: '_' }),
    organizationName: '',
    role: '',
  });
onMounted(async () => {
  try {
    organizations.value = (await api<WorkFeed>('/api/work')).organizations;
    if (props.profileId) {
      const d = await api<{
        profile: PersonSourceProfile;
        positions: PersonCareer[];
        name: string;
      }>('/api/talent/source-profiles/' + encodeURIComponent(props.profileId));
      Object.assign(form, {
        url: d.profile.url,
        name: d.name,
        identityId: d.profile.objectId,
        visibility: d.profile.visibility,
        revision: d.profile.revision,
        note: d.profile.note,
        positions: d.positions.map(
          ({ id: _id, profileId: _p, evidenceId: _e, updatedAt: _u, provider: _v, ...p }) => p,
        ),
      });
      loaded.value = true;
    } else add();
  } catch (e) {
    error.value = errorText(e);
  }
});
async function findPeople() {
  try {
    people.value = (
      await api<IdentitySearch>(
        '/api/knowledge/identities?kind=person&q=' + encodeURIComponent(form.name),
      )
    ).objects;
  } catch (e) {
    error.value = errorText(e);
  }
}
function mapOrganization(index: number) {
  const p = form.positions[index]!;
  const org = organizations.value.find((o) => o.id === p.organizationId);
  if (org) p.organizationName = org.name;
}
async function save() {
  error.value = '';
  busy.value = true;
  try {
    const parsed = personProfileSchema.safeParse(form);
    if (!parsed.success)
      throw new Error(parsed.error.issues[0]?.message || 'Check the profile fields.');
    const problem = careerTransitionProblem(parsed.data.positions);
    if (problem) throw new Error(problem);
    const result = await api<{ identityId: string; unchanged: boolean }>(
      '/api/talent/source-profiles',
      { method: 'POST', body: parsed.data },
    );
    emit('saved', result.identityId, result.unchanged);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AppDialog
    :title="tr(profileId ? 'Update source profile' : 'Import personal profile')"
    :busy="busy"
    wide
    @close="emit('close')"
  >
    <form class="person-import" @submit.prevent="save">
      <p class="hint">
        {{
          tr(
            'One personal profile, one person. Add the career entries shown by the source and keep the original text.',
          )
        }}
      </p>
      <div class="form-grid">
        <label>
          {{ tr('Person name') }}
          <input v-model="form.name" required maxlength="160" />
        </label>
        <label>
          {{ tr('Personal profile URL') }}
          <input
            v-model="form.url"
            required
            type="url"
            :readonly="loaded"
            placeholder="https://www.linkedin.com/in/…"
          />
        </label>
      </div>
      <details v-if="!profileId" class="talent-section" :open="!!props.identityId">
        <summary>
          {{ tr('Add to an existing person') }}
          <span v-if="form.identityId">✓</span>
        </summary>
        <button type="button" class="link" @click="findPeople">
          {{ tr('Find matching dossiers') }}
        </button>
        <label>
          {{ tr('Person dossier') }}
          <select v-model="form.identityId">
            <option value="">{{ tr('Create a person if this profile is new') }}</option>
            <option
              v-if="props.identityId && !people.some((p) => p.id === props.identityId)"
              :value="props.identityId"
            >
              {{ props.name }}
            </option>
            <option v-for="p in people" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.organizations?.map((o) => o.name).join(', ') }}
            </option>
          </select>
        </label>
        <label v-if="form.identityId">
          {{ tr('Why this is the same person') }}
          <textarea v-model="form.reason" required rows="2" />
        </label>
      </details>
      <div class="form-grid">
        <label>
          {{ tr('Observed on') }}
          <input v-model="form.observedOn" type="date" required />
        </label>
        <label>
          {{ tr('Access') }}
          <select v-model="form.visibility" :disabled="loaded">
            <option value="team">{{ tr('Internal team') }}</option>
            <option v-if="isAdmin" value="admin">{{ tr('Administrators only') }}</option>
          </select>
        </label>
      </div>
      <h3>{{ tr('Career history') }}</h3>
      <p class="hint">
        {{
          tr(
            'Keep year-only and month-only dates. Leave missing dates blank. A role ending does not always mean leaving the organization.',
          )
        }}
      </p>
      <fieldset v-for="(p, i) in form.positions" :key="p.key" class="person-position">
        <legend>{{ tr('Career entry {0}', [i + 1]) }}</legend>
        <div class="form-grid">
          <label>
            {{ tr('Organization in directory') }}
            <select v-model="p.organizationId" @change="mapOrganization(i)">
              <option value="">{{ tr('Keep the source name only') }}</option>
              <option v-for="o in organizations" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </label>
          <label>
            {{ tr('Organization name in source') }}
            <input v-model="p.organizationName" required />
          </label>
          <label>
            {{ tr('Role') }}
            <input v-model="p.role" required />
          </label>
          <label>
            {{ tr('Employment status') }}
            <select v-model="p.tenure">
              <option value="unknown">{{ tr('Not stated') }}</option>
              <option value="current">{{ tr('Current role') }}</option>
              <option value="former">{{ tr('Former role') }}</option>
            </select>
          </label>
          <label>
            {{ tr('Start date') }}
            <input v-model="p.start" placeholder="YYYY / YYYY-MM / YYYY-MM-DD" />
          </label>
          <label>
            {{ tr('End date') }}
            <input
              v-model="p.end"
              :disabled="p.tenure === 'current'"
              placeholder="YYYY / YYYY-MM / YYYY-MM-DD"
            />
          </label>
        </div>
        <details class="talent-section" open>
          <summary>{{ tr('Personnel movement events') }}</summary>
          <div class="form-grid">
            <label>
              {{ tr('Start of this role') }}
              <select v-model="p.changeType">
                <option value="unknown">{{ tr('Career entry only') }}</option>
                <option value="joined">{{ tr('Joined the organization') }}</option>
                <option value="role_change">
                  {{ tr('Changed role within the organization') }}
                </option>
              </select>
            </label>
            <label>
              {{ tr('Confirmed previous position') }}
              <select v-model="p.previousPositionKey">
                <option :value="undefined">{{ tr('No explicit link') }}</option>
                <option
                  v-for="prior in form.positions.filter((entry) => entry.key !== p.key)"
                  :key="prior.key"
                  :value="prior.key"
                >
                  {{ prior.organizationName }} · {{ prior.role }} ·
                  {{ prior.end || tr('Not recorded') }}
                </option>
              </select>
            </label>
          </div>
          <p class="hint">
            {{
              tr(
                'Link only when the evidence connects these positions. Departure and arrival dates may differ.',
              )
            }}
          </p>
          <label class="choice">
            <input v-model="p.endedEmployment" type="checkbox" :disabled="p.tenure !== 'former'" />
            {{ tr('The source confirms departure from this organization') }}
          </label>
          <p class="hint" role="status">
            {{
              p.changeType === 'unknown' && !p.endedEmployment
                ? tr('Career only: this entry will not appear in organization movement tabs.')
                : tr('Movement events will also appear in the corresponding organization tabs.')
            }}
          </p>
        </details>
        <label>
          {{ tr('Source notes') }}
          <textarea v-model="p.note" rows="2" />
        </label>
        <button
          v-if="!loaded && form.positions.length > 1"
          type="button"
          class="link"
          @click="form.positions.splice(i, 1)"
        >
          {{ tr('Remove entry') }}
        </button>
      </fieldset>
      <button type="button" class="ghost" @click="add">+ {{ tr('Add career entry') }}</button>
      <label>
        {{ tr('Source notes') }}
        <textarea v-model="form.note" rows="2" />
      </label>
      <label>
        {{ tr('Original profile text') }}
        <textarea
          v-model="form.rawText"
          required
          rows="7"
          :placeholder="tr('Paste the original text visible on the source page.')"
        />
      </label>
      <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="emit('close')">
          {{ tr('Cancel') }}
        </button>
        <button type="submit" :disabled="busy || !form.positions.length">
          {{ tr(busy ? 'Saving…' : 'Save profile') }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
