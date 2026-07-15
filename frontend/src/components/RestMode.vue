<template>
  <section class="rest-mode">
    <div class="rest-message">
      <span>把注意力从<strong class="term-tip" title="专注模式：大脑像聚光灯般调动前额叶皮层，沿熟悉的神经通路集中精力解决具体问题。">专注模式</strong>切换到<strong class="term-tip" title="分散模式：大脑在放松状态下让思维发散，促使不同脑区产生随机连接，从而激发灵感与宏观洞察。">分散模式</strong>。</span>
      <span>在不使用电子产品娱乐的前提下，去做习惯性的、体力性的、亲近自然的、喜欢的事吧！</span>
    </div>

    <div class="rest-timer-container">
      <div id="rest-timer" class="large-timer centered">{{ displayTimer }}</div>
    </div>

    <div class="rest-custom-time">
      <div class="rest-custom-label">
        <strong>自定义休息时长</strong>
        <span>按当前体感调整恢复节奏</span>
      </div>
      <div class="time-inputs compact-time-inputs" role="group" aria-label="自定义休息时长">
        <label>
          <span>时</span>
          <input id="rest-h" type="number" min="0" max="23" value="0" v-model.number="timeInputs.h" aria-label="小时" :disabled="isRunning" />
        </label>
        <label>
          <span>分</span>
          <input id="rest-m" type="number" min="0" max="59" value="15" v-model.number="timeInputs.m" aria-label="分钟" :disabled="isRunning" />
        </label>
        <label>
          <span>秒</span>
          <input id="rest-s" type="number" min="0" max="59" value="0" v-model.number="timeInputs.s" aria-label="秒" :disabled="isRunning" />
        </label>
      </div>
    </div>

    <div class="center-actions">
      <ElButton
        id="rest-start"
        class="primary-btn"
        type="primary"
        :disabled="isRunning && !hasStopped"
        @click="toggleRest"
      >
        {{ isRunning && !isPaused ? '继续休息' : '开始休息' }}
      </ElButton>
      <ElButton
        id="rest-pause"
        class="secondary-btn"
        :disabled="!isRunning"
        @click="pauseRest"
      >
        暂停
      </ElButton>
      <ElButton
        id="rest-reset"
        class="secondary-btn"
        :disabled="isRunning && remainingMs > 0"
        @click="resetRest"
      >
        重置
      </ElButton>
    </div>

    <ElCard id="breathing-card" class="breathing-card" v-show="showBreathingCard">
      <h3>呼吸练习</h3>
      <p>跟随圆圈节奏呼吸，音频会在本机播放。</p>

      <div class="breathing-options">
        <ElButton
          class="breathing-btn"
          :data-kind="'box'"
          @click="startBreathing('box')"
          title="每次专注结束后的快速高效放松练习。4-4-4-4指的是使用腹式呼吸，吸气4秒，憋气4秒，呼气4秒，憋气4秒，依次循环的过程。【通过缓慢、规律且等时的吸气—屏息—呼气—屏息调节呼吸节律，可增强迷走神经活动、降低交感神经兴奋性，从而改善自主神经平衡，促进身心放松和注意力集中。】"
        >
          🧘 <span class="term-tip">4-4-4-4 腹式呼吸</span>
        </ElButton>
        <ElButton
          class="breathing-btn"
          :data-kind="'wim'"
          @click="startBreathing('wim')"
          title="适用于身体已经很疲惫，但有紧急任务必须专注完成的情况。短时间内可显著激活身体。但避免饭后立即练习，如有不适，应立即停止练习。不建议长期高频使用。【通过控制性过度通气（hyperventilation）与屏息交替，短暂激活交感神经系统并提高肾上腺素水平，从而增强机体对应激和炎症反应的调节能力。】"
        >
          ❄️ <span class="term-tip">冰人呼吸法</span>
        </ElButton>
      </div>

      <div id="breathing-stage" class="breathing-stage" :hidden="!breathingActive">
        <div id="breathing-circle" class="breathing-circle"></div>
        <div id="breathing-label" class="breathing-label">准备</div>
        <div id="breathing-count" class="breathing-count">循环 0 / 5</div>
        <ElButton
          id="breathing-stop"
          class="danger-btn"
          @click="stopBreathing"
        >
          停止呼吸练习
        </ElButton>
      </div>
    </ElCard>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElButton, ElCard } from 'element-plus'
import { useAudio } from '@/composables/useAudio'
import { api } from '@/api'

const props = defineProps({
  // Optional: receive rest duration from parent
})

const emit = defineEmits([])

// Timer state
const totalMs = ref(15 * 60 * 1000) // 15 minutes default
const remainingMs = ref(totalMs.value)
const isRunning = ref(false)
const isPaused = ref(false)
const hasStopped = ref(false)
let timerHandle = null
let lastTick = 0
let breathingRunId = 0 // Used to cancel stale breathing sessions

// Breathing state
const showBreathingCard = ref(true)
const breathingActive = ref(false)
const breathingType = ref(null)
const audioContext = ref(null)
const oscillatorNodes = ref([])
let breathingAudioEl = null

// Time inputs
const timeInputs = ref({
  h: 0,
  m: 15,
  s: 0
})

// Format timer display
const displayTimer = computed(() => {
  const ms = remainingMs.value
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const pad = (v) => String(v).padStart(2, '0')

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${pad(minutes)}:${pad(seconds)}`
})

// Timer logic
function startTicking() {
  stopTicking()
  lastTick = Date.now()
  timerHandle = setInterval(() => {
    if (isRunning.value && !isPaused.value && remainingMs.value > 0) {
      const now = Date.now()
      const delta = now - lastTick
      lastTick = now
      remainingMs.value = Math.max(0, remainingMs.value - delta)

      if (remainingMs.value <= 0) {
        stopRest()
      }
    }
  }, 200)
}

function stopTicking() {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}

function startRest() {
  if (isRunning.value) return

  hasStopped.value = false
  isRunning.value = true
  isPaused.value = false
  startTicking()

  // Update total based on inputs
  updateTotalFromInputs()
}

function pauseRest() {
  if (!isRunning.value) return

  isPaused.value = true
  stopTicking()
}

function resumeRest() {
  if (!isRunning.value || !isPaused.value) return

  isPaused.value = false
  startTicking()
}

function stopRest() {
  isRunning.value = false
  isPaused.value = false
  stopTicking()
  hasStopped.value = true
  showBreathingCard.value = true
}

function resetRest() {
  hasStopped.value = false
  isRunning.value = false
  isPaused.value = false
  stopTicking()

  // Reset to input values
  updateTotalFromInputs()
  showBreathingCard.value = false
  breathingActive.value = false
}

function toggleRest() {
  if (isRunning.value && isPaused.value) {
    resumeRest()
  } else if (isRunning.value && !isPaused.value) {
    pauseRest()
  } else if (!isRunning.value) {
    startRest()
  }
}

function updateTotalFromInputs() {
  const h = Math.max(0, Math.min(23, timeInputs.value.h || 0))
  const m = Math.max(0, Math.min(59, timeInputs.value.m || 15))
  const s = Math.max(0, Math.min(59, timeInputs.value.s || 0))

  totalMs.value = (h * 3600 + m * 60 + s) * 1000
  remainingMs.value = totalMs.value

timeInputs.value.h = h
  timeInputs.value.m = m
  timeInputs.value.s = s
}

// Breathing exercises
const { cleanup } = useAudio()

async function startBreathing(kind) {
  breathingType.value = kind
  breathingActive.value = true
  breathingRunId++
  stopBreathingAudio() // Reset any previous breathing session

  const activeRun = breathingRunId

  try {
    const cues = await loadBreathingCues()
    const kindCues = cues[kind]
    if (!kindCues) throw new Error(`No cues found for kind: ${kind}`)

    const timeline = kindCues
    await playBreathingGuide(kind, timeline, activeRun)
  } catch (error) {
    console.error('Failed to start breathing exercise:', error)
  }
}

function stopBreathing() {
  breathingActive.value = false
  breathingType.value = null
  breathingRunId++
  stopBreathingAudio()
  const { cleanup } = useAudio()
  cleanup()
}

function stopBreathingAudio() {
  if (breathingAudioEl) {
    breathingAudioEl.pause()
    breathingAudioEl.currentTime = 0
    breathingAudioEl.onended = null
    breathingAudioEl = null
  }

  const stage = document.getElementById('breathing-stage')
  if (stage) stage.hidden = true

  const circle = document.getElementById('breathing-circle')
  if (circle) circle.style.transform = 'scale(1)'
}

async function loadBreathingCues() {
  try {
    const response = await fetch('/api/audio/file/breathing_cues.json')
    if (!response.ok) {
      const fallback = await fetch('/assets/audio/breathing_cues.json')
      if (!fallback.ok) throw new Error('Failed to load breathing cues')
      return await fallback.json()
    }
    return await response.json()
  } catch (error) {
    console.error('Failed to load breathing cues:', error)
    throw error
  }
}

async function playBreathingGuide(kind, timeline, activeRun) {
  if (!timeline || !timeline.cues) {
    console.error('Invalid breathing cues data')
    return
  }

  const audioMap = {
    box: '/assets/audio/4-4-4-4.MP3',
    wim: '/assets/audio/wim_hof_3groups_v3_faster_22_24_final_320k.mp3'
  }

  try {
    const audioFile = audioMap[kind]
    const audio = new Audio(audioFile)
    breathingAudioEl = audio
    audio.playbackRate = timeline.playbackRate || 1
    audio.preservesPitch = false

    // Handle audio playback end
    audio.onended = () => {
      if (activeRun === breathingRunId) {
        stopBreathing()
      }
    }

    const stageEl = document.getElementById('breathing-stage')
    if (stageEl) stageEl.hidden = false

    await audio.play().catch(e => {
      console.error('Audio play failed:', e)
      throw e
    })

    const circle = document.getElementById('breathing-circle')
    if (!circle) return

    const labelEl = document.getElementById('breathing-label')
    const countEl = document.getElementById('breathing-count')

    const update = () => {
      if (activeRun !== breathingRunId || audio.paused) {
        return
      }

      const currentTime = audio.currentTime
      let cueIndex = timeline.cues.findIndex(
        cue => currentTime >= cue.start && currentTime < cue.end
      )
      if (cueIndex < 0) cueIndex = timeline.cues.length - 1

      const cue = timeline.cues[cueIndex]
      const cueDuration = Math.max(0.001, cue.end - cue.start)
      const progress = Math.max(
        0,
        Math.min(1, (currentTime - cue.start) / cueDuration)
      )
      const previousScale = timeline.cues[cueIndex - 1]?.scale ?? 1
      const scale = previousScale + (cue.scale - previousScale) * progress

      if (labelEl) {
        labelEl.textContent = cue.countdown
          ? `${cue.label} ${Math.ceil(Math.max(0, cue.end - currentTime) / (timeline.playbackRate || 1))}秒`
          : cue.label
      }

      if (countEl) {
        const groupTotal = timeline.groupTotal || 3
        const groupLabel = timeline.groupLabel || '组'
        countEl.textContent = cue.group
          ? `语音同步 · 第 ${cue.group} / ${groupTotal} ${groupLabel}`
          : `语音同步 · ${cueIndex + 1} / ${timeline.cues.length}`
      }

      circle.style.transform = `scale(${scale})`

      requestAnimationFrame(update)
    }

    update()
  } catch (error) {
    console.error('Audio playback failed:', error)
    if (activeRun === breathingRunId) {
      stopBreathing()
    }
  }
}

// Cleanup breathing animation frames and audio on component unmount
onBeforeUnmount(() => {
  stopTicking()
  stopBreathing()
  stopBreathingAudio()
  cleanup()
})

// Watchers
watch(() => props.restDuration, (newDuration) => {
  if (newDuration) {
    totalMs.value = newDuration
    remainingMs.value = newDuration
  }
})

// Initialize
onMounted(() => {
  // Auto-update time inputs if used previously
  updateTotalFromInputs()
})
</script>

<style scoped>
.rest-mode {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 0;
}

.rest-timer-container {
  display: flex;
  justify-content: center;
}

.rest-custom-time {
  margin: 16px 0;
}

.rest-custom-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

.rest-custom-label strong {
  font-size: 16px;
}

.rest-custom-label span {
  font-size: 14px;
  color: var(--text-muted);
}

.time-inputs {
  display: flex;
  gap: 12px;
  align-items: center;
}

.time-inputs label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.time-inputs input {
  width: 60px;
  padding: 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  text-align: center;
  font-family: Consolas, monospace;
}

.center-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.breathing-card {
  margin-top: 24px;
  padding: 24px;
}

.breathing-card h3 {
  margin-bottom: 8px;
}

.breathing-card p {
  margin-bottom: 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.breathing-options {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  justify-content: center;
}

.breathing-btn {
  flex: 1;
  min-width: 120px;
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
  transition: border-color var(--transition), background var(--transition), color var(--transition);
}

.breathing-btn:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}

#breathing-stage {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.breathing-circle {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent) 0%, var(--accent-soft) 70%);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease;
  box-shadow: 0 6px 20px rgba(63, 111, 98, 0.08);
}

.breathing-label {
  font-size: 24px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
}

.breathing-count {
  font-size: 14px;
  color: var(--text-muted);
}

#breathing-stop {
  margin-top: 12px;
}

.rest-message {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px;
  background: var(--accent-soft);
  border-radius: var(--radius);
  font-size: 14px;
  line-height: 1.5;
}

.term-tip {
  text-decoration: underline dashed;
  cursor: help;
  color: var(--accent-hover);
}

.rest-message strong {
  font-weight: 600;
  color: var(--text);
}

@media (max-width: 768px) {
  .time-inputs {
    justify-content: center;
  }

  .center-actions {
    flex-wrap: wrap;
  }

  .primary-btn,
  .secondary-btn {
    flex: 1;
    min-width: 120px;
  }
}
</style>
