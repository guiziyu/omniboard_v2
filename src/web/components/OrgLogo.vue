<script setup lang="ts">
// 机构标志(frontend-spec 2.16):有地址时显示图片(懒加载),没有或加载失败时显示名称首字母。
import { ref, watch } from 'vue';
import { tr } from '../i18n';
const props = defineProps<{ name: string; src?: string; small?: boolean }>();
const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
</script>
<template>
  <span class="avatar org-logo" :class="{ small, 'has-logo': src && !failed }">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="tr('{0} logo', [name])"
      loading="lazy"
      @error="failed = true"
    />
    <!-- 首字母只是装饰:名称已在旁边,读屏不重复。 -->
    <span v-else aria-hidden="true">{{ name.slice(0, 1) }}</span>
  </span>
</template>
