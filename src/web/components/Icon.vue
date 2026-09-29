<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
  roadmap: 'M5 3v18M5 4h13l-3 4 3 4H5M10 17h9m-3-3 3 3-3 3',
  arrival: 'M14 3h7v18h-7M3 12h13m-4-4 4 4-4 4',
  departure: 'M10 3H3v18h7M8 12h13m-4-4 4 4-4 4',
  settings: 'M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2M11 3h4v6h-4zM6 9h4v6H6zM14 15h4v6h-4z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  building: 'M4 21V5l8-3 8 3v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  compare: 'M4 4v16M20 4v16M7 8h10m-3-3 3 3-3 3M17 16H7m3-3-3 3 3 3',
  database:
    'M21 6c0 2.2-4 4-9 4S3 8.2 3 6s4-4 9-4 9 1.8 9 4M3 6v12c0 2.2 4 4 9 4s9-1.8 9-4V6M3 12c0 2.2 4 4 9 4s9-1.8 9-4',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M6 18 18 6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v5h-5',
  external: 'M14 3h7v7M10 14 21 3M21 14v7H3V3h7',
  file: 'M14 2H4v20h16V8zM14 2v6h6M8 13h8M8 17h6',
  check: 'm5 12 4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  edit: 'm16 3 5 5L8 21H3v-5zM13 6l5 5',
  chart: 'M3 3v18h18M7 16v-4M12 16V8M17 16V5',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  logout: 'M9 3H3v18h6M9 12h12m-4-4 4 4-4 4',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.file" />
  </svg>
</template>
