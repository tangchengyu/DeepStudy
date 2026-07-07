<template>
  <div class="mode-shell-wrapper">
    <GateView v-if="runtime.showGate" @start="onStartFocus" />

    <div v-else id="mode-shell">
      <div class="mode-sticky-header" :class="{ collapsed: tabCollapsed }">
        <button id="back-to-gate" class="back-to-gate" type="button" @click="backToGate" title="返回注意力空间大门">
          <span class="mode-control-icon" aria-hidden="true">←</span>
          <span>返回</span>
        </button>
        <ModeTabs :model-value="runtime.currentMode" @update:model-value="switchMode" />
      </div>

      <section v-show="runtime.currentMode === 'focus'" class="mode-panel active">
        <FocusMode :on-pause="openDistraction" />
      </section>

      <section v-show="runtime.currentMode === 'rest'" class="mode-panel active">
        <RestMode />
      </section>

      <section v-show="runtime.currentMode === 'habit'" class="mode-panel active">
        <HabitMode />
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRuntimeStore } from '@/stores/runtime'
import { useFocusStore } from '@/stores/focus'
import { useDailyPlanStore } from '@/stores/plan'
import { useDistractionStore } from '@/stores/distraction'
import { useSoulStore } from '@/stores/soul'

import GateView from '@/components/GateView.vue'
import ModeTabs from '@/components/ModeTabs.vue'
import FocusMode from '@/components/FocusMode.vue'
import RestMode from '@/components/RestMode.vue'
import HabitMode from '@/components/HabitMode.vue'

const runtime = useRuntimeStore()
const focusStore = useFocusStore()
const planStore = useDailyPlanStore()
const distractionStore = useDistractionStore()
const soulStore = useSoulStore()

async function onStartFocus() {
  runtime.exitGate()
  runtime.setMode('focus')
}

function backToGate() {
  runtime.enterGate()
}

function switchMode(mode) {
  runtime.setMode(mode)
}

function openDistraction() {
  runtime.openDistractionModal()
}

onMounted(async () => {
  try {
    await Promise.all([
      planStore.fetchTasks(),
      soulStore.fetchRandom(),
      distractionStore.fetchDistractions()
    ])
  } catch (e) {
    console.error('Init failed:', e)
  }
})
</script>

<style scoped>
.mode-shell-wrapper {
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

#mode-shell {
  max-width: 1040px;
  margin: 0 auto;
  width: 100%;
  flex: 1;
  overflow: auto;
}

.mode-sticky-header {
  position: sticky;
  top: 8px;
  z-index: 15;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 18px;
  margin-bottom: 20px;
  padding: 8px 10px;
  border: 1px solid rgba(208, 229, 216, 0.9);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 16px 38px rgba(44, 62, 56, 0.08);
  backdrop-filter: blur(12px);
}

.mode-sticky-header.collapsed #back-to-gate,
.mode-sticky-header.collapsed .mode-tabs {
  display: none;
}

#back-to-gate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 44px;
  min-width: 112px;
  padding: 0 18px;
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--text-muted);
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

#back-to-gate:hover {
  color: var(--accent);
  border-color: var(--accent-soft);
  background: var(--surface);
}

.mode-control-icon {
  font-size: 16px;
  line-height: 1;
}

.mode-panel {
  padding: 10px 0 40px;
}

@media (max-width: 620px) {
  .mode-sticky-header {
    grid-template-columns: 1fr;
    gap: 7px;
    padding: 7px;
    border-radius: 16px;
  }

  #back-to-gate {
    justify-self: start;
    height: 34px;
    min-width: 78px;
    padding: 0 11px;
    font-size: 13px;
  }
}
</style>
