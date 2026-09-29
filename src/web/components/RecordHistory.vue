<script setup lang="ts">
// 记录版本历史(frontend-spec 5.5):从新到旧;每个版本可打开当时的原引用。
import { ref, watch } from 'vue';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { dateTime } from '../labels';
import { openEvidence } from '../evidence';
import type { RecordVersion } from '../../shared/types';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ recordId: string }>();
const emit = defineEmits<{ close: [] }>();
const versions = ref<RecordVersion[]>();
const error = ref('');
watch(
  () => props.recordId,
  async (id) => {
    try {
      versions.value = (
        await api<{ history: RecordVersion[] }>(`/api/records/${encodeURIComponent(id)}/history`)
      ).history;
    } catch (e) {
      error.value = errorText(e);
    }
  },
  { immediate: true },
);
</script>
<template>
  <AppDialog
    :eyebrow="tr('VERSION HISTORY')"
    :title="tr('Record history')"
    wide
    @close="emit('close')"
  >
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-else-if="!versions" class="hint">{{ tr('Loading…') }}</p>
    <article v-for="version in versions" :key="version.revision" class="version">
      <span class="tag">v{{ version.revision }}</span>
      <h4>{{ version.payload.title }}</h4>
      <p class="record-body">{{ version.payload.body }}</p>
      <p v-if="version.payload.personEmail">{{ version.payload.personEmail }}</p>
      <details v-if="version.payload.structured && Object.keys(version.payload.structured).length">
        <summary>{{ tr('Structured fields') }}</summary>
        <pre class="raw-preview">{{ JSON.stringify(version.payload.structured, null, 2) }}</pre>
      </details>
      <footer class="record-footer">
        <span>{{ version.author }} · {{ dateTime(version.createdAt) }}</span>
        <button type="button" class="link" @click="openEvidence(version.payload.evidenceId)">
          {{ tr('Version reference') }}
        </button>
      </footer>
    </article>
  </AppDialog>
</template>
