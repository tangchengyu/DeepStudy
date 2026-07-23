<script setup lang="ts">
defineProps<{ name: 'today' | 'long' | 'focus' | 'habit' | 'mine' }>()
</script>

<template>
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <template v-if="name === 'today'">
      <path d="M5 4.5h14v15H5zM8 2.5v4M16 2.5v4M5 9h14M8.5 14l2 2 4-4" />
    </template>
    <template v-else-if="name === 'long'">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </template>
    <template v-else-if="name === 'focus'">
      <circle cx="12" cy="12" r="8" />
      <path d="m10.5 8.5 5 3.5-5 3.5z" />
    </template>
    <template v-else-if="name === 'habit'">
      <path d="M12 20v-8M12 14c-4 0-6-2.5-6-6 4 0 6 2.5 6 6ZM12 11c0-3.5 2-5.5 6-5.5 0 3.5-2 5.5-6 5.5Z" />
    </template>
    <template v-else>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6" />
    </template>
  </svg>
</template>

<style scoped>
svg {
  fill: none;
  height: 1.45rem;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  width: 1.45rem;
}
</style>
