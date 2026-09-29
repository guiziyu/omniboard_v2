<script setup lang="ts">
// "Engineering requests" 面板(frontend-spec 11.2),从 v1 IntegrationPlans.vue 迁移。
// v1 的导出路径由 proposal §6 取代:quant 的 deliver skill 按 request_id 读 omniboard.v_connector_request。
import { computed, ref, watch } from 'vue';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import type { RequestLeafView, RequestView } from '../../shared/integration';
import { fieldOptionLabel, handoffPresentation, readableBlocker } from '../presentation';
import Icon from './Icon.vue';
const props = defineProps<{ organizationId: string; revisionKey: string }>();
const requests = ref<RequestView[]>([]);
const error = ref('');
const actionRequired = computed(
  () => requests.value.filter((r) => r.state === 'failed' || r.blockers.length).length,
);
watch(
  () => [props.organizationId, props.revisionKey],
  async () => {
    try {
      error.value = '';
      requests.value = (
        await api<{ requests: RequestView[] }>(
          `/api/organizations/${props.organizationId}/integrations`,
        )
      ).requests;
    } catch (e) {
      error.value = errorText(e);
    }
  },
  { immediate: true },
);
function leafStatus(leaf: RequestLeafView): string {
  if (leaf.status === 'awaiting_resource' || (leaf.status === 'skipped' && leaf.awaiting.length))
    return tr('Awaiting resource: {0} · {1}', [
      leaf.awaiting.map((a) => fieldOptionLabel('resourceType', a.resource)).join(', '),
      leaf.awaiting[0]?.owner || tr('owner not recorded'),
    ]);
  if (leaf.status === 'passed' && leaf.stale) return tr('Stale');
  return (
    {
      passed: tr('passed'),
      failed: tr('failed'),
      skipped: tr('skipped'),
      no_result: tr('No result yet'),
    }[leaf.status] || leaf.status
  );
}
</script>
<template>
  <details class="integration-plans">
    <summary>
      <strong>{{ tr('Engineering requests') }}</strong>
      <small>
        {{ requests.length }} {{ requests.length === 1 ? tr('request') : tr('requests') }}
      </small>
      <span v-if="actionRequired" class="tag attention">
        <Icon name="lock" :size="12" />
        {{ tr('{0} need action', [actionRequired]) }}
      </span>
    </summary>
    <p class="hint">
      {{
        tr(
          'Each request is saved for the quant skill, which reads it by its request ID. Its state comes from the live-test runs quant records for that ID; this app never runs a check itself.',
        )
      }}
    </p>
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="!requests.length" class="hint">
      {{
        tr('Edit an onboarding record and choose “Request engineering help” to create a request.')
      }}
    </p>
    <article v-for="request in requests" :key="request.id" class="integration-plan">
      <header>
        <strong>{{ request.venueKey }}</strong>
        <span class="tag" :title="handoffPresentation(request.state).hint">
          <Icon :name="handoffPresentation(request.state).icon" :size="13" />
          {{ handoffPresentation(request.state).label }}
        </span>
      </header>
      <p>
        {{
          tr('{0} · Record version {1}', [
            fieldOptionLabel('nextAction', request.action),
            request.recordRevision,
          ])
        }}
      </p>
      <p class="hint">
        {{ tr('Request ID') }}: <code>{{ request.id }}</code>
        <span v-if="request.declaredRevision">
          · {{ tr('Build') }}: <code>{{ request.declaredRevision.slice(0, 12) }}</code>
        </span>
      </p>
      <p v-if="request.reissueOf" class="hint">
        {{ tr('Reissued after a resource was granted; replaces {0}', [request.reissueOf]) }}
      </p>
      <template v-if="request.blockers.length">
        <strong>{{ tr('Before engineering can proceed') }}</strong>
        <ul>
          <li v-for="blocker in request.blockers" :key="blocker">
            {{ readableBlocker(blocker) }}
          </li>
        </ul>
      </template>
      <p v-else class="hint">
        {{
          tr(
            'Required information is present. Engineering can review it and run the connection checks; the connection has not been activated.',
          )
        }}
      </p>
      <template v-if="request.leaves.length">
        <strong>{{ tr('Requested leaves') }}</strong>
        <ul class="integration-leaves">
          <li v-for="leaf in request.leaves" :key="leaf.featureKey">
            <code>{{ leaf.featureKey }}</code>
            <span class="tag" :class="'leaf-' + leaf.status">{{ leafStatus(leaf) }}</span>
            <small v-if="leaf.observedAt">{{ dateTime(leaf.observedAt) }}</small>
          </li>
        </ul>
      </template>
      <template v-if="request.attempts.length">
        <strong>{{ tr('Verification runs') }}</strong>
        <ul>
          <li v-for="attempt in request.attempts" :key="attempt.runId">
            {{ attempt.suite }} · {{ attempt.environment }} ·
            {{ attempt.finishedAt ? tr(attempt.status) : tr('running') }} ·
            <code>{{ attempt.buildRevision.slice(0, 12) }}</code>
            <span v-if="attempt.buildDirty">({{ tr('dirty') }})</span>
            <span v-if="attempt.blockers.length">
              · {{ attempt.blockers.map((b) => b.next_step).join(' · ') }}
            </span>
          </li>
        </ul>
      </template>
      <details>
        <summary>{{ tr('Technical request details') }}</summary>
        <pre class="request-json">{{ JSON.stringify(request.request, null, 2) }}</pre>
      </details>
      <small>{{ dateTime(request.createdAt) }}</small>
    </article>
  </details>
</template>
