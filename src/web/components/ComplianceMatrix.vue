<script setup lang="ts">
// Compliance 规则矩阵(frontend-spec 5.8),从 v1 ComplianceMatrix.vue 迁移。
import type { ModuleRecord } from '../../shared/types';
import { fieldOptionLabel } from '../presentation';
import { tr } from '../i18n';
defineProps<{ records: ModuleRecord[]; selected?: string }>();
const emit = defineEmits<{ open: [record: ModuleRecord] }>();
</script>
<template>
  <section class="compliance-matrix" :aria-label="tr('Compliance rules')">
    <p class="hint">
      {{
        tr(
          'Each row is a recorded policy scope. Unknown eligibility does not mean permission to trade.',
        )
      }}
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ tr('Exact legal entity') }}</th>
            <th>{{ tr('Jurisdiction') }}</th>
            <th>{{ tr('Product and customer scope') }}</th>
            <th>{{ tr('Who can use this?') }}</th>
            <th>{{ tr('Effective on') }}</th>
            <th>{{ tr('Reference') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in records"
            :key="record.id"
            :aria-current="record.id === selected ? 'true' : undefined"
          >
            <td>{{ record.structured.legalEntity || tr('Not recorded') }}</td>
            <td>{{ record.structured.jurisdiction || tr('Not recorded') }}</td>
            <td>{{ record.structured.product || tr('Not recorded') }}</td>
            <td>
              <span
                class="policy-decision"
                :class="'decision-' + (record.structured.decision || 'unknown')"
              >
                {{ fieldOptionLabel('decision', record.structured.decision || 'unknown') }}
              </span>
            </td>
            <td>{{ record.structured.effectiveOn || tr('Not recorded') }}</td>
            <td>
              <button type="button" class="link" @click="emit('open', record)">
                {{ tr('Rule & evidence') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
