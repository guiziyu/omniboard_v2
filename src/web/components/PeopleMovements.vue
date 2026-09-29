<script setup lang="ts">
// 人员变动列表(frontend-spec 6.5–6.7),从 v1 PeopleMovements.vue 迁移。
// 「探索此人身份」随关系(§7)迁移;由个人履历生成的变动(structured.personProfileId)随人才库(6.14)迁移,
// 这里只保留「不可直接编辑」的规则。
import { computed, ref } from 'vue';
import { atLeast, session } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import { reviewPresentation } from '../presentation';
import {
  groupMovementRecords,
  movementDateLabelKey,
  movementPerspective,
  movementTransition,
  movementType,
  movementTypes,
  sameMovementOrganization,
  type MovementType,
} from '../../shared/people-movements';
import { compareMovementDates } from '../../shared/movement-date';
import type { ModuleRecord, Organization } from '../../shared/types';
import Icon from './Icon.vue';
const props = defineProps<{ records: ModuleRecord[]; organization: Organization }>();
const emit = defineEmits<{ edit: [record: ModuleRecord]; history: [id: string] }>();
const canEdit = computed(() => !!session.user && atLeast(session.user.role, 'editor'));
const type = ref<'' | MovementType>('');
const search = ref('');
const perspective = (record: ModuleRecord) => movementPerspective(record, props.organization.name);
const transition = (record: ModuleRecord) => movementTransition(record, props.organization.name);
const groups = computed(() => groupMovementRecords(props.records));
const sourcesFor = (record: ModuleRecord) =>
  groups.value.find((g) => g.record.id === record.id)?.sources || [record];
const movements = computed(() => groups.value.map((g) => g.record));
const visible = computed(() =>
  movements.value
    .filter(
      (r) =>
        (!type.value || perspective(r) === type.value) &&
        sourcesFor(r)
          .flatMap((s) => [
            s.personName,
            s.title,
            s.structured.fromRole,
            s.structured.toRole,
            transition(s).fromOrganization,
            transition(s).toOrganization,
          ])
          .join(' ')
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .toSorted(compareMovementDates),
);
const count = (key: string) => movements.value.filter((r) => perspective(r) === key).length;
const filterTypes = computed(() =>
  (Object.entries(movementTypes) as [MovementType, (typeof movementTypes)[MovementType]][]).filter(
    ([key]) => key !== 'related' || count(key),
  ),
);
const date = (value: string) =>
  !value
    ? tr('Date not published')
    : value.length === 4
      ? tr('{0} · Year only', [value])
      : value.length === 7
        ? tr('{0} · Month only', [value])
        : value;
const here = (name: string) => sameMovementOrganization(name, props.organization.name);
</script>
<template>
  <section class="movements" :aria-label="tr('People Movements')">
    <p class="hint">{{ tr('Movements relative to {0}', [organization.name]) }}</p>
    <div class="segmented movement-filters" role="group" :aria-label="tr('Movement type')">
      <button type="button" :aria-pressed="type === ''" @click="type = ''">
        {{ tr('All movements') }} <small>{{ movements.length }}</small>
      </button>
      <button
        v-for="[key, meta] in filterTypes"
        :key="key"
        type="button"
        :class="'movement-' + key"
        :aria-pressed="type === key"
        @click="type = key"
      >
        <Icon :name="meta.icon" :size="15" /> {{ tr(meta.label) }} <small>{{ count(key) }}</small>
      </button>
    </div>
    <label class="chart-search movement-search">
      <Icon name="search" :size="16" />
      <input
        v-model="search"
        :aria-label="tr('Search people, organizations or roles')"
        :placeholder="tr('Search people, organizations or roles')"
      />
    </label>
    <details
      v-for="record in visible"
      :id="'record-' + record.id"
      :key="record.id"
      class="movement-card"
      :class="'movement-card-' + perspective(record)"
    >
      <summary class="movement-summary">
        <span
          class="movement-type"
          :class="'movement-' + perspective(record)"
          :title="tr(movementType(perspective(record)).description)"
        >
          <Icon :name="movementType(perspective(record)).icon" :size="17" />
          {{ tr(movementType(perspective(record)).label) }}
        </span>
        <span class="movement-person">
          <strong>{{ record.personName }}</strong>
          <small v-if="sourcesFor(record).length > 1">
            {{ tr('{0} sources · one movement', [sourcesFor(record).length]) }}
          </small>
          <span
            v-if="
              perspective(record) === 'role_change' &&
              (transition(record).fromRole || transition(record).toRole)
            "
            class="movement-route"
          >
            <span>{{ transition(record).fromRole || tr('Role not recorded') }}</span>
            <Icon name="arrow" :size="14" />
            <span>{{ transition(record).toRole || tr('Role not recorded') }}</span>
          </span>
          <span v-else-if="perspective(record) === 'role_change'">{{ record.title }}</span>
          <span v-else class="movement-route">
            <span :class="{ current: here(transition(record).fromOrganization) }">
              {{ transition(record).fromOrganization || tr('Previous organization not recorded') }}
            </span>
            <Icon name="arrow" :size="14" />
            <span :class="{ current: here(transition(record).toOrganization) }">
              {{ transition(record).toOrganization || tr('Next organization not recorded') }}
            </span>
          </span>
        </span>
        <span class="movement-date">
          <Icon name="clock" :size="13" />
          <span>
            <small v-if="record.eventDate">{{ tr(movementDateLabelKey(record.structured)) }}</small>
            {{ date(record.eventDate) }}
          </span>
        </span>
        <Icon name="chevron" :size="16" />
      </summary>
      <div class="movement-detail">
        <p class="movement-source-title">
          <small>{{ tr('Source headline') }}</small>
          <strong>{{ record.title }}</strong>
        </p>
        <div class="movement-transition">
          <div>
            <small>{{ tr('Before') }}</small>
            <strong>
              {{ transition(record).fromOrganization || tr('Previous organization not recorded') }}
            </strong>
            <span>{{ transition(record).fromRole || tr('Role not recorded') }}</span>
          </div>
          <Icon name="arrow" :size="22" />
          <div>
            <small>{{ tr('After') }}</small>
            <strong>
              {{ transition(record).toOrganization || tr('Next organization not recorded') }}
            </strong>
            <span>{{ transition(record).toRole || tr('Role not recorded') }}</span>
          </div>
        </div>
        <p class="hint">
          {{
            tr(
              'Missing roles or organizations are left unknown. A departure does not imply a destination.',
            )
          }}
        </p>
        <p v-if="record.structured.transitionBasis === 'adjacent_profile_roles'" class="hint">
          {{
            tr(
              'Linked from adjacent roles in the same profile. Matching months or years do not establish an exact transition day or exclude an employment gap.',
            )
          }}
        </p>
        <p v-if="record.structured.transitionBasis === 'explicit_profile_transition'" class="hint">
          {{
            tr(
              'These positions were explicitly linked using the source evidence; their dates are preserved separately.',
            )
          }}
        </p>
        <p v-if="record.structured.previousRoleEnd || record.structured.nextRoleStart" class="hint">
          {{ tr('Previous role ended') }}:
          {{ record.structured.previousRoleEnd || tr('Not recorded') }} ·
          {{ tr('Next role started') }}: {{ record.structured.nextRoleStart || tr('Not recorded') }}
        </p>
        <p v-if="record.structured.dateLabel" class="hint">
          {{ tr('Source timing: {0}', [record.structured.dateLabel]) }}
        </p>
        <p v-if="record.structured.dateBasis === 'announcement'" class="hint">
          {{ tr('This is the announcement date, not an established joining or departure date.') }}
        </p>
        <p class="record-body">{{ record.body }}</p>
        <details v-if="sourcesFor(record).length > 1" class="movement-sources">
          <summary>{{ tr('Other sources for this movement') }}</summary>
          <section
            v-for="source in sourcesFor(record).filter((r) => r.id !== record.id)"
            :id="'record-' + source.id"
            :key="source.id"
          >
            <strong>{{ source.title }}</strong>
            <p class="hint">
              {{ tr(movementDateLabelKey(source.structured)) }} · {{ date(source.eventDate) }}
            </p>
            <p class="record-body">{{ source.body }}</p>
            <button type="button" class="link" @click="openEvidence(source.evidenceId)">
              {{ tr('Original source') }}
            </button>
            <button type="button" class="link" @click="emit('history', source.id)">
              {{ tr('History') }}
            </button>
          </section>
        </details>
        <p>
          <span class="tag">{{ reviewPresentation(record.status).label }}</span>
          <span class="hint"> {{ record.scope }}</span>
        </p>
        <footer class="record-footer">
          <span>{{ record.author }} · {{ dateTime(record.updatedAt) }}</span>
          <span>
            <button type="button" class="link" @click="openEvidence(record.evidenceId)">
              {{ tr('Original source') }}
            </button>
            <button type="button" class="link" @click="emit('history', record.id)">
              {{ tr('History') }}
            </button>
            <button
              v-if="!record.structured.personProfileId && canEdit"
              type="button"
              class="link"
              @click="emit('edit', record)"
            >
              {{ tr('Edit movement') }}
            </button>
          </span>
        </footer>
      </div>
    </details>
    <p v-if="!visible.length" class="empty">{{ tr('No movements match these filters.') }}</p>
  </section>
</template>
