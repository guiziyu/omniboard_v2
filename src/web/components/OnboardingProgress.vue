<script setup lang="ts">
// 资源进度卡片(frontend-spec 10.9),每条 Onboarding 记录一张,从 v1 OnboardingProgress.vue 迁移。
// 商务与技术两条轨道互相独立:代码进度不代表已获授权。
import { computed } from 'vue';
import { atLeast, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import type { ModuleRecord, Organization } from '../../shared/types';
import {
  businessProgress,
  businessSteps,
  technicalProgress,
  technicalSteps,
  trackOwner,
  workScope,
} from '../../shared/work-progress';
import { knowledgeFields } from '../../shared/knowledge';
import { useOrganizationWork } from '../organization-work';
import {
  evidencePresentation,
  fieldOptionLabel,
  fieldValueLabel,
  readableBlocker,
  readableNote,
  readableTitle,
  reviewPresentation,
} from '../presentation';
import ProgressTrack from './ProgressTrack.vue';
import Icon from './Icon.vue';
const props = defineProps<{ organization: Organization; records: ModuleRecord[] }>();
const emit = defineEmits<{
  evidence: [id: string];
  edit: [record: ModuleRecord];
  history: [id: string];
}>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const { work, error, loading, load } = useOrganizationWork(
  () => props.organization.id,
  () => props.records.map((r) => r.id + ':' + r.revision).join(','),
);
const asOf = computed(() => work.value?.asOf || new Date().toISOString());
function blockers(record: ModuleRecord) {
  return [
    ...new Set(
      work.value?.requests.filter((j) => j.recordId === record.id).flatMap((j) => j.blockers) || [],
    ),
  ];
}
const summarized = [
  'integrationStage',
  'resourceStage',
  'resourceType',
  'product',
  'businessOwner',
  'technicalOwner',
  'owner',
  'nextStep',
  'verification',
  'reviewedOn',
  'expiresOn',
  'blockers',
  'accountRef',
  'evidenceLevel',
];
const details = (record: ModuleRecord) =>
  (knowledgeFields.onboarding || []).filter(
    (field) => record.structured[field.id] && !summarized.includes(field.id),
  );
const evidence = (record: ModuleRecord) =>
  evidencePresentation(record.structured.evidenceLevel || 'REPORTED');
</script>
<template>
  <section class="onboarding-progress" :aria-label="tr('Business and engineering progress')">
    <p class="hint progress-explanation">
      <Icon name="info" :size="15" />
      {{
        tr(
          'Each card covers one recorded resource and scope. Only the recorded stage is highlighted; earlier stages are not assumed complete.',
        )
      }}
    </p>
    <p v-if="error" class="error" role="alert">
      {{ tr('Engineering requests could not be loaded: {0}', [tr(error)]) }}
      <button type="button" class="link" @click="load">{{ tr('Try again') }}</button>
    </p>
    <details
      v-for="record in records"
      :id="'record-' + record.id"
      :key="record.id"
      :open="records.length === 1"
      class="onboarding-card"
    >
      <summary class="onboarding-card-heading">
        <div>
          <span class="resource-label">
            {{ fieldOptionLabel('resourceType', record.structured.resourceType || 'unknown') }}
          </span>
          <h4>{{ tr(workScope(record)) }}</h4>
          <p class="hint">
            {{
              record.structured.accountRef
                ? tr('Account · {0}', [record.structured.accountRef])
                : tr('Account not recorded')
            }}
          </p>
          <p class="collapsed-progress">
            {{ tr(businessProgress(record, asOf).label) }} ·
            {{ tr(technicalProgress(record).label) }}
          </p>
        </div>
        <button
          v-if="canEdit"
          type="button"
          class="ghost"
          :aria-label="tr('Update progress for {0}', [record.title])"
          @click.stop.prevent="emit('edit', record)"
        >
          <Icon name="edit" :size="14" />
          {{ tr('Update progress') }}
        </button>
      </summary>
      <div class="dual-progress">
        <ProgressTrack
          :title="tr('Business access')"
          icon="users"
          :state="businessProgress(record, asOf)"
          :steps="businessSteps"
          :owner="trackOwner(record, 'business')"
        />
        <ProgressTrack
          :title="tr('Technical connection')"
          icon="link"
          :state="technicalProgress(record)"
          :steps="technicalSteps"
          :owner="trackOwner(record, 'technical')"
        />
      </div>
      <p v-if="businessProgress(record, asOf).value === 'expiry_review'" class="expiry-notice">
        <Icon name="clock" :size="14" />
        {{ tr(businessProgress(record, asOf).hint) }}
      </p>
      <div class="onboarding-next">
        <strong>
          <Icon name="arrow" :size="16" />
          {{ record.structured.nextStep ? tr('Next step') : tr('Checks & follow-up') }}
        </strong>
        <p class="preserve-lines">
          {{
            record.structured.nextStep ||
            readableNote(record.structured.verification || '') ||
            tr('No next step recorded. Update this record to assign one.')
          }}
        </p>
        <small>
          {{ tr('Record owner · {0}', [record.structured.owner || tr('Not assigned')]) }}
        </small>
      </div>
      <details
        v-if="blockers(record).length || record.structured.blockers"
        class="progress-attention"
      >
        <summary>
          <Icon name="info" :size="14" />
          {{
            blockers(record).length
              ? tr('{0} checks before engineering can proceed', [blockers(record).length])
              : tr('Outstanding items recorded by the team')
          }}
        </summary>
        <ul v-if="blockers(record).length">
          <li v-for="blocker in blockers(record)" :key="blocker">{{ readableBlocker(blocker) }}</li>
        </ul>
        <p v-if="record.structured.blockers" class="preserve-lines">
          {{ readableNote(record.structured.blockers) }}
        </p>
      </details>
      <p v-if="loading" class="hint" role="status">{{ tr('Checking engineering requests…') }}</p>
      <footer class="progress-footer">
        <span class="tag" :title="evidence(record).hint">
          <Icon :name="evidence(record).icon" :size="12" />
          {{ evidence(record).label }}
        </span>
        <small>{{ tr('Updated {0}', [dateTime(record.updatedAt)]) }}</small>
        <button
          type="button"
          class="link push-left"
          :aria-label="tr('View source for {0}', [record.title])"
          @click="emit('evidence', record.evidenceId)"
        >
          {{ tr('View source') }}
        </button>
      </footer>
      <details class="onboarding-record-details">
        <summary>{{ tr('Record details & history') }}</summary>
        <h5>{{ readableTitle(record.title) }}</h5>
        <p class="hint">
          {{ reviewPresentation(record.status).label }} · {{ record.scope }} · v{{
            record.revision
          }}
        </p>
        <dl>
          <div v-for="field in details(record)" :key="field.id">
            <dt>{{ tr(field.label) }}</dt>
            <dd>{{ fieldValueLabel(field, record.structured[field.id]) }}</dd>
          </div>
          <div v-if="record.structured.reviewedOn">
            <dt>{{ tr('Reviewed on') }}</dt>
            <dd>{{ record.structured.reviewedOn }}</dd>
          </div>
          <div v-if="record.structured.expiresOn">
            <dt>{{ tr('Review / access expiry') }}</dt>
            <dd>{{ record.structured.expiresOn }}</dd>
          </div>
        </dl>
        <p
          v-if="record.structured.nextStep && record.structured.verification"
          class="preserve-lines"
        >
          {{ readableNote(record.structured.verification) }}
        </p>
        <p class="preserve-lines">{{ record.body }}</p>
        <div class="work-actions">
          <button type="button" class="link" @click="emit('history', record.id)">
            {{ tr('Record history') }}
          </button>
          <button
            v-if="record.attachmentEvidenceId"
            type="button"
            class="link"
            @click="emit('evidence', record.attachmentEvidenceId)"
          >
            {{ tr('Attachment') }}
          </button>
        </div>
      </details>
    </details>
  </section>
</template>
