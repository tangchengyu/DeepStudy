<template>
  <main class="timer-window-app">
    <div class="timer-container">
      <h1 class="timer-title">专注计时器</h1>

      <div v-if="!focusStarted" class="timer-presets">
        <button
          v-for="mins in [25, 45, 60, 90]"
          :key="mins"
          class="preset-button"
          :class="{active: presetMinutes === mins}"
          @click="setPreset(mins)"
        >
          {{ mins }}分钟
        </button>
      </div>

      <div class="custom-preset">
        <label>
          <span>自定义分钟数：</span>
          <input
            v-model.number="customMinutes"
            type="number"
            min="1"
            max="360"
            placeholder="输入分钟数"
            @keyup.enter="onCustomPreset"
          />
        </label>
      </div>

      <div class="timer-controls">
        <button class="control-btn start-btn" @click="startFocus" v-if="!focusStarted">
          开始专注
        </button>

        <button class="control-btn stop-btn" @keyup="stopFocus" v-if="focusStarted && !inRest">
          停止并回顾
        </button>

        <div class="cyber-clock" v-if="focusStarted">
          <div class="clock-display">{{ display.timer }}</div>
          <div class="clock-label">专注计时中</div>

          <div v-if="currentSession.pomos" class="pomo-info">
            Session {{ currentSession.count }}/{{ currentSession.pomos }}
            <span v-if="currentSession.pomos > 1">({{ currentSession.progress }}%)</span>
          </div>
        </div>
      </div>

      <div class="work-mode-toggle">
        <button
          @click="toggleMode"
          class="mode-toggle-btn"
        >
          {{ mode === 'work' ? '切换到休息' : '切换到专注' }}
        </button>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useFocusStore } from '@/stores/focus'

const router = useRouter()
const focusStore = useFocusStore()

const focusStarted = ref(false)
const launchAt = ref(0)
const customMinutes = ref(25)
const presetMinutes = ref(25)
const mode = ref('work') // 'work' or 'rest'

const currentTime = ref(Date.now())
const alerts = ref([])

const display = ref({
  timer: '00:00:00',
  elapsed: '0:00:00',
  speed: '1.00x'
})

const currentSession = reactive({
  count: 1,
  pomos: 4,
  progress: 0
})

let timer = null

const formatTimespan = (ms) => {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const getPercentage = () => {
  const now = Date.now()
  const duration = customMinutes.value * 60 * 1000
  const elapsed = now - launchAt.value
  return Math.min(Math.floor((elapsed / duration) * 100), 100)
}

const setPreset = (mins) => {
  presetMinutes.value = mins
  customMinutes.value = mins
}

const toggleMode = () => {
  mode.value = mode.value === 'work' ? 'rest' : 'work'
}

const startFocus = async () => {
  focusStarted.value = true
  launchAt.value = Date.now()
  const totalMs = customMinutes.value * 60 * 1000
  const startAt = Date.now()

  timer = setInterval(() => {
    const now = Date.now()
    const elapsed = now - startAt
    const remaining = Math.max(0, totalMs - elapsed)

    display.value.timer = formatTimespan(remaining)
    display.value.elapsed = formatTimespan(elapsed)

    currentTime.value = now
    currentSession.progress = getPercentage()

    if (remaining <= 0) {
      clearInterval(timer)
      timer = null
      focusStarted.value = false
      // Add success toast
      alerts.value.push({type: 'success', message: '专注会话完成！'})
    }
  }, 250)
}

const stopFocus = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  focusStarted.value = false
  alerts.value.push({type: 'info', message: '专注会话停止'})
}

const backToMain = () => {
  router.replace('/')
}

// Watch mode changes
watch(() => mode.value, () => {
  // Mode-specific logic can go here
})
</script>

<style scoped>
.timer-window-app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
  justify-content: center;
  align-items: center;
  background: var(--bg-timer);
}

timer-container {
  width: 100%;
  max-width: 500px;
  text-align: center;
}

.timer-title {
  font-size: 2.2rem;
  font-weight: 700;
  margin-bottom: 2rem;
  color: var(--text-on-timer);
  text-align: center;
}

.timer-presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.preset-button {
  padding: 15px 0;
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-timer);
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-button:hover {
  box-shadow: 0 2px 8px rgba(63, 111, 98, 0.08);
}

.preset-button.active {
  background: var(--accent);
  color: white;
}

.custom-preset label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  color: var(--text-timer);
}

.custom-preset input {
  padding: 12px 16px;
  width: 120px;
  border-radius: 8px;
  border: 1px solid var(--border-timer);
  background: white;
  font-size: 1rem;
  text-align: center;
}

.timer-controls {
  margin-bottom: 2rem;
  width: 100%;
  max-width: 400px;
}

.control-btn {
  width: 100%;
  padding: 18px 0;
  border-radius: 12px;
  font-size: 1.2rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}

.start-btn {
  background: linear-gradient(135deg, #70ad99, #568f7c);
  color: white;
  box-shadow: 0 4px 14px rgba(63, 111, 98, 0.12);
}

.start-btn:hover {
  box-shadow: 0 5px 16px rgba(63, 111, 98, 0.14);
}

.stop-btn {
  background: linear-gradient(135deg, var(--accent-soft), #b5d5ce);
  color: var(--text-timer);
  border: 1px solid var(--border-timer);
}

.cyber-clock {
  margin: 2rem auto;
  padding: 30px 20px;
  border-radius: 24px;
  background: linear-gradient(145deg, rgba(112, 173, 153, 0.12), rgba(131, 170, 198, 0.1));
  backdrop-filter: blur(10px);
  width: 100%;
  max-width: 400px;
  box-shadow: 0 6px 20px rgba(50, 68, 59, 0.1);
}

.clock-display {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 3.5rem;
  font-weight: 500;
  color: var(--text-timer);
  letter-spacing: 2px;
  margin-bottom: 10px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.clock-label {
  font-size: 1.1rem;
  color: var(--text-timer-secondary);
  opacity: 0.85;
}

.pomo-info {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px dashed var(--border-timer);
  color: var(--text-timer-secondary);
  font-size: 0.95rem;
}

.work-mode-toggle {
  margin-top: 2rem;
}

.mode-toggle-btn {
  padding: 8px 24px;
  background: var(--surface-2);
  color: var(--text-on-timer);
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  border: none;
}

.mode-toggle-btn:hover {
  background: var(--accent-soft);
}

@media (max-width: 600px) {
  .timer-presets {
    grid-template-columns: 1fr;
  }
}
</style>
