<template>
  <section class="focus-mode">
    <div class="section-header">
      <div>
        <div class="eyebrow">DEEP WORK</div>
        <h2>现在，只做一件事</h2>
      </div>
      <div id="focus-timer" class="large-timer">{{ displayTimer }}</div>
    </div>
    <div class="focus-actions">
      <button class="primary-btn" :disabled="isRunning" @click="startFocus">
        开始专注
      </button>
      <button class="secondary-btn" :disabled="!isRunning || isPaused" @click="pauseFocus">
        暂停
      </button>
      <button class="secondary-btn" :disabled="!isRunning" @click="resetFocus">
        重置
      </button>
    </div>
    <div class="work-type-card">
      <div>
        <strong>当前任务类型</strong>
        <p id="work-type-description">
          {{ workTypeText }}
        </p>
      </div>
      <label class="switch-row">
        <span>维持性</span>
        <input id="work-type-toggle" type="checkbox" :checked="workType === 'maintenance'" @change="toggleWorkType" />
        <span class="switch">
          <span></span>
        </span>
        <span>核心</span>
      </label>
    </div>
    <div class="loop-banner">
      <span>专注中</span><b>→</b><span>被干扰</span><b>→</b><span>觉察分心</span><b>→</b><span>注意力转回</span>
    </div>
    <section class="card distraction-card">
      <div class="card-title-row">
        <div>
          <h3>分心清单</h3>
          <p>按可控性与趣味性分类，找到下一次的应对方式。</p>
        </div>
        <button class="danger-btn" @click="showDistractionModal = true">
          �真实干扰</button>
      </div>
      <form id="distraction-form" class="distraction-form" @submit.prevent="onSubmitDistraction">
        <input
          id="distraction-input"
          maxlength="120"
          placeholder="刚才是什么打断了你？"
          v-model="newDistraction.text"
        />
        <select id="distraction-control" v-model="newDistraction.control">
          <option value="controllable">可控</option>
          <option value="uncontrollable">不可控</option>
        </select>
        <select id="distraction-interest" v-model="newDistraction.interest">
          <option value="interesting">有意思</option>
          <option value="boring">没意思</option>
        </select>
        <button class="secondary-btn" type="submit">记录</button>
      </form>
      <div id="distraction-grid" class="distraction-grid">
        <template v-for="[key, items] in distractionsByQuadrant" :key="key">
          <details class="quadrant" :open="items.length > 0">
            <summary class="quadrant-head">
              <span class="quadrant-count">{{ items.length }}</span>
              <span class="quadrant-advice">{{ getQuadrantAdvice(key) }}</span>
            </summary>
            <ul class="quadrant-list">
              <li
                class="quadrant-item"
                v-for="distraction in items"
                :key="distraction.id"
              >
                <div class="distraction-text">{{ distraction.text }}</div>
                <button
                  class="icon-btn"
                  @click="deleteDistraction(distraction.id)"
                  title="删除"
                >×</button>
              </li>
            </ul>
          </details>
        </template>
      </div>
    </section>
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useFocusStore } from '@/stores/focus'
import { useDistractionStore } from '@/stores/distraction'
import { useDailyPlanStore } from '@/stores/plan'
import { DISTRACTION_CONFIGS } from '@/utils/constants'

const focusStore = useFocusStore()
const distractionStore = useDistractionStore()
const planStore = useDailyPlanStore()

// Focus timer state
const isRunning = ref(false)
const isPaused = ref(false)
const plannedMs = ref(25 * 60 * 1000) // 25 minutes default
const elapsedMs = ref(0)
const focusedMs = ref(0)

// Work type: 'core' or 'maintenance'
const workType = ref('core')
const workTypeText = computed(() =>
  workType.value === 'core'
    ? '核心工作：高认知要求、直接推进目标'
    : '维持性工作：支持性任务、为核心工作创造条件'
)

// Timer display
const displayTimer = computed(() => {
  const remaining = Math.max(0, plannedMs.value - focusedMs.value)
  const totalSec = Math.floor(remaining / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const ms = Math.floor((remaining % 1000) / 10) // hundredths
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
})

// Distraction form state
const newDistraction = ref({
  text: '',
  control: 'controllable',
  interest: 'boring'
})
const showDistractionModal = ref(false)

// Distractions grouped by quadrant
const distractionsByQuadrant = computed(() => {
  const groups = {
    'controllable-interesting': [],
    'controllable-boring': [],
    'uncontrollable-interesting': [],
    'uncontrollable-boring': []
  }
  for (const d of distractionStore.distractions) {
    const key = `${d.control}-${d.interest}`
    if (groups[key]) groups[key].push(d)
  }
  return groups
})

// Get advice text for quadrant
function getQuadrantAdvice(key) {
  return DISTRACTION_CONFIGS[key]?.[1] || ''
}

// Focus timer logic
let timerHandle = null
let lastTick = 0

function startTicking() {
  stopTicking()
  lastTick = Date.now()
  timerHandle = setInterval(() => {
    if (isRunning.value && !isPaused.value) {
      const now = Date.now()
      const delta = now - lastTick
      lastTick = now
      focusedMs.value += delta
      if (focusedMs.value >= plannedMs.value) {
        stopFocus()
      }
    }
  }, 1000)
}

function stopTicking() {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}

async function startFocus() {
  isRunning.value = true
  isPaused.value = false
  focusedMs.value = 0
  startTicking()

  try {
    await focusStore.startFocus(plannedMs.value)
  } catch (e) {
    // Continue with local timer if backend fails
    console.warn('Backend focus start failed, using local timer')
  }
}

async function pauseFocus() {
  if (!isRunning.value) return

  isPaused.value = true
  stopTicking()

  try {
    await focusStore.pauseSession()
  } catch (e) {
    console.warn('Backend focus pause failed')
  }
}

async function resetFocus() {
  isRunning.value = false
  isPaused.value = false
  focusedMs.value = 0
  elapsedMs.value = 0
  stopTicking()

  try {
    await focusStore.stopSession()
  } catch (e) {
    console.warn('Backend focus reset failed')
  }
}

function toggleWorkType() {
  workType.value = workType.value === 'core' ? 'maintenance' : 'core'
}

async function onSubmitDistraction() {
  if (!newDistraction.value.text.trim()) return

  try {
    await distractionStore.addDistraction({
      text: newDistraction.value.text.trim(),
      control: newDistraction.value.control,
      interest: newDistraction.value.interest
    })
    newDistraction.value.text = ''

    // Show confetti effect (trigger CSS animation)
    // This would be handled by CSS class toggle in a real implementation

  } catch (e) {
    console.error('Failed to add distraction:', e)
  }
}

async function deleteDistraction(id) {
  try {
    await distractionStore.deleteDistraction(id)
  } catch (e) {
    console.error('Failed to delete distraction:', e)
  }
}

// Watchers
watch(() => focusStore.activeSession, (session) => {
  if (session) {
    isRunning.value = true
    isPaused.value = session.endTime !== 0 && !session.completed
    focusedMs.value = session.focusedMs || 0
    plannedMs.value = session.plannedMs || 25 * 60 * 1000
    if (!isRunning.value) stopTicking()
    else startTicking()
  }
})

// Initialize
watch(() => focusStore.sessions, () => {
  // Refresh when sessions change
})

// Start with focus store
focusStore.fetchActiveSession()
</script>

<style scoped>
.focus-mode {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.eyebrow {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--accent-hover);
  font-weight: 800;
}

.large-timer {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 48px;
  font-weight: 300;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.focus-actions {
  display: flex;
  gap: 12px;
}

.primary-btn, .secondary-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  transition: all var(--transition);
}

.primary-btn {
  background: var(--green);
  color: white;
}

.primary-btn:hover {
  background: var(--green-hover);
}

.secondary-btn {
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--surface);
}

.secondary-btn:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
  background: var(--accent-soft);
}

.work-type-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  margin-bottom: 14px;
}

.work-type-card p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.switch-row input {
  position: absolute;
  opacity: 0;
}

.switch {
  position: relative;
  width: 48px;
  height: 26px;
  border-radius: 20px;
  transition: 0.2s;
}

.switch span {
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 6px #0002;
  transition: 0.2s;
}

.switch-row input:checked + .switch {
  background: var(--green);
}

.switch-row input:checked + .switch span {
  transform: translateX(22px);
}

.loop-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
  padding: 11px;
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 13px;
  font-weight: 700;
}

.loop-banner b {
  color: var(--text-dim);
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 7px 24px rgba(44, 62, 56, 0.045);
}

.distraction-card {
  margin-bottom: 14px;
}

.distraction-form {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 110px 110px auto;
  gap: 8px;
  margin: 15px 0;
}

.distraction-form input,
.distraction-form select {
  min-width: 0;
  padding: 0 10px;
}

.distraction-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.quadrant {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}

.quadrant summary {
  padding: 13px;
  cursor: pointer;
  list-style: none;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quadrant-advice {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.quadrant-count {
  display: inline-grid;
  place-items: center;
  min-width: 27px;
  height: 27px;
  border-radius: 14px;
  background: var(--surface-3);
  color: var(--accent-hover);
}

.quadrant-list {
  list-style: none;
  padding: 0 13px 13px;
}

.quadrant-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
}

.distraction-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 600;
  transition: all var(--transition);
}

.icon-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
}

.danger-btn {
  background: var(--red);
  color: white;
}

.danger-btn:hover {
  background: var(--red-hover);
}
</style>