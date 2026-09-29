<script setup lang="ts">
// 当场确认(frontend-spec 12.4):显示操作摘要,输入 6 位验证码后交给调用方随业务请求一起提交。
// 错误时对话框保留,由调用方传回 error。
import { ref } from 'vue';
import AppDialog from './AppDialog.vue';
defineProps<{ summary: string; busy?: boolean; error?: string }>();
const emit = defineEmits<{ confirm: [code: string]; close: [] }>();
const code = ref('');
</script>
<template>
  <AppDialog title="Confirm with your authenticator code" :busy="busy" @close="emit('close')">
    <form @submit.prevent="emit('confirm', code)">
      <p>{{ summary }}</p>
      <label for="step-up-code">6-digit code</label>
      <input
        id="step-up-code"
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="\d{6}"
        maxlength="6"
        required
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="ghost" :disabled="busy" @click="emit('close')">Cancel</button>
        <button type="submit" :disabled="busy || code.length !== 6">Confirm</button>
      </div>
    </form>
  </AppDialog>
</template>
