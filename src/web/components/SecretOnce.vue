<script setup lang="ts">
// 只显示一次的明文(邀请链接、API 令牌、恢复码),带复制按钮。
import { ref } from 'vue';
import AppDialog from './AppDialog.vue';
const props = defineProps<{ title: string; note: string; value: string }>();
const emit = defineEmits<{ close: [] }>();
const copied = ref(false);
async function copy() {
  await navigator.clipboard.writeText(props.value);
  copied.value = true;
}
</script>
<template>
  <AppDialog :title="title" @close="emit('close')">
    <p>{{ note }}</p>
    <pre class="secret">{{ value }}</pre>
    <div class="actions">
      <button type="button" class="ghost" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
      <button type="button" @click="emit('close')">Done</button>
    </div>
  </AppDialog>
</template>
