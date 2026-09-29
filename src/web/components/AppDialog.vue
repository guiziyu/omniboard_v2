<script lang="ts">
// 打开中的对话框栈:键盘只作用于最上层(frontend-spec 0.3)。
const stack: symbol[] = [];
</script>
<script setup lang="ts">
// 对话框共用行为(frontend-spec 0.3):Escape 与点遮罩关闭(忙时除外);Tab 困在最上层对话框内,
// 焦点在对话框外时被拉回;打开时先聚焦输入控件;关闭后焦点回到打开前的元素;背景禁止滚动。
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
const props = defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const self = Symbol('dialog');
const panel = ref<HTMLElement | null>(null);
const opener = document.activeElement as HTMLElement | null;
const focusable = () =>
  [
    ...(panel.value?.querySelectorAll<HTMLElement>('input, button, textarea, select, a[href]') ??
      []),
  ].filter((el) => !el.hasAttribute('disabled'));
function close() {
  if (!props.busy) emit('close');
}
function keydown(event: KeyboardEvent) {
  if (stack.at(-1) !== self) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusable();
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const inside = panel.value?.contains(document.activeElement);
  if (!inside) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(async () => {
  stack.push(self);
  document.addEventListener('keydown', keydown);
  document.body.style.overflow = 'hidden';
  await nextTick();
  // 先聚焦输入控件;只有按钮的对话框才落到按钮上(标题栏的关闭按钮在 DOM 里排在最前)。
  const root = panel.value;
  const target =
    root?.querySelector<HTMLElement>('input, textarea, select') ??
    root?.querySelector<HTMLElement>('.actions button') ??
    root;
  target?.focus();
});
onBeforeUnmount(() => {
  stack.splice(stack.indexOf(self), 1);
  document.removeEventListener('keydown', keydown);
  if (!stack.length) document.body.style.overflow = '';
  opener?.focus();
});
</script>
<template>
  <div class="overlay" @mousedown.self="close">
    <section
      ref="panel"
      class="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <header>
        <h2>{{ title }}</h2>
        <button type="button" class="ghost" aria-label="Close" :disabled="busy" @click="close">
          ✕
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
