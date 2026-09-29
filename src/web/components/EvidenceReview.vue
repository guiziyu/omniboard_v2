<script setup lang="ts">
// 证据对照(frontend-spec 7.12),从 v1 EvidenceReview.vue 迁移。「Create follow-up task」随工作台(§10)迁移。
import { computed } from 'vue';
import type { KnowledgeClaim, KnowledgeGraph } from '../../shared/operations';
import type { ExplorationGraph } from '../../shared/exploration';
import { claimGroups } from '../../shared/exploration-model';
import { atLeast, session } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import { openEvidence } from '../evidence';
import Icon from './Icon.vue';
const props = defineProps<{
  claims: KnowledgeClaim[];
  decisions: KnowledgeGraph['decisions'];
  references: ExplorationGraph['references'];
  historical: boolean;
  objectNames: Record<string, string>;
  today: string;
}>();
const emit = defineEmits<{ review: [claim: KnowledgeClaim] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const groups = computed(() =>
  claimGroups(props.claims.filter((c) => props.historical || c.status !== 'superseded')),
);
function validity(c: KnowledgeClaim) {
  const today = props.today;
  return c.validUntil && c.validUntil < today
    ? 'Expired'
    : c.validFrom && c.validFrom > today
      ? 'Not yet effective'
      : !c.validFrom && !c.validUntil
        ? 'Validity not recorded'
        : 'Within recorded dates';
}
const status = (c: KnowledgeClaim) =>
  c.status === 'superseded'
    ? 'Previous interpretation'
    : c.conflict
      ? 'Conflicting sources'
      : c.status === 'accepted'
        ? 'Adopted by team'
        : 'Awaiting review';
</script>
<template>
  <section class="evidence-review" :aria-label="tr('Compare evidence')">
    <p v-if="!groups.length" class="hint evidence-empty">
      {{ tr('No structured conclusions yet. Source records remain available below.') }}
    </p>
    <details
      v-for="group in groups"
      :key="group.key"
      class="evidence-question"
      :open="group.conflict"
    >
      <summary>
        <div>
          <strong>{{ tr(group.field) }}</strong>
          <small>
            {{ objectNames[group.objectId] }} ·
            {{ group.organizationName ? group.organizationName + ' · ' : '' }}{{ group.scope }}
          </small>
        </div>
        <span :class="{ 'evidence-conflict': group.conflict }">
          <Icon :name="group.conflict ? 'info' : 'file'" :size="14" />
          {{
            group.conflict
              ? tr('Conflicting sources')
              : tr('{0} source statements', [group.claims.length])
          }}
        </span>
      </summary>
      <p v-if="group.conflict" class="evidence-conflict-note">
        {{
          tr(
            'These sources disagree within the same scope. Compare their dates and originals before choosing a conclusion.',
          )
        }}
      </p>
      <div class="evidence-comparison">
        <article
          v-for="c in group.claims"
          :key="c.id"
          :class="{ adopted: c.status === 'accepted', historical: c.status === 'superseded' }"
        >
          <header>
            <span :class="c.conflict ? 'evidence-conflict' : 'hint'">{{ tr(status(c)) }}</span>
            <span>v{{ c.revision }}</span>
          </header>
          <p class="claim-value">{{ c.value }}</p>
          <dl>
            <div>
              <dt>{{ tr('Source') }}</dt>
              <dd>
                {{ sourceName(references[c.evidenceId]?.source || '') }}
                <a
                  v-if="references[c.evidenceId]?.url"
                  :href="references[c.evidenceId]!.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ references[c.evidenceId]!.url }}
                </a>
              </dd>
            </div>
            <div>
              <dt>{{ tr('Observed') }}</dt>
              <dd>{{ c.observedOn || tr('Not recorded') }}</dd>
            </div>
            <div>
              <dt>{{ tr('Validity') }}</dt>
              <dd :class="{ 'evidence-expired': !c.current && c.status !== 'superseded' }">
                {{ tr(validity(c)) }}
                <small>{{ c.validFrom || '—' }} → {{ c.validUntil || '—' }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ tr('Recorded') }}</dt>
              <dd>{{ dateTime(c.recordedAt) }}</dd>
            </div>
          </dl>
          <div class="work-actions">
            <button type="button" class="link" @click="openEvidence(c.evidenceId)">
              {{ tr('Read original reference') }}
            </button>
            <button
              v-if="c.current && canEdit && (c.status !== 'accepted' || c.conflict)"
              type="button"
              class="ghost"
              @click="emit('review', c)"
            >
              {{ tr('Review & adopt') }}
            </button>
          </div>
          <details v-if="decisions.some((d) => d.claimId === c.id)" class="decision-history">
            <summary>{{ tr('Decision trail') }}</summary>
            <p v-for="d in decisions.filter((d) => d.claimId === c.id)" :key="d.createdAt">
              <strong>{{ d.author }} · {{ dateTime(d.createdAt) }}</strong>
              {{ d.reason }}
            </p>
          </details>
        </article>
      </div>
    </details>
  </section>
</template>
<style scoped>
.evidence-comparison .work-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.evidence-empty {
  padding: 18px 0;
}
.evidence-question {
  border: 1px solid var(--line);
  border-radius: 7px;
  margin: 12px 0;
  overflow: hidden;
}
.evidence-question > summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px;
  cursor: pointer;
  background: var(--panel);
  list-style: none;
}
.evidence-question > summary small {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: var(--muted);
}
.evidence-question > summary > span {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.evidence-conflict {
  color: var(--danger);
  font-weight: 600;
}
.evidence-conflict-note {
  padding: 12px 16px;
  background: color-mix(in srgb, var(--danger) 7%, var(--bg));
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.evidence-comparison {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 12px;
  padding: 14px;
}
.evidence-comparison article {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 16px;
  min-width: 0;
}
.evidence-comparison article.adopted {
  border-top: 3px solid var(--joined);
}
.evidence-comparison article.historical {
  background: var(--panel);
}
.evidence-comparison header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}
.claim-value {
  font-size: 17px;
  font-weight: 600;
  overflow-wrap: anywhere;
  margin: 16px 0;
}
.evidence-comparison dl {
  font-size: 12px;
  margin: 0 0 18px;
}
.evidence-comparison dl > div {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px;
  margin: 10px 0;
}
.evidence-comparison dt {
  color: var(--muted);
}
.evidence-comparison dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.evidence-comparison dd a,
.evidence-comparison dd small {
  display: block;
  font-size: 11px;
  margin-top: 4px;
}
.evidence-expired {
  color: var(--amber);
}
.decision-history {
  margin-top: 16px;
  font-size: 12px;
}
.decision-history summary {
  cursor: pointer;
  color: var(--muted);
}
.decision-history p strong {
  display: block;
  font-size: 11px;
  margin-bottom: 6px;
}
.decision-history p {
  padding: 10px;
  background: var(--panel);
}
</style>
