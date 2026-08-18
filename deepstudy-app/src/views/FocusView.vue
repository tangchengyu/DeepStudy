<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import boxBreathingAudioUrl from '../assets/audio/4-4-4-4.MP3?url'
import breathingTimelines from '../assets/audio/breathing_cues.json'
import muyuAudioUrl from '../assets/audio/muyu.mp3?url'
import rainAudioUrl from '../assets/audio/rain.mp3?url'
import wimBreathingAudioUrl from '../assets/audio/wim_hof_3groups_v3_faster_22_24_final_320k.mp3?url'
import { mobileFocusTimerService } from '../services/appServices'
import type { TimerMode } from '../services/focusTimerService'
import { focusTimerServiceKey } from '../services/focusTimerServiceContext'

type NoiseTrackId = 'muyu' | 'rain'
type BreathingKind = 'box' | 'wim'

interface BreathingCue {
  start: number
  end: number
  label: string
  scale: number
  countdown?: boolean
  group?: number
}

interface BreathingTimeline {
  playbackRate: number
  groupLabel?: string
  groupTotal?: number
  cues: BreathingCue[]
}

const timer = inject(focusTimerServiceKey, mobileFocusTimerService)
const durationMinutes = ref(timer.state.local.plannedMs / 60_000)
const distractionText = ref('')
const distractionControl = ref<'controllable' | 'uncontrollable'>('controllable')
const distractionInterest = ref<'interesting' | 'boring'>('interesting')
const actionError = ref('')
const actionBusy = ref(false)
const displayNow = ref(Date.now())
const noiseOpen = ref(false)
const noiseVolume = ref(70)
const lastNoiseVolume = ref(70)
const noiseRate = ref(1)
const activeNoiseId = ref<NoiseTrackId | ''>('')
const noiseStatus = ref('')
const breathingOpen = ref(false)
const breathingActive = ref(false)
const breathingKind = ref<BreathingKind | ''>('')
const breathingLabel = ref('准备')
const breathingCount = ref('语音同步 · 准备')
const breathingScale = ref(1)
let displayInterval: ReturnType<typeof setInterval> | null = null
let lastRemoteRefreshAt = 0
let breathingFrame: number | null = null
let breathingAudio: HTMLAudioElement | null = null
let breathingRunId = 0
const noisePlayers = new Map<NoiseTrackId, HTMLAudioElement>()

const noiseTracks: Array<{ id: NoiseTrackId; name: string; url: string }> = [
  { id: 'muyu', name: '木鱼白噪音', url: muyuAudioUrl },
  { id: 'rain', name: '雨声白噪音', url: rainAudioUrl },
]
const breathingPlans: Record<BreathingKind, { name: string; url: string }> = {
  box: { name: '4-4-4-4 腹式呼吸', url: boxBreathingAudioUrl },
  wim: { name: '冰人呼吸法', url: wimBreathingAudioUrl },
}
const breathingTimelineMap = breathingTimelines as Record<BreathingKind, BreathingTimeline>

const local = computed(() => timer.state.local)
const lockedByRemote = computed(() => timer.state.ownershipConflict && Boolean(timer.state.remote))
const noiseMuted = computed(() => noiseVolume.value === 0)
const localRemaining = computed(() => {
  displayNow.value
  return timer.remainingMs()
})
const remoteRemaining = computed(() => {
  const remote = timer.state.remote
  if (!remote) return 0
  return remote.status === 'running' && remote.targetEndAt !== null
    ? Math.max(0, remote.targetEndAt - displayNow.value)
    : remote.remainingMs
})
const statusLabel = computed(() => ({
  idle: '待开始',
  running: local.value.mode === 'focus' ? '正在专注' : '正在休息',
  paused: '已暂停',
  completed: '本轮完成',
})[local.value.status])
const mainActionLabel = computed(() => {
  if (local.value.status === 'paused') return local.value.mode === 'focus' ? '继续专注' : '继续休息'
  if (local.value.status === 'completed') return '开始新一轮'
  return local.value.mode === 'focus' ? '开始专注' : '开始休息'
})

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function playerForNoise(track: { id: NoiseTrackId; url: string }) {
  let player = noisePlayers.get(track.id)
  if (!player) {
    player = new Audio(track.url)
    player.loop = true
    noisePlayers.set(track.id, player)
  }
  player.volume = noiseVolume.value / 100
  player.playbackRate = noiseRate.value
  return player
}

function applyNoiseSettings() {
  noisePlayers.forEach((player) => {
    player.volume = noiseVolume.value / 100
    player.playbackRate = noiseRate.value
  })
}

function setNoiseRate(rate: number) {
  noiseRate.value = rate
  applyNoiseSettings()
}

function setNoiseVolume() {
  if (noiseVolume.value > 0) lastNoiseVolume.value = noiseVolume.value
  applyNoiseSettings()
}

function toggleNoiseMute() {
  if (noiseVolume.value > 0) {
    lastNoiseVolume.value = noiseVolume.value
    noiseVolume.value = 0
  } else {
    noiseVolume.value = lastNoiseVolume.value || 70
  }
  applyNoiseSettings()
}

async function toggleNoise(track: { id: NoiseTrackId; name: string; url: string }) {
  try {
    const player = playerForNoise(track)
    if (activeNoiseId.value === track.id && !player.paused) {
      player.pause()
      activeNoiseId.value = ''
      noiseStatus.value = `已暂停${track.name}。`
      return
    }
    noisePlayers.forEach((item, id) => {
      if (id !== track.id) {
        item.pause()
        item.currentTime = 0
      }
    })
    if (noiseMuted.value) noiseVolume.value = lastNoiseVolume.value || 70
    applyNoiseSettings()
    noiseStatus.value = `正在加载${track.name}…`
    await player.play()
    activeNoiseId.value = track.id
    noiseStatus.value = `正在播放${track.name}。`
  } catch {
    activeNoiseId.value = ''
    noiseStatus.value = `${track.name}播放失败，请重试。`
  }
}

function stopBreathing() {
  breathingRunId += 1
  if (breathingFrame !== null) cancelAnimationFrame(breathingFrame)
  breathingFrame = null
  breathingActive.value = false
  breathingKind.value = ''
  breathingScale.value = 1
  if (breathingAudio) {
    breathingAudio.onended = null
    breathingAudio.pause()
    breathingAudio.currentTime = 0
  }
}

async function startBreathing(kind: BreathingKind) {
  stopBreathing()
  const plan = breathingPlans[kind]
  const timeline = breathingTimelineMap[kind]
  if (!timeline?.cues?.length) {
    breathingLabel.value = '呼吸提示时间轴加载失败'
    breathingCount.value = '请重试'
    breathingOpen.value = true
    return
  }
  breathingRunId += 1
  const activeRun = breathingRunId
  breathingOpen.value = true
  breathingActive.value = true
  breathingKind.value = kind
  breathingLabel.value = '准备'
  breathingCount.value = '语音同步 · 准备'
  breathingScale.value = 1
  breathingAudio = new Audio(plan.url)
  breathingAudio.playbackRate = timeline.playbackRate
  breathingAudio.preservesPitch = false
  breathingAudio.onended = stopBreathing

  const update = () => {
    if (activeRun !== breathingRunId || !breathingAudio || breathingAudio.paused) return
    const currentTime = breathingAudio.currentTime
    let cueIndex = timeline.cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end)
    if (cueIndex < 0) cueIndex = Math.max(0, timeline.cues.length - 1)
    const cue = timeline.cues[cueIndex]
    const cueDuration = Math.max(0.001, cue.end - cue.start)
    const progress = Math.max(0, Math.min(1, (currentTime - cue.start) / cueDuration))
    const previousScale = timeline.cues[cueIndex - 1]?.scale ?? 1
    breathingScale.value = previousScale + (cue.scale - previousScale) * progress
    const secondsLeft = Math.ceil(Math.max(0, cue.end - currentTime) / timeline.playbackRate)
    breathingLabel.value = cue.countdown ? `${cue.label} ${secondsLeft}秒` : cue.label
    breathingCount.value = cue.group
      ? `语音同步 · 第 ${cue.group} / ${timeline.groupTotal || 3} ${timeline.groupLabel || '组'}`
      : `语音同步 · ${cueIndex + 1} / ${timeline.cues.length}`
    breathingFrame = requestAnimationFrame(update)
  }

  try {
    await breathingAudio.play()
    if (activeRun === breathingRunId) update()
  } catch {
    breathingLabel.value = '音频播放失败，请重试'
    breathingCount.value = '语音同步 · 未开始'
    breathingActive.value = false
  }
}

async function perform(action: () => Promise<unknown>) {
  if (actionBusy.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await action()
  } catch {
    actionError.value = '操作未完成，本机数据仍会保留，请重试。'
  } finally {
    actionBusy.value = false
  }
}

async function switchMode(mode: TimerMode) {
  await perform(async () => {
    if (await timer.setMode(mode)) {
      if (mode !== 'rest') {
        stopBreathing()
        breathingOpen.value = false
      }
      durationMinutes.value = timer.state.local.plannedMs / 60_000
    }
  })
}

function applyDuration() {
  return perform(async () => {
    await timer.setDuration(durationMinutes.value)
    durationMinutes.value = timer.state.local.plannedMs / 60_000
  })
}

function mainAction() {
  return perform(async () => {
    if (local.value.status === 'paused') await timer.resume()
    else if (local.value.status === 'completed') {
      await timer.reset()
      await timer.start()
    } else await timer.start()
  })
}

function finishDistraction(returnToFocus: boolean) {
  return perform(async () => {
    await timer.finishDistraction(
      distractionText.value,
      distractionControl.value,
      distractionInterest.value,
      returnToFocus,
    )
    distractionText.value = ''
  })
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void timer.reconcileVisibility()
}

onMounted(async () => {
  await timer.initialize()
  durationMinutes.value = timer.state.local.plannedMs / 60_000
  displayInterval = setInterval(() => {
    displayNow.value = Date.now()
    if (timer.state.local.status === 'running') void timer.tick()
    if (timer.state.remote && displayNow.value - lastRemoteRefreshAt >= 10_000) {
      lastRemoteRefreshAt = displayNow.value
      void timer.refreshRemote()
    }
  }, 250)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  if (displayInterval) clearInterval(displayInterval)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  noisePlayers.forEach((player) => player.pause())
  stopBreathing()
})
</script>

<template>
  <main class="page focus-page">
    <header class="screen-heading">
      <h1>专注</h1>
      <p>计时先保存在手机上；登录后会在开始或恢复前核对设备所有权。</p>
    </header>

    <section
      class="mode-switcher mode-segments"
      aria-label="选择计时模式"
      data-testid="focus-mode-segments"
    >
      <button
        type="button"
        class="mode-segment"
        :class="{ 'mode-segment--active': local.mode === 'focus' }"
        :aria-pressed="local.mode === 'focus'"
        aria-label="切换到专注模式"
        :disabled="actionBusy || ['running', 'paused'].includes(local.status)"
        @click="switchMode('focus')"
      >
        <span class="mode-dot" aria-hidden="true" />
        <span>专注模式</span>
      </button>
      <button
        type="button"
        class="mode-segment"
        :class="{ 'mode-segment--active': local.mode === 'rest' }"
        :aria-pressed="local.mode === 'rest'"
        aria-label="切换到休息模式"
        :disabled="actionBusy || ['running', 'paused'].includes(local.status)"
        @click="switchMode('rest')"
      >
        <span class="mode-dot rest" aria-hidden="true" />
        <span>休息模式</span>
      </button>
    </section>

    <section v-if="lockedByRemote" class="remote-card surface-card" aria-live="polite">
      <p class="section-kicker">另一台设备正在计时</p>
      <h2>{{ timer.state.remote?.mode === 'focus' ? '专注模式' : '休息模式' }}</h2>
      <strong class="remote-clock">{{ formatDuration(remoteRemaining) }}</strong>
      <p>本机当前只读，不会自动覆盖另一台设备。</p>
      <button type="button" class="primary-button" :disabled="actionBusy" @click="perform(timer.takeOverRemote)">
        接管并继续
      </button>
    </section>

    <section class="timer-card surface-card" data-testid="timer-card" :aria-hidden="lockedByRemote || undefined">
      <div class="timer-top-row">
        <div class="timer-settings">
          <label for="focus-duration">计时长度</label>
          <span class="duration-field">
            <input
              id="focus-duration"
              v-model.number="durationMinutes"
              aria-label="计时分钟数"
              type="number"
              inputmode="numeric"
              min="1"
              max="240"
              :disabled="actionBusy || ['running', 'paused'].includes(local.status) || lockedByRemote"
              @change="applyDuration"
            >
            <span>分钟</span>
          </span>
        </div>
        <div class="timer-tool-buttons">
          <button
            type="button"
            class="round-tool-button"
            :class="{ active: noiseOpen || activeNoiseId }"
            aria-label="打开我的白噪音"
            :aria-expanded="noiseOpen"
            @click="noiseOpen = !noiseOpen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 18V6l9-2v11" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="15" cy="15" r="3" />
            </svg>
          </button>
          <button
            v-if="local.mode === 'rest'"
            type="button"
            class="breathing-open-button"
            aria-label="打开呼吸练习"
            :aria-expanded="breathingOpen"
            @click="breathingOpen = !breathingOpen"
          >
            呼吸练习
          </button>
        </div>
      </div>

      <section v-if="noiseOpen" class="noise-panel" aria-label="我的白噪音">
        <div class="noise-track-list">
          <button
            v-for="track in noiseTracks"
            :key="track.id"
            type="button"
            class="noise-track-button"
            :class="{ active: activeNoiseId === track.id }"
            :aria-pressed="activeNoiseId === track.id"
            :aria-label="`${activeNoiseId === track.id ? '暂停' : '播放'} ${track.name}`"
            @click="toggleNoise(track)"
          >
            <span class="noise-state" aria-hidden="true" />
            <span>{{ track.name }}</span>
          </button>
        </div>
        <div class="noise-control-row">
          <span>播放速率</span>
          <div class="noise-rate-group" aria-label="播放速率">
            <button
              v-for="rate in [1, 1.5, 2]"
              :key="rate"
              type="button"
              :class="{ active: noiseRate === rate }"
              :data-noise-rate="rate"
              @click="setNoiseRate(rate)"
            >
              {{ rate }}x
            </button>
          </div>
        </div>
        <div class="noise-control-row">
          <label for="noise-volume">白噪音音量</label>
          <input
            id="noise-volume"
            v-model.number="noiseVolume"
            aria-label="白噪音音量"
            type="range"
            min="0"
            max="100"
            @input="setNoiseVolume"
          >
          <button type="button" class="noise-mute-button" :aria-pressed="noiseMuted" @click="toggleNoiseMute">
            {{ noiseMuted ? '恢复' : '静音' }}
          </button>
        </div>
        <p class="noise-status" role="status">{{ noiseStatus || '内置木鱼白噪音和雨声白噪音，可离线播放。' }}</p>
      </section>

      <label v-if="local.mode === 'focus'" class="work-type-field" for="focus-work-type">
        工作类型
        <select
          id="focus-work-type"
          :value="local.workType"
          :disabled="actionBusy || local.status === 'running' || lockedByRemote"
          @change="timer.setWorkType(($event.target as HTMLSelectElement).value as 'core' | 'maintenance')"
        >
          <option value="core">核心工作</option>
          <option value="maintenance">维持工作</option>
        </select>
      </label>

      <section v-if="local.mode === 'rest' && breathingOpen" class="breathing-panel" aria-label="呼吸练习">
        <div class="breathing-options">
          <button
            type="button"
            :class="{ active: breathingKind === 'box' }"
            aria-label="开始 4-4-4-4 腹式呼吸"
            @click="startBreathing('box')"
          >
            <strong>4-4-4-4 腹式呼吸</strong>
            <span>桌面同款语音引导</span>
          </button>
          <button
            type="button"
            :class="{ active: breathingKind === 'wim' }"
            aria-label="开始 冰人呼吸法"
            @click="startBreathing('wim')"
          >
            <strong>冰人呼吸法</strong>
            <span>短时激活练习</span>
          </button>
        </div>
        <div
          class="breathing-stage"
          data-testid="breathing-stage"
          :class="{ active: breathingActive }"
        >
          <div class="breathing-circle" :style="{ transform: `scale(${breathingScale})` }">
            <span>{{ breathingLabel }}</span>
          </div>
          <p>{{ breathingCount }}</p>
          <button type="button" class="secondary-button" :disabled="!breathingActive" @click="stopBreathing">
            停止呼吸练习
          </button>
        </div>
      </section>

      <p class="timer-status">{{ statusLabel }}</p>
      <strong class="timer-clock" aria-live="off">{{ formatDuration(localRemaining) }}</strong>

      <div class="timer-actions">
        <button
          type="button"
          class="primary-button"
          aria-label="开始计时"
          :disabled="actionBusy || lockedByRemote || local.status === 'running'"
          @click="mainAction"
        >
          {{ mainActionLabel }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="actionBusy || lockedByRemote || local.status !== 'running'"
          @click="perform(() => timer.pause())"
        >
          暂停
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="actionBusy || lockedByRemote || (local.status === 'idle' && local.sessionStartAt === null)"
          @click="perform(timer.reset)"
        >
          重置
        </button>
      </div>

      <button
        v-if="local.mode === 'focus' && local.status === 'running'"
        type="button"
        class="distraction-button"
        :disabled="actionBusy"
        @click="perform(timer.startDistraction)"
      >
        记录一次干扰
      </button>
      <p v-if="timer.state.message" class="timer-message" role="status">{{ timer.state.message }}</p>
      <p v-if="actionError" class="timer-error" role="alert">{{ actionError }}</p>
    </section>

    <section v-if="local.distractionStartedAt !== null" class="distraction-sheet surface-card" aria-labelledby="distraction-title">
      <p class="section-kicker">专注已暂停</p>
      <h2 id="distraction-title">刚才是什么打断了你？</h2>
      <label for="distraction-text">干扰内容</label>
      <textarea id="distraction-text" v-model="distractionText" rows="3" placeholder="例如：想看手机消息" />
      <div class="distraction-options">
        <label for="distraction-control">是否可控</label>
        <select id="distraction-control" v-model="distractionControl">
          <option value="controllable">可控</option>
          <option value="uncontrollable">不可控</option>
        </select>
        <label for="distraction-interest">是否有意思</label>
        <select id="distraction-interest" v-model="distractionInterest">
          <option value="interesting">有意思</option>
          <option value="boring">没意思</option>
        </select>
      </div>
      <div class="timer-actions">
        <button type="button" class="primary-button" @click="finishDistraction(true)">记录并返回专注</button>
        <button type="button" class="secondary-button" @click="finishDistraction(false)">只记录，保持暂停</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.mode-switcher {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
  padding: 0.25rem;
}

.mode-segment {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: var(--text-muted);
  display: inline-flex;
  flex: 1 1 0;
  font-size: 0.9rem;
  font-weight: 780;
  gap: 0.35rem;
  justify-content: center;
  min-height: 2.4rem;
  padding: 0 0.5rem;
  white-space: nowrap;
}

.mode-segment--active {
  background: var(--accent-soft);
  color: var(--text-main);
}

.mode-segment:disabled { cursor: not-allowed; opacity: 0.62; }

.mode-dot {
  border: 2px solid currentColor;
  border-radius: 999px;
  height: 0.7rem;
  width: 0.7rem;
}

.timer-card { align-items: center; display: flex; flex-direction: column; gap: 0.72rem; text-align: center; }
.timer-top-row { align-items: center; display: flex; gap: 0.7rem; justify-content: space-between; width: 100%; }
.timer-settings { align-items: center; display: flex; gap: 0.6rem; justify-content: flex-start; text-align: left; }
.duration-field { align-items: center; display: flex; gap: 0.4rem; }
.duration-field input { border: 1px solid var(--border-soft); border-radius: 0.75rem; min-height: 2.5rem; padding: 0.45rem; text-align: right; width: 4.6rem; }
.timer-tool-buttons { align-items: center; display: flex; flex: 0 0 auto; gap: 0.45rem; }
.round-tool-button {
  align-items: center;
  background: var(--surface-soft);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--accent-strong);
  display: inline-flex;
  height: 2.65rem;
  justify-content: center;
  padding: 0;
  width: 2.65rem;
}
.round-tool-button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.round-tool-button svg { fill: none; height: 1.25rem; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; width: 1.25rem; }
.breathing-open-button {
  background: var(--surface-soft);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-main);
  font-size: 0.82rem;
  font-weight: 760;
  min-height: 2.65rem;
  padding: 0 0.75rem;
}
.work-type-field { align-items: center; align-self: stretch; display: flex; justify-content: space-between; text-align: left; }
.work-type-field select, .distraction-options select { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 0.75rem; min-height: 2.75rem; padding: 0.5rem; }
.timer-status { color: var(--text-muted); margin: 0.35rem 0 0; }
.timer-clock, .remote-clock { font-size: clamp(3.35rem, 17vw, 5.2rem); font-variant-numeric: tabular-nums; letter-spacing: 0; line-height: 1; }
.timer-actions { display: flex; flex-wrap: wrap; gap: 0.65rem; justify-content: center; width: 100%; }
.timer-actions button, .primary-button, .secondary-button, .distraction-button { border-radius: 999px; min-height: 2.75rem; padding: 0.65rem 1rem; }
.primary-button { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
.secondary-button, .distraction-button { background: var(--surface); border: 1px solid var(--border-soft); color: var(--text-main); }
.distraction-button { margin-top: 0.25rem; width: 100%; }
.noise-panel,
.breathing-panel {
  align-self: stretch;
  background: var(--surface-soft);
  border: 1px solid var(--border-soft);
  border-radius: 1rem;
  display: grid;
  gap: 0.65rem;
  padding: 0.75rem;
  text-align: left;
}
.noise-track-list,
.breathing-options {
  display: grid;
  gap: 0.45rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.noise-track-button,
.breathing-options button,
.noise-rate-group button {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 0.8rem;
  color: var(--text-main);
  font-weight: 720;
  min-height: 2.55rem;
}
.noise-track-button {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  justify-content: flex-start;
  padding: 0 0.75rem;
}
.noise-track-button.active,
.breathing-options button.active,
.noise-rate-group button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.noise-state {
  border: 2px solid currentColor;
  border-radius: 999px;
  height: 0.72rem;
  width: 0.72rem;
}
.noise-control-row {
  align-items: center;
  display: grid;
  gap: 0.55rem;
  grid-template-columns: auto 1fr auto;
}
.noise-rate-group { display: flex; gap: 0.35rem; justify-content: flex-end; }
.noise-rate-group button { min-height: 2rem; min-width: 3rem; padding: 0 0.5rem; }
.noise-control-row input[type="range"] { accent-color: var(--accent); min-width: 0; }
.noise-mute-button {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  min-height: 2.1rem;
  padding: 0 0.75rem;
}
.noise-status {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.45;
  margin: 0;
}
.breathing-options button {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.65rem;
}
.breathing-options span {
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.35;
}
.breathing-options button.active span { color: rgb(255 255 255 / 84%); }
.breathing-stage {
  align-items: center;
  display: grid;
  gap: 0.45rem;
  justify-items: center;
  padding-top: 0.25rem;
  text-align: center;
}
.breathing-circle {
  align-items: center;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, white);
  border-radius: 999px;
  color: var(--text-main);
  display: flex;
  font-size: 0.82rem;
  font-weight: 780;
  height: 5.2rem;
  justify-content: center;
  line-height: 1.25;
  padding: 0.6rem;
  transition: transform 500ms ease;
  width: 5.2rem;
}
.breathing-stage p {
  color: var(--text-muted);
  font-size: 0.76rem;
  margin: 0;
}
.timer-message { color: #8a5a12; margin: 0; }
.timer-error { color: #b42318; margin: 0; }
.remote-card { border-color: color-mix(in srgb, #d58b1d 45%, var(--border-soft)); margin-bottom: 0.9rem; text-align: center; }
.remote-card h2, .remote-card p { margin: 0.35rem 0; }
.section-kicker { color: var(--accent); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.distraction-sheet { margin-top: 0.9rem; }
.distraction-sheet h2 { margin: 0 0 1rem; }
.distraction-sheet label { display: block; font-weight: 650; margin-bottom: 0.4rem; }
.distraction-sheet textarea { border: 1px solid var(--border-soft); border-radius: 0.85rem; min-height: 5.5rem; padding: 0.75rem; resize: vertical; width: 100%; }
.distraction-options { display: grid; gap: 0.45rem; grid-template-columns: 1fr 1fr; margin: 0.85rem 0; }

button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
button:disabled { cursor: not-allowed; opacity: 0.5; }
@media (max-width: 380px) {
  .screen-heading { margin-bottom: 0.85rem; }
  .noise-track-list,
  .breathing-options { grid-template-columns: 1fr; }
  .timer-top-row { align-items: stretch; flex-direction: column; }
  .timer-tool-buttons { justify-content: flex-end; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
