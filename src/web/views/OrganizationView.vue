<script setup lang="ts">
// 机构详情页框架(frontend-spec 4.1)的过渡版本:标题区与返回目录。模块 tab 随记录一起移植(§4、§5)。
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorText, session } from '../api';
import { formatTime } from '../format';
import { tagDefinitions } from '../../shared/tags';
import type { DirectoryOrganization } from '../../shared/columns';
import OrgLogo from '../components/OrgLogo.vue';
type Organization = Omit<DirectoryOrganization, 'rank' | 'values'>;
const route = useRoute();
const router = useRouter();
const locale = computed(() => session.user?.locale ?? 'en');
const organization = ref<Organization | null>(null);
const error = ref('');
let serial = 0;
watch(
  () => String(route.params.id),
  async (id) => {
    const current = ++serial;
    error.value = '';
    try {
      const result = await api<{ organization: Organization }>(
        `/api/organizations/${encodeURIComponent(id)}`,
      );
      if (current !== serial) return;
      // 已合并为别名的旧 ID → 规范 ID,保留 tab 与 query(4.1)。
      if (result.organization.id !== id) {
        await router.replace({
          path: `/w/internal/organizations/${result.organization.id}/${String(route.params.tab || 'overview')}`,
          query: route.query,
        });
        return;
      }
      organization.value = result.organization;
    } catch (e) {
      if (current === serial) error.value = errorText(e);
    }
  },
  { immediate: true },
);
</script>
<template>
  <section class="page">
    <RouterLink :to="{ path: '/w/internal/organizations', query: route.query }" class="back">
      ← Organizations
    </RouterLink>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-else-if="organization">
      <header class="org-head">
        <OrgLogo :name="organization.name" :src="organization.logoUrl" />
        <div>
          <h1>{{ organization.name }}</h1>
          <p>
            <span v-for="t in organization.tags" :key="t" class="tag">
              {{ tagDefinitions[t].title }}
            </span>
          </p>
        </div>
      </header>
      <p v-if="organization.description">{{ organization.description }}</p>
      <p class="hint">
        Added {{ formatTime(organization.createdAt, locale) }} · {{ organization.recordCount }}
        records
      </p>
      <p class="hint">Research modules for this organization are being moved to the new version.</p>
    </template>
    <p v-else class="hint">Loading organization…</p>
  </section>
</template>
