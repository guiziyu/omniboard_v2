<script setup lang="ts">
// 机构选择器(frontend-spec 2.15),从 v1 OrgPicker.vue 迁移:输入即搜索,旧响应丢弃,最多 30 条。
// exchangeOnly:只查带 exchange tag 的机构(来源映射 9.6)。
import { ref, watch } from 'vue';
import { api, errorText } from '../api';
import { tr } from '../i18n';
import { shortSource } from '../labels';
import type { DirectoryOrganization } from '../../shared/columns';
import OrgLogo from './OrgLogo.vue';
const props = defineProps<{ exclude?: string; exchangeOnly?: boolean }>();
const emit = defineEmits<{ select: [org: DirectoryOrganization] }>();
const q = ref('');
const results = ref<DirectoryOrganization[]>([]);
const loading = ref(false);
const error = ref('');
let serial = 0;
watch(
  q,
  async () => {
    const current = ++serial;
    loading.value = true;
    error.value = '';
    try {
      const response = await api<{ organizations: DirectoryOrganization[] }>(
        `/api/organizations?q=${encodeURIComponent(q.value)}&pageSize=30${props.exchangeOnly ? '&tag=exchange' : ''}`,
      );
      if (current === serial)
        results.value = response.organizations.filter((o) => o.id !== props.exclude);
    } catch (e) {
      if (current === serial) error.value = errorText(e);
    } finally {
      if (current === serial) loading.value = false;
    }
  },
  { immediate: true },
);
</script>
<template>
  <div class="org-picker">
    <input
      v-model="q"
      type="search"
      :placeholder="tr('Search organizations…')"
      :aria-label="tr('Search organizations to select')"
    />
    <p v-if="error" class="error" role="alert">{{ tr(error) }}</p>
    <p v-if="loading" class="hint">{{ tr('Searching…') }}</p>
    <div v-else class="picker-results">
      <button v-for="org in results" :key="org.id" type="button" @click="emit('select', org)">
        <OrgLogo :name="org.name" :src="org.logoUrl" small />
        <span>
          <strong>{{ org.name }}</strong>
          <small class="hint">
            {{ org.sourceNames.map(shortSource).join(' · ') || tr('Manually created') }}
          </small>
        </span>
        <span class="push hint">{{ tr('Select →') }}</span>
      </button>
      <p v-if="!results.length && !error" class="hint">{{ tr('No matching organizations') }}</p>
    </div>
  </div>
</template>
