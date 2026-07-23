<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import BottomNavigation from './components/BottomNavigation.vue'
import { initializeAppServices } from './services/appServices'

const ready = ref(false)

onMounted(async () => {
  await initializeAppServices().catch(() => undefined)
  ready.value = true
})
</script>

<template>
  <div v-if="ready" class="app-shell">
    <RouterView />
    <BottomNavigation />
  </div>
  <div v-else class="app-shell app-shell--loading" role="status">正在读取本机数据…</div>
</template>
