<script setup lang="ts">
// 进度轨道(frontend-spec 10.9):只高亮记录的那一个阶段,之前的阶段不视为已完成。从 v1 ProgressTrack.vue 迁移。
import { tr } from '../i18n';
import type { ProgressState } from '../../shared/work-progress';
import Icon from './Icon.vue';
defineProps<{
  title: string;
  icon: string;
  state: ProgressState;
  steps: { value: string; label: string }[];
  owner: string;
}>();
</script>
<template>
  <section class="progress-track" :aria-label="title">
    <header>
      <Icon :name="icon" :size="17" />
      <h4>{{ title }}</h4>
    </header>
    <p class="track-state" :class="'tone-' + state.tone" :title="tr(state.hint)">
      <Icon
        :name="state.tone === 'blocked' ? 'lock' : state.tone === 'complete' ? 'check' : 'clock'"
        :size="15"
      />
      {{ tr(state.label) }}
    </p>
    <ol
      class="track-steps"
      :aria-label="tr('{0} stages; highlighted stage is the recorded status', [title])"
    >
      <li
        v-for="step in steps"
        :key="step.value"
        :class="{ current: state.value === step.value }"
        :aria-current="state.value === step.value ? 'step' : undefined"
      >
        <span class="stage-dot" />
        <span>{{ tr(step.label) }}</span>
      </li>
    </ol>
    <p class="track-owner">
      {{ tr('Owner') }}
      <strong>{{ owner || tr('Not assigned') }}</strong>
    </p>
  </section>
</template>
