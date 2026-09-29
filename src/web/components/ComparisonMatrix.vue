<script setup lang="ts">
// 字段对比矩阵(frontend-spec 4.6),从 v1 ComparisonMatrix.vue 迁移。
import { computed, ref, watch } from 'vue';
import type { ModuleData, Organization } from '../../shared/types';
import { knowledgeFields } from '../../shared/knowledge';
import { fieldValueLabel } from '../presentation';
import { openEvidence } from '../evidence';
import { tr } from '../i18n';
type Side = 'left' | 'right';
const props = defineProps<{
  left: { organization: Organization; module: ModuleData };
  right: { organization: Organization; module: ModuleData };
  tabId: string;
}>();
const emit = defineEmits<{ replace: [side: Side] }>();
const sides = ['left', 'right'] as const;
const chosen = ref<Record<Side, string>>({ left: '', right: '' });
const differencesOnly = ref(false);
// 默认每侧第一条记录;所选记录不在新数据里时回到第一条。
watch(
  () => [props.left, props.right, props.tabId],
  () => {
    for (const side of sides)
      if (!props[side].module.records?.some((r) => r.id === chosen.value[side]))
        chosen.value[side] = props[side].module.records?.[0]?.id ?? '';
  },
  { immediate: true },
);
const selected = (side: Side) =>
  props[side].module.records?.find((r) => r.id === chosen.value[side]);
const omitted = [
  'sourceRef',
  'verification',
  'sensitivity',
  'sourceKind',
  'owner',
  'evidenceLevel',
];
const fields = computed(() =>
  (knowledgeFields[props.tabId] ?? []).filter((f) => !omitted.includes(f.id)),
);
/** 相同:两侧都有值、不是 unknown、且完全相等。 */
function same(id: string) {
  const a = selected('left')?.structured[id];
  const b = selected('right')?.structured[id];
  return !!a && a !== 'unknown' && a === b;
}
const visible = computed(() => fields.value.filter((f) => !differencesOnly.value || !same(f.id)));
function unavailable(side: Side) {
  const status = props[side].module.status;
  return status === 'not_applicable'
    ? tr('Module not available for this type')
    : status === 'restricted'
      ? tr('Restricted records')
      : !selected(side)
        ? tr('No record for this scope')
        : '';
}
</script>
<template>
  <section class="comparison-matrix" :aria-label="tr('Compare the same fields')">
    <div class="matrix-toolbar">
      <h3>{{ tr('Compare the same fields') }}</h3>
      <label class="choice">
        <input v-model="differencesOnly" type="checkbox" />
        {{ tr('Differences & unknowns only') }}
      </label>
    </div>
    <p class="hint">
      {{
        tr(
          'Select one record on each side with comparable account, product and region. Matching text alone does not establish equivalent conditions.',
        )
      }}
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Field') }}</th>
            <th v-for="side in sides" :key="side">
              <strong>{{ props[side].organization.name }}</strong>
              <button type="button" class="link" @click="emit('replace', side)">
                {{ tr('Replace') }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{{ tr('Compared scope') }}</th>
            <td v-for="side in sides" :key="side">
              <p v-if="unavailable(side)" class="hint">{{ unavailable(side) }}</p>
              <template v-else>
                <select
                  v-model="chosen[side]"
                  :aria-label="tr('Select record for {0}', [props[side].organization.name])"
                >
                  <option
                    v-for="record in props[side].module.records"
                    :key="record.id"
                    :value="record.id"
                  >
                    {{ record.title }}
                  </option>
                </select>
                <p class="hint">{{ selected(side)!.scope }}</p>
              </template>
            </td>
          </tr>
          <tr v-for="field in visible" :key="field.id" :class="{ difference: !same(field.id) }">
            <th>{{ tr(field.label) }}</th>
            <td v-for="side in sides" :key="side">
              <span v-if="unavailable(side)" class="hint">{{ unavailable(side) }}</span>
              <template v-else>
                {{ fieldValueLabel(field, selected(side)?.structured[field.id]) }}
              </template>
            </td>
          </tr>
          <tr>
            <th>{{ tr('Evidence') }}</th>
            <td v-for="side in sides" :key="side">
              <button
                v-if="selected(side)"
                type="button"
                class="link"
                @click="openEvidence(selected(side)!.evidenceId)"
              >
                {{ tr('Original reference') }}
              </button>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!visible.length" class="hint" role="status">
      {{ tr('No differences in the selected recorded fields.') }}
    </p>
  </section>
</template>
