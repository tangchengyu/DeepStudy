<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import BottomNavigation from './components/BottomNavigation.vue'
import MobileTutorial from './components/MobileTutorial.vue'
import { initializeAppServices } from './services/appServices'

const MOBILE_TUTORIAL_SEEN_KEY = 'deepstudy.mobileTutorial.seen.v1'
const ready = ref(false)
const tutorialOpen = ref(false)

function openTutorial() {
  localStorage.setItem(MOBILE_TUTORIAL_SEEN_KEY, '1')
  tutorialOpen.value = true
}

function closeTutorial() {
  tutorialOpen.value = false
}

onMounted(async () => {
  await initializeAppServices().catch(() => undefined)
  ready.value = true
  window.addEventListener('deepstudy:open-mobile-tutorial', openTutorial)
  if (localStorage.getItem(MOBILE_TUTORIAL_SEEN_KEY) !== '1') openTutorial()
})

onBeforeUnmount(() => {
  window.removeEventListener('deepstudy:open-mobile-tutorial', openTutorial)
})
</script>

<template>
  <div v-if="ready" class="app-shell">
    <RouterView />
    <BottomNavigation />
    <MobileTutorial v-if="tutorialOpen" @close="closeTutorial" />
  </div>
  <div v-else class="app-shell app-shell--loading" role="status">正在读取本机数据…</div>
</template>
