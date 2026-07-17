<template>
  <div class="app-shell" :class="{ 'timer-window': isTimerWindow, 'standalone-timer-window': isTimerWindow, 'is-minimized': tabCollapsed }">
    <TopBar @open-timer="openTimer" @open-long-tasks="openLongTasks" @open-soul="openSoulModal" @start-tutorial="productTour?.start()" @minimize-changed="onMinimizeChanged" />
    <router-view />
    <ProductTour ref="productTour" />
    <PlannerSettingsModal v-model:visible="showPlannerSettings" />
    <DistractionModal v-model:visible="showDistractionForm" @confirm="onDistractionConfirm" />
    <SoulModal v-if="showSoulModal" @close="closeSoulModal" />
    <ResetConfirmModal v-if="showResetConfirm" @confirm="onResetConfirm" @cancel="closeResetConfirm" />
    <div id="focus-duration-modal" class="modal" v-if="showDurationModal" @click.self="closeDurationModal">
      <form id="focus-duration-form" class="modal-card focus-duration-form" @submit.prevent="onDurationConfirm">
        <div class="settings-heading">
          <div>
            <div class="eyebrow">FOCUS TIMER</div>
            <h2>选择专注时长</h2>
          </div>
          <button class="icon-btn compact" type="button" @click="closeDurationModal">×</button>
        </div>
        <div class="focus-duration-presets" role="group">
          <button v-for="p in presets" :key="p" class="focus-duration-preset"
            :class="{ active: plannedMinutes === p }" type="button" @click="plannedMinutes = p">
            {{ p }} 分钟
          </button>
        </div>
        <label class="focus-duration-custom">
          <span>自定义专注时间</span>
          <input type="number" min="1" max="240" v-model.number="customMinutes" inputmode="numeric" />
          <small>分钟</small>
        </label>
        <div class="modal-actions">
          <button class="secondary-btn" type="button" @click="closeDurationModal">取消</button>
          <button class="primary-btn" type="submit">开始专注</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useDailyPlanStore } from '@/stores/plan'
import { useFocusStore } from '@/stores/focus'
import { useRuntimeStore } from '@/stores/runtime'
import { useElectron } from '@/composables/useElectron'

import TopBar from '@/components/TopBar.vue'
import PlannerSettingsModal from '@/components/PlannerSettingsModal.vue'
import DistractionModal from '@/components/DistractionModal.vue'
import SoulModal from '@/components/SoulModal.vue'
import ResetConfirmModal from '@/components/ResetConfirmModal.vue'
import ProductTour from '@/components/ProductTour.vue'

const router = useRouter()
const route = useRoute()
const planStore = useDailyPlanStore()
const focusStore = useFocusStore()
const runtime = useRuntimeStore()
const electron = useElectron()
const productTour = ref(null)

const isTimerWindow = computed(() => route.path === '/timer')
const longTasks = ref([])

// 卡片界面折叠状态
const tabCollapsed = ref(false)
function onMinimizeChanged(collapsed) {
  tabCollapsed.value = collapsed
}

// Gate state
const showGate = ref(true)
const currentMode = ref('focus')

// Modal state
const showPlannerSettings = ref(false)
const showDistractionForm = ref(false)
const showSoulModal = ref(false)
const showResetConfirm = ref(false)
const showDurationModal = ref(false)
const plannedMinutes = ref(25)
const customMinutes = ref(25)
const presets = [25, 45, 60, 90]

const tasks = ref([])

async function onStartFocus() {
  showGate.value = false
  showDurationModal.value = true
}

async function onDurationConfirm() {
  const mins = plannedMinutes.value || customMinutes.value || 25
  const durationMs = mins * 60 * 1000
  await focusStore.setPlannedMs(durationMs)
  await focusStore.startFocus(durationMs)
  showDurationModal.value = false
  currentMode.value = 'focus'
}

function closeDurationModal() {
  showDurationModal.value = false
}

function switchMode(mode) {
  currentMode.value = mode
}

function openTimer() {
  router.push('/timer')
}

function openLongTasks() {
  router.push('/long-tasks')
}

function openDistraction() {
  showDistractionForm.value = true
}

function onDistractionConfirm() {
  showDistractionForm.value = false
}

function onTaskChange() {
  planStore.fetchTasks()
}

function openSoulModal() {
  showSoulModal.value = true
}

function closeSoulModal() {
  showSoulModal.value = false
}

function openResetConfirm() {
  showResetConfirm.value = true
}

function closeResetConfirm() {
  showResetConfirm.value = false
}

function onResetConfirm() {
  planStore.resetPlan()
  showResetConfirm.value = false
}

provide('focusDuration', computed(() => runtime.focusDuration))
provide('showPlannerSettings', showPlannerSettings)
provide('showSoulModal', showSoulModal)
provide('tabCollapsed', tabCollapsed)

onMounted(async () => {
  try {
    await planStore.fetchTasks()
    tasks.value = planStore.tasks
  } catch (e) {
    console.error('Init failed:', e)
  }
})
</script>

<style scoped>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg);
  background-image:
    repeating-linear-gradient(0deg, rgba(80, 104, 91, 0.016) 0, rgba(80, 104, 91, 0.016) 1px, transparent 1px, transparent 4px),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.22) 0, rgba(255, 255, 255, 0.22) 1px, transparent 1px, transparent 7px);
  overflow: hidden;
}

</style>
