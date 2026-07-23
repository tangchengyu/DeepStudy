<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { mobileFocusTimerService } from '../services/appServices'
import type { TimerMode } from '../services/focusTimerService'
import { focusTimerServiceKey } from '../services/focusTimerServiceContext'

const timer = inject(focusTimerServiceKey, mobileFocusTimerService)
const durationMinutes = ref(timer.state.local.plannedMs / 60_000)
const distractionText = ref('')
const distractionControl = ref<'controllable' | 'uncontrollable'>('controllable')
const distractionInterest = ref<'interesting' | 'boring'>('interesting')
const actionError = ref('')
const actionBusy = ref(false)
const displayNow = ref(Date.now())
let displayInterval: ReturnType<typeof setInterval> | null = null
let lastRemoteRefreshAt = 0

const local = computed(() => timer.state.local)
const lockedByRemote = computed(() => timer.state.ownershipConflict && Boolean(timer.state.remote))
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
    if (await timer.setMode(mode)) durationMinutes.value = timer.state.local.plannedMs / 60_000
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
})
</script>

<template>
  <main class="page focus-page">
    <header class="screen-heading">
      <h1>专注</h1>
      <p>计时先保存在手机上；登录后会在开始或恢复前核对设备所有权。</p>
    </header>

    <section class="mode-switcher" aria-label="选择计时模式">
      <button
        type="button"
        class="mode-card"
        :class="{ 'mode-card--active': local.mode === 'focus' }"
        :aria-pressed="local.mode === 'focus'"
        aria-label="切换到专注模式"
        :disabled="actionBusy || ['running', 'paused'].includes(local.status)"
        @click="switchMode('focus')"
      >
        <span class="mode-icon" aria-hidden="true">◎</span>
        <strong>专注模式</strong>
        <small>记录核心工作或维持工作</small>
      </button>
      <button
        type="button"
        class="mode-card"
        :class="{ 'mode-card--active': local.mode === 'rest' }"
        :aria-pressed="local.mode === 'rest'"
        aria-label="切换到休息模式"
        :disabled="actionBusy || ['running', 'paused'].includes(local.status)"
        @click="switchMode('rest')"
      >
        <svg class="mode-icon" aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 8h10v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8z" />
          <path d="M15 10h2.5a2.5 2.5 0 0 1 0 5H15" />
          <path d="M6 20h12" />
          <path d="M8 4v1M12 3v2M16 4v1" />
        </svg>
        <strong>休息模式</strong>
        <small>把主动休息计入时间审计</small>
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

    <section class="timer-card surface-card" :aria-hidden="lockedByRemote || undefined">
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
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 0.9rem;
}

.mode-card {
  align-items: start;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.2rem;
  color: var(--text-main);
  display: flex;
  flex-direction: column;
  min-height: 8.6rem;
  padding: 1rem;
  text-align: left;
}

.mode-card--active {
  border-color: color-mix(in srgb, var(--accent) 55%, white);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
}

.mode-card:disabled { cursor: not-allowed; opacity: 0.62; }
.mode-icon { color: var(--accent); fill: none; font-size: 1.65rem; height: 1.65rem; line-height: 1; margin-bottom: 0.8rem; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; width: 1.65rem; }
.mode-card small { color: var(--text-muted); line-height: 1.4; margin-top: 0.35rem; }

.timer-card { align-items: center; display: flex; flex-direction: column; gap: 0.85rem; text-align: center; }
.timer-settings { align-items: center; align-self: stretch; display: flex; justify-content: space-between; text-align: left; }
.duration-field { align-items: center; display: flex; gap: 0.4rem; }
.duration-field input { border: 1px solid var(--border-soft); border-radius: 0.75rem; min-height: 2.75rem; padding: 0.55rem; text-align: right; width: 5rem; }
.work-type-field { align-items: center; align-self: stretch; display: flex; justify-content: space-between; text-align: left; }
.work-type-field select, .distraction-options select { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 0.75rem; min-height: 2.75rem; padding: 0.5rem; }
.timer-status { color: var(--text-muted); margin: 0.6rem 0 0; }
.timer-clock, .remote-clock { font-size: clamp(3.5rem, 18vw, 5.4rem); font-variant-numeric: tabular-nums; letter-spacing: -0.06em; }
.timer-actions { display: flex; flex-wrap: wrap; gap: 0.65rem; justify-content: center; width: 100%; }
.timer-actions button, .primary-button, .secondary-button, .distraction-button { border-radius: 999px; min-height: 2.75rem; padding: 0.65rem 1rem; }
.primary-button { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
.secondary-button, .distraction-button { background: var(--surface); border: 1px solid var(--border-soft); color: var(--text-main); }
.distraction-button { margin-top: 0.25rem; width: 100%; }
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
@media (max-width: 380px) { .mode-switcher { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
