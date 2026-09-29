<script setup lang="ts">
// 结构化字段表单(frontend-spec 5.6 第 4 项、5.7),从 v1 KnowledgeFields.vue 迁移。
import { tr } from '../i18n';
import { computed } from 'vue';
import { knowledgeFields } from '../../shared/knowledge';
import { fieldOptionLabel, fieldHint } from '../presentation';
import { constraintValueKeys, type ConstraintKind } from '../../shared/verification-contract';
const props = defineProps<{ tabId: string; model: Record<string, string> }>();
const constraintKeys = computed(() => {
  const kind = props.model.constraintKind as ConstraintKind | 'none' | undefined;
  return kind && kind !== 'none' ? constraintValueKeys[kind]?.join(', ') || '' : '';
});
const groups = computed(() => {
  const fields = knowledgeFields[props.tabId] || [];
  if (props.tabId !== 'onboarding') return [{ title: '', description: '', fields }];
  const definitions = [
    {
      title: 'Resource & business access',
      description:
        'Which resource and account are we working on, and who owns the provider relationship?',
      ids: [
        'resourceType',
        'product',
        'accountRef',
        'resourceStage',
        'businessOwner',
        'resourceRef',
      ],
    },
    {
      title: 'Technical connection',
      description:
        'Record the current tested scope. Updating this record does not run tests or activate a connection.',
      ids: [
        'integrationStage',
        'technicalOwner',
        'venueKey',
        'capabilities',
        'credentialRef',
        'nextAction',
      ],
    },
    {
      title: 'Next step & ownership',
      description: 'Keep the next action separate from the results of previous checks.',
      ids: ['nextStep', 'blockers', 'owner'],
    },
  ];
  const assigned = new Set(definitions.flatMap((group) => group.ids));
  return [
    ...definitions.map((group) => ({
      ...group,
      fields: group.ids.map((id) => fields.find((field) => field.id === id)!),
    })),
    {
      title: 'Evidence & review',
      description: 'Keep the source, verification notes and expiry date with this record.',
      fields: fields.filter((field) => !assigned.has(field.id)),
    },
  ];
});
</script>
<template>
  <section class="knowledge-form">
    <div class="form-section-heading">
      <h3>{{ tr('Record details') }}</h3>
      <p class="caption muted">
        {{
          tr(
            tabId === 'roadmap'
              ? 'Keep the goal, target window and progress separate from the evidence review. Update execution tasks in the work board.'
              : 'Record what is known, who supplied it and what needs to happen next. A provider offering a feature does not mean our account has access to it.',
          )
        }}
      </p>
    </div>
    <fieldset v-for="group in groups" :key="group.title" class="knowledge-field-group">
      <legend v-if="group.title">{{ tr(group.title) }}</legend>
      <p v-if="group.description" class="caption muted">{{ tr(group.description) }}</p>
      <div class="knowledge-field-grid">
        <label
          v-for="field in group.fields"
          :key="field.id"
          :class="{ wide: field.type === 'textarea' }"
        >
          {{ tr(field.label) }}
          <span v-if="field.required" class="required-mark">*</span>
          <select v-if="field.options" v-model="model[field.id]" :required="field.required">
            <option v-for="option in field.options" :key="option" :value="option">
              {{ fieldOptionLabel(field.id, option) }}
            </option>
          </select>
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="model[field.id]"
            :required="field.required"
            rows="2"
            maxlength="4000"
          />
          <input
            v-else
            v-model="model[field.id]"
            :type="field.type === 'date' ? 'date' : 'text'"
            :inputmode="field.type === 'number' ? 'decimal' : undefined"
            :required="field.required"
            maxlength="500"
            :placeholder="tr(field.hint)"
          />
          <small v-if="field.hint" class="muted">{{ tr(field.hint) }}</small>
          <small v-if="field.id === 'constraintValue' && constraintKeys" class="field-explanation">
            {{ tr('Expected keys for {0}: {1}', [model.constraintKind, constraintKeys]) }}
          </small>
          <small v-if="fieldHint(field.id, model[field.id] || '')" class="field-explanation">
            {{ fieldHint(field.id, model[field.id] || '') }}
          </small>
        </label>
      </div>
    </fieldset>
  </section>
</template>
<style scoped>
.knowledge-field-group {
  min-width: 0;
  padding: 0;
  margin: 22px 0 0;
  border: 0;
}
.knowledge-field-group legend {
  font-size: 15px;
  font-weight: 600;
  padding: 0;
  margin-bottom: 6px;
}
.knowledge-field-group > p {
  line-height: 1.6;
  margin: 0 0 16px;
}
</style>
