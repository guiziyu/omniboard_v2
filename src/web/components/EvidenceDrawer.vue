<script setup lang="ts">
// 证据抽屉(frontend-spec 5.10):全局单例,打开新证据会替换当前内容;HTML 按文本显示,不执行脚本。
import { ref, watch } from 'vue';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { dateTime, sourceName } from '../labels';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();
type Preview = {
  evidence: {
    id: string;
    source: string;
    url: string;
    capturedAt: string;
    sha256: string;
    byteLength: number;
    parserVersion: string;
    filename: string;
  };
  text: string | null;
  truncated: boolean;
};
const preview = ref<Preview>();
const error = ref('');
let serial = 0;
watch(
  () => props.id,
  async (id) => {
    const current = ++serial;
    preview.value = undefined;
    error.value = '';
    try {
      const result = await api<Preview>(`/api/evidence/${encodeURIComponent(id)}`);
      if (current === serial) preview.value = result;
    } catch (e) {
      if (current === serial) error.value = errorText(e);
    }
  },
  { immediate: true },
);
</script>
<template>
  <AppDialog
    drawer
    :eyebrow="tr('SOURCE REFERENCE')"
    :title="tr('Original reference')"
    @close="emit('close')"
  >
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-else-if="!preview" class="hint">{{ tr('Loading original reference…') }}</p>
    <template v-else>
      <div class="evidence-meta">
        <span class="tag">{{ sourceName(preview.evidence.source, preview.evidence.url) }}</span>
        <h3>{{ preview.evidence.filename }}</h3>
        <dl>
          <dt>{{ tr('Captured') }}</dt>
          <dd>{{ dateTime(preview.evidence.capturedAt) }}</dd>
          <dt>{{ tr('Parser version') }}</dt>
          <dd>{{ preview.evidence.parserVersion }}</dd>
          <dt>{{ tr('File size') }}</dt>
          <dd>{{ tr('{0} bytes', [preview.evidence.byteLength.toLocaleString()]) }}</dd>
          <dt>SHA-256</dt>
          <dd>
            <code>{{ preview.evidence.sha256 }}</code>
          </dd>
        </dl>
        <div class="actions wrap">
          <a
            v-if="preview.evidence.url"
            :href="preview.evidence.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ tr('Open source page') }} ↗</a
          >
          <a :href="`/api/evidence/${encodeURIComponent(id)}/download`">{{
            tr('Download original file')
          }}</a>
        </div>
      </div>
      <p class="hint">
        {{
          tr(
            'Saved original content. HTML is displayed as text; page scripts are not executed.{0}',
            [
              preview.truncated
                ? ' ' + tr('Preview truncated. Download the full file to see all content.')
                : '',
            ],
          )
        }}
      </p>
      <pre v-if="preview.text !== null" class="raw-preview">{{ preview.text }}</pre>
      <div v-else class="empty">
        <h3>{{ tr('Attachment saved') }}</h3>
        <p>{{ tr('Download the attachment to view its original content.') }}</p>
      </div>
    </template>
  </AppDialog>
</template>
