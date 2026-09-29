<script setup lang="ts">
// 列说明浮层(frontend-spec 2.14):点「ⓘ」切换;点外部、关闭按钮、Escape、窗口尺寸变化、页面滚动
// (浮层内部滚动除外)都会关闭;靠按钮右侧对齐,下方放不下时显示在上方;点按钮不触发列头排序。
import { onMounted, onUnmounted, ref, useId } from 'vue';
defineProps<{ title: string; description: string; sourceUrl?: string }>();
const id = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const opened = ref(false);
const left = ref(12);
const top = ref(12);
function place() {
  if (!trigger.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const height = panel.value?.offsetHeight || 170;
  left.value = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
  top.value =
    rect.bottom + height + 10 < window.innerHeight
      ? rect.bottom + 8
      : Math.max(12, rect.top - height - 8);
}
function toggled(event: Event) {
  opened.value = (event as ToggleEvent).newState === 'open';
  if (opened.value) place();
}
function dismiss() {
  if (opened.value) panel.value?.hidePopover();
}
function scrolled(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return;
  dismiss();
}
onMounted(() => {
  window.addEventListener('resize', dismiss);
  document.addEventListener('scroll', scrolled, true);
});
onUnmounted(() => {
  window.removeEventListener('resize', dismiss);
  document.removeEventListener('scroll', scrolled, true);
});
</script>
<template>
  <span class="column-help">
    <button
      ref="trigger"
      type="button"
      class="info-button"
      :aria-label="`About ${title}`"
      :aria-expanded="opened"
      :aria-controls="id"
      :popovertarget="id"
      @click.stop="place"
    >
      ⓘ
    </button>
    <div
      :id="id"
      ref="panel"
      popover="auto"
      class="column-help-panel"
      role="region"
      :aria-label="`${title} explained`"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @toggle="toggled"
    >
      <header>
        <strong>{{ title }}</strong>
        <button
          type="button"
          class="ghost"
          :popovertarget="id"
          popovertargetaction="hide"
          :aria-label="`Close ${title} explanation`"
        >
          ✕
        </button>
      </header>
      <p>{{ description }}</p>
      <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer"
        >Methodology ↗</a
      >
    </div>
  </span>
</template>
