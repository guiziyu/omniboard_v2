<script setup lang="ts">
// 职业经历、履历来源与疑似重复档案(frontend-spec 6.12、6.15),从 v1 PersonCareer.vue 迁移。
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { TalentDetail } from '../../shared/talent';
import { api, atLeast, errorText, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
const props = defineProps<{ person: TalentDetail }>();
const emit = defineEmits<{ update: [profileId: string]; changed: []; openPerson: [id: string] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const error = ref('');
const busy = ref(false);
const reason = ref('');
const dates = (value: string) =>
  !value
    ? tr('Date not published')
    : value.length === 4
      ? tr('{0} · Year only', [value])
      : value.length === 7
        ? tr('{0} · Month only', [value])
        : value;
const provider = (name: string) => (name === 'linkedin' ? 'LinkedIn' : name);
async function decide(otherId: string, decision: 'merge' | 'different' | 'later') {
  busy.value = true;
  error.value = '';
  try {
    if (decision === 'merge') {
      const other = props.person.duplicates.find((p) => p.id === otherId)!;
      await api(`/api/knowledge/identities/${encodeURIComponent(props.person.identityId)}/merge`, {
        method: 'POST',
        body: {
          otherId,
          revision: props.person.revision,
          otherRevision: other.revision,
          reason: reason.value,
        },
      });
    } else
      await api(
        `/api/talent/people/${encodeURIComponent(props.person.identityId)}/duplicate-decision`,
        {
          method: 'POST',
          body: {
            otherId,
            decision,
            reason:
              reason.value.trim() ||
              (decision === 'different'
                ? 'Reviewed and confirmed these are different people.'
                : 'Deferred for more source evidence.'),
          },
        },
      );
    reason.value = '';
    emit('changed');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section v-if="person.careers.length" class="person-career">
    <h4>{{ tr('Career history') }}</h4>
    <p class="hint">
      {{
        tr(
          'Career entries retain each source’s dates and wording. Concurrent roles remain separate.',
        )
      }}
    </p>
    <ol class="career-timeline">
      <li
        v-for="p in person.careers"
        :key="p.id"
        :class="{ 'career-current': p.tenure === 'current' }"
      >
        <div class="hint">
          {{ dates(p.start) }} → {{ p.tenure === 'current' ? tr('Present') : dates(p.end) }}
        </div>
        <strong>{{ p.role }}</strong>
        <div>
          <RouterLink
            v-if="p.organizationId"
            :to="`/w/internal/organizations/${p.organizationId}/overview`"
          >
            {{ p.organizationName }}
          </RouterLink>
          <span v-else>{{ p.organizationName }}</span>
          <span class="career-tenure">
            {{
              tr(
                p.tenure === 'current'
                  ? 'Current role'
                  : p.tenure === 'former'
                    ? 'Former role'
                    : 'Employment dates incomplete',
              )
            }}
          </span>
        </div>
        <details v-if="p.note">
          <summary>{{ tr('Source notes') }}</summary>
          <p class="preserve-lines">{{ p.note }}</p>
        </details>
        <button type="button" class="link" @click="openEvidence(p.evidenceId)">
          {{ provider(p.provider) }} · {{ tr('View evidence') }}
        </button>
      </li>
    </ol>
  </section>
  <details v-if="person.sources.length" class="talent-section">
    <summary>
      {{ tr('Profile sources') }}
      <span class="count">{{ person.sources.length }}</span>
    </summary>
    <article v-for="source in person.sources" :key="source.id" class="person-source-card">
      <a :href="source.url" target="_blank" rel="noopener noreferrer">
        {{ provider(source.provider) }} ↗
      </a>
      <p class="hint">{{ source.url }}</p>
      <p v-if="source.note" class="preserve-lines">{{ source.note }}</p>
      <button v-if="canEdit" type="button" class="link" @click="emit('update', source.id)">
        {{ tr('Update source profile') }}
      </button>
      <details>
        <summary>{{ tr('Capture history') }} · {{ source.captures.length }}</summary>
        <div v-for="capture in source.captures" :key="capture.id" class="person-capture">
          <span>
            {{ capture.observedOn }} · {{ capture.author }}
            <small class="hint">{{ tr('Recorded') }} {{ dateTime(capture.createdAt) }}</small>
          </span>
          <button type="button" class="link" @click="openEvidence(capture.evidenceId)">
            {{ tr('View evidence') }}
          </button>
          <p v-if="capture.note">{{ capture.note }}</p>
        </div>
      </details>
    </article>
  </details>
  <details v-if="person.duplicates.length" class="talent-section">
    <summary>{{ tr('Possible duplicate dossiers') }} · {{ person.duplicates.length }}</summary>
    <p class="hint">
      {{ tr('These dossiers share a name. Compare their roles and sources before deciding.') }}
    </p>
    <article v-for="other in person.duplicates" :key="other.id" class="person-source-card">
      <strong>{{ other.name }}</strong>
      <p>{{ other.organizations.join(' · ') }}</p>
      <p>{{ other.roles.join(' · ') }}</p>
      <a
        v-for="url in other.sources"
        :key="url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ url }}
      </a>
      <button type="button" class="link" @click="emit('openPerson', other.id)">
        {{ tr('Open dossier') }}
      </button>
      <span v-if="other.deferred" class="hint">{{ tr('Review later') }}</span>
      <div v-if="canEdit" class="work-actions">
        <button type="button" class="ghost" :disabled="busy" @click="decide(other.id, 'different')">
          {{ tr('Different people') }}
        </button>
        <button type="button" class="ghost" :disabled="busy" @click="decide(other.id, 'later')">
          {{ tr('Review later') }}
        </button>
        <button
          type="button"
          class="ghost"
          :disabled="busy || !reason.trim()"
          @click="decide(other.id, 'merge')"
        >
          {{ tr('Merge into this dossier') }}
        </button>
      </div>
    </article>
    <label v-if="canEdit">
      {{ tr('Why this is the same person') }}
      <textarea v-model="reason" rows="2" />
    </label>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
  </details>
</template>
