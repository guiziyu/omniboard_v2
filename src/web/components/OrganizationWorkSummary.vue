<script setup lang="ts">
// 我方工作摘要 "Our work with {name}"(frontend-spec 4.8),从 v1 OrganizationWorkSummary.vue 迁移。
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { tr } from '../i18n';
import type { ModuleData, Organization } from '../../shared/types';
import { isFinished, taskStates } from '../../shared/operations';
import {
  businessProgress,
  contactRolePreview,
  recordNeedsAttention,
  technicalProgress,
  workScope,
} from '../../shared/work-progress';
import { useOrganizationTab, useOrganizationWork } from '../organization-work';
import { fieldOptionLabel, readableBlocker, readableNote, readableTitle } from '../presentation';
import { openEvidence } from '../evidence';
import { taskOwner, taskText } from '../task-text';
import Icon from './Icon.vue';
const props = defineProps<{ organization: Organization }>();
const { work, loading, error, load } = useOrganizationWork(() => props.organization.id);
const tabRoute = useOrganizationTab(() => props.organization.id);
const onboarding = computed(() => work.value?.onboarding.records || []);
const openTasks = computed(() => (work.value?.tasks || []).filter((t) => !isFinished(t.state)));
const taskPreview = computed(() =>
  [...openTasks.value]
    .sort(
      (a, b) =>
        Number(b.displayState === 'ready') - Number(a.displayState === 'ready') ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 2),
);
const expanded = ref(false);
const contacts = computed(() => work.value?.contacts.records || []);
const contactPreview = computed(() =>
  [...contacts.value]
    .sort(
      (a, b) =>
        Number(b.structured.relationship === 'active') -
          Number(a.structured.relationship === 'active') ||
        Number(Boolean(b.personName)) - Number(Boolean(a.personName)),
    )
    .slice(0, 2),
);
const granted = computed(
  () =>
    onboarding.value.filter((r) => businessProgress(r, work.value!.asOf).value === 'granted')
      .length,
);
const verified = computed(
  () => onboarding.value.filter((r) => technicalProgress(r).value === 'production_verified').length,
);
const attention = computed(() =>
  onboarding.value.filter((r) => recordNeedsAttention(r, work.value!.requests, work.value!.asOf)),
);
const followUps = computed(() =>
  [...onboarding.value]
    .sort(
      (a, b) =>
        Number(attention.value.includes(b)) - Number(attention.value.includes(a)) ||
        Number(Boolean(b.structured.nextStep)) - Number(Boolean(a.structured.nextStep)),
    )
    .slice(0, 2),
);
function emptyLabel(module?: ModuleData) {
  return module?.status === 'restricted'
    ? tr('Restricted')
    : module?.status === 'not_applicable'
      ? tr('Not applicable')
      : tr('Not recorded');
}
const businessHeadline = computed(() =>
  onboarding.value.length === 1
    ? tr(businessProgress(onboarding.value[0]!, work.value!.asOf).label)
    : onboarding.value.length
      ? tr('{0} access approvals recorded', [granted.value])
      : emptyLabel(work.value?.onboarding),
);
const technicalHeadline = computed(() =>
  onboarding.value.length === 1
    ? tr(technicalProgress(onboarding.value[0]!).label)
    : onboarding.value.length
      ? tr('{0} live account checks recorded', [verified.value])
      : emptyLabel(work.value?.onboarding),
);
const onboardingLink = computed(() =>
  work.value?.onboarding.status === 'not_applicable' ? undefined : tabRoute('onboarding'),
);
const firstBlocker = (recordId: string) =>
  work.value?.requests.find((j) => j.recordId === recordId)?.blockers[0];
const taskLink = (taskId: string) => ({
  path: '/w/internal/work',
  query: { organizationId: props.organization.id, task: taskId },
});
</script>
<template>
  <section class="work-summary" :aria-label="tr('Team work summary')">
    <header class="work-heading">
      <h4>{{ tr('Our work with {0}', [organization.name]) }}</h4>
      <RouterLink v-if="onboardingLink" :to="onboardingLink">
        {{ tr('Open onboarding') }}
      </RouterLink>
    </header>
    <p v-if="loading && !work" class="hint" role="status">{{ tr('Loading team progress…') }}</p>
    <div v-else-if="error" role="alert">
      <p class="error">{{ tr('Team progress could not be loaded: {0}', [tr(error)]) }}</p>
      <button type="button" class="link" @click="load">{{ tr('Try again') }}</button>
    </div>
    <template v-else-if="work">
      <p v-if="expanded" class="hint">
        {{
          tr(
            'From records visible to you. Provider offerings, account approval and connection tests are tracked separately.',
          )
        }}
      </p>
      <div class="work-signals">
        <component
          :is="onboardingLink ? RouterLink : 'div'"
          :to="onboardingLink"
          class="work-signal"
        >
          <span><Icon name="users" :size="16" /> {{ tr('Business access') }}</span>
          <strong>{{ businessHeadline }}</strong>
          <small>
            {{
              attention.length
                ? tr('{0} onboarding {1} attention', [
                    attention.length,
                    attention.length === 1 ? tr('record needs') : tr('records need'),
                  ])
                : tr('Approvals for our products and accounts')
            }}
          </small>
        </component>
        <component
          :is="onboardingLink ? RouterLink : 'div'"
          :to="onboardingLink"
          class="work-signal"
        >
          <span><Icon name="link" :size="16" /> {{ tr('Technical connection') }}</span>
          <strong>{{ technicalHeadline }}</strong>
          <small>
            {{
              onboarding.length
                ? tr('{0} connection {1} · scoped checks only', [
                    onboarding.length,
                    onboarding.length === 1 ? tr('record') : tr('records'),
                  ])
                : tr('Progress is recorded per connection')
            }}
          </small>
        </component>
        <RouterLink :to="tabRoute('contacts')" class="work-signal">
          <span><Icon name="users" :size="16" /> {{ tr('Contacts') }}</span>
          <strong>
            {{
              contacts.length
                ? tr('{0} contact {1}', [
                    contacts.length,
                    contacts.length === 1 ? tr('record') : tr('records'),
                  ])
                : emptyLabel(work.contacts)
            }}
          </strong>
          <small>
            {{
              contacts.some((r) => r.structured.relationship === 'active')
                ? tr('Active relationships recorded')
                : contacts.length
                  ? tr('Public details do not imply a relationship')
                  : tr('People and business channels')
            }}
          </small>
        </RouterLink>
      </div>
      <div v-if="taskPreview.length" class="summary-next-actions">
        <strong>{{ tr('Next steps') }}</strong>
        <RouterLink v-for="task in taskPreview" :key="task.id" :to="taskLink(task.id)">
          {{ taskText(task) }}
        </RouterLink>
      </div>
      <button type="button" class="link" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ tr(expanded ? 'Hide team details' : 'Contacts, blockers & details') }}
      </button>
      <div v-if="expanded" class="work-detail-grid">
        <section v-if="work.onboarding.status !== 'not_applicable' || work.tasks.length">
          <h5>
            {{ tr('Next steps') }}
            <span v-if="attention.length" class="attention-count">
              {{
                tr('{0} {1} attention', [
                  attention.length,
                  attention.length === 1 ? tr('needs') : tr('need'),
                ])
              }}
            </span>
          </h5>
          <article v-for="task in taskPreview" :key="task.id" class="work-item">
            <RouterLink :to="taskLink(task.id)">{{ taskText(task) }}</RouterLink>
            <p class="hint">
              <span class="task-state" :class="'state-' + task.displayState">
                {{ tr(taskStates[task.displayState]) }}
              </span>
              · {{ taskOwner(task) }}
            </p>
          </article>
          <RouterLink
            v-if="openTasks.length"
            :to="{ path: '/w/internal/work', query: { organizationId: organization.id } }"
          >
            {{ tr('View all {0} open tasks', [openTasks.length]) }}
          </RouterLink>
          <p v-if="!followUps.length && !openTasks.length" class="hint">
            {{
              work.onboarding.status === 'restricted'
                ? tr('Onboarding records are restricted to administrators.')
                : tr('No open task or follow-up recorded. Open Onboarding to plan the next steps.')
            }}
          </p>
          <article v-for="record in followUps" :key="record.id" class="work-item">
            <RouterLink :to="tabRoute('onboarding', record.id)">
              {{ tr(workScope(record)) }}
            </RouterLink>
            <p class="hint">
              {{ fieldOptionLabel('resourceType', record.structured.resourceType || 'unknown') }} ·
              {{ tr(businessProgress(record, work.asOf).label) }}
            </p>
            <p>
              {{
                record.structured.nextStep ||
                readableNote(record.structured.verification || '') ||
                tr('Next step not recorded.')
              }}
            </p>
            <p v-if="firstBlocker(record.id)" class="work-blocker">
              {{ readableBlocker(firstBlocker(record.id)!) }}
            </p>
            <footer class="work-actions">
              <small>
                {{ tr('Record owner · {0}', [record.structured.owner || tr('Not assigned')]) }}
              </small>
              <button
                type="button"
                class="link"
                :aria-label="tr('View source for {0}', [record.title])"
                @click="openEvidence(record.evidenceId)"
              >
                {{ tr('Source') }}
              </button>
            </footer>
          </article>
          <RouterLink v-if="onboarding.length > 2" :to="tabRoute('onboarding')">
            {{ tr('View all {0} onboarding records', [onboarding.length]) }}
          </RouterLink>
        </section>
        <section>
          <h5>{{ tr('People & channels') }}</h5>
          <p v-if="!contacts.length" class="hint">
            {{
              work.contacts.status === 'restricted'
                ? tr('Contact records are restricted to administrators.')
                : tr('No contacts recorded yet.')
            }}
          </p>
          <article v-for="record in contactPreview" :key="record.id" class="work-item">
            <RouterLink :to="tabRoute('contacts', record.id)">
              {{ record.personName || readableTitle(record.title) }}
            </RouterLink>
            <p>{{ contactRolePreview(record.structured.role || '') || tr('Role not recorded') }}</p>
            <p class="hint">
              {{ fieldOptionLabel('channel', record.structured.channel || '') }} ·
              {{ fieldOptionLabel('relationship', record.structured.relationship || 'unknown') }}
            </p>
          </article>
          <RouterLink v-if="contacts.length > 2" :to="tabRoute('contacts')">
            {{ tr('View all contacts') }}
          </RouterLink>
          <template v-if="work.compliance.status !== 'not_applicable'">
            <h5>{{ tr('Access conditions') }}</h5>
            <p v-if="!work.compliance.records?.length" class="hint">
              {{
                work.compliance.status === 'restricted'
                  ? tr('Access conditions are restricted to administrators.')
                  : tr('No access rules recorded. Eligibility has not been established.')
              }}
            </p>
            <RouterLink
              v-for="record in work.compliance.records?.slice(0, 2)"
              :key="record.id"
              :to="tabRoute('compliance', record.id)"
              class="rule-link"
            >
              {{ readableTitle(record.title) }}
              <small>{{ record.structured.jurisdiction }} · {{ record.structured.product }}</small>
            </RouterLink>
            <RouterLink
              v-if="(work.compliance.records?.length || 0) > 2"
              :to="tabRoute('compliance')"
            >
              {{ tr('View all access conditions') }}
            </RouterLink>
          </template>
        </section>
      </div>
    </template>
  </section>
</template>
