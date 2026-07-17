<template>
  <div id="top-bar" class="top-bar">
    <div class="brand">
      <span class="brand-dot"></span>
      <strong>deepstudy</strong>
    </div>

    <div class="top-controls">
      <!-- 工具栏按钮 -->
      <button v-if="runtime.showGate" id="tutorial-open" class="tool-btn tutorial-launch" type="button" @click="emit('start-tutorial')">
        使用教程
      </button>
      <button v-if="runtime.showGate" id="soul-open" class="tool-btn soul-btn" type="button" @click="openSoul">
        灵魂按摩间
      </button>

      <!-- 白噪音控制 -->
      <div id="noise-control" class="noise-control" @click="toggleNoiseMenu">
        <button id="noise-menu-button" class="audio-btn" type="button" :class="{ active: noiseMenuOpen || activeTrackId }" title="【稳定背景声可通过掩蔽突发环境噪音，减少外界刺激对注意力的捕获。】">
          我的白噪音
        </button>
        <div v-show="noiseMenuOpen || activeTrackId" class="noise-popover">
          <div id="noise-list" class="noise-list">
            <!-- White noise items will be rendered by child component -->
            <slot name="noise-list"></slot>
          </div>
          <button id="noise-custom-toggle" class="secondary-btn compact" type="button" @click="toggleNoiseCustom">
            自定义白噪音
          </button>
          <div v-show="noiseCustomOpen" class="noise-custom-panel">
            <div id="noise-dropzone" class="noise-dropzone" @click="openFilePicker" @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
              拖入音频文件
              <small>MP3 / WAV / OGG / FLAC / M4A</small>
            </div>
            <input id="noise-file-input" type="file" accept="audio/*" ref="fileInput" @change="onFileSelect" style="display: none;" />
            <div class="noise-custom-actions">
              <button id="noise-pick-file" class="secondary-btn compact" type="button" @click="openFilePicker">选择文件</button>
              <button id="noise-add-file" class="primary-btn compact" type="button" :disabled="!selectedFile" @click="addNoiseFile">添加</button>
            </div>
            <div id="noise-status" class="subtle"></div>
          </div>
        </div>
      </div>

      <!-- 播放速率 -->
      <div class="segmented" aria-label="播放速率">
        <button class="audio-rate active" data-rate="1" type="button" @click="setRate(1)">1x</button>
        <button class="audio-rate" data-rate="1.5" type="button" @click="setRate(1.5)">1.5x</button>
        <button class="audio-rate" data-rate="2" type="button" @click="setRate(2)">2x</button>
      </div>

      <!-- 音量控制 -->
      <div class="volume-control">
        <button id="volume-button" class="tool-btn" type="button" @click="toggleMute" :aria-label="audioStore.volume === 0 ? '恢复白噪音音量' : '静音白噪音'">
          {{ audioStore.volume === 0 ? '🔇' : audioStore.volume < 0.5 ? '🔉' : '🔊' }}
        </button>
        <div v-show="volumePopoverOpen" class="volume-popover">
          <label for="noise-volume">白噪音音量 <span id="volume-value">{{ Math.round(audioStore.volume * 100) }}%</span></label>
          <input id="noise-volume" type="range" min="0" max="100" :value="Math.round(audioStore.volume * 100)" @input="setVolume" />
        </div>
      </div>

      <!-- 计时器按钮 -->
      <button id="open-stopwatch" class="tool-btn" type="button" @click="openTimer('stopwatch')">
        ⏱ 秒表
      </button>
      <button id="open-countdown" class="tool-btn" type="button" @click="openTimer('countdown')">
        ⏲ 倒计时
      </button>

      <!-- 长期任务 -->
      <button id="long-tasks-open" class="tool-btn long-task-launch" type="button" @click="openLongTasks" title="【基于艾森豪威尔优先级管理理论，结合认知负荷理论与行为科学，通过区分任务的重要性和紧急性，帮助减少决策疲劳，提升长期目标投入。】">
        <span class="long-task-launch-mark" aria-hidden="true"></span>
        长期任务
      </button>

      <!-- 模式切换收起按钮 -->
      <button id="collapse-tabs" class="collapse-btn" type="button" :title="tabCollapsed ? '展开' : '收起'" @click="toggleCollapse">{{ tabCollapsed ? '▸' : '▾' }}</button>

      <!-- 窗口置顶 -->
      <label class="aot-label">
        <input id="always-on-top" type="checkbox" :checked="alwaysOnTop" @change="toggleAlwaysOnTop" />
        窗口置顶
      </label>
      <label class="aot-label">
        <input id="auto-minimize" type="checkbox" :checked="minimized" @click="onAutoMinimize" /> 卡片界面
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue'
import { useRuntimeStore } from '@/stores/runtime'
import { useAudioStore } from '@/stores/audio'
import { useElectron } from '@/composables/useElectron'

const runtime = useRuntimeStore()
const audioStore = useAudioStore()
const electron = useElectron()
const emit = defineEmits(['open-soul', 'minimize-changed', 'start-tutorial'])

// 卡片界面折叠状态
const tabCollapsed = inject('tabCollapsed', ref(false))
function toggleCollapse() {
  tabCollapsed.value = !tabCollapsed.value
}

// State
const noiseMenuOpen = ref(false)
const noiseCustomOpen = ref(false)
const volumePopoverOpen = ref(false)
const selectedFile = ref(null)
const alwaysOnTop = ref(false)
const minimized = ref(false)
const activeTrackId = ref('') // 当前播放的音轨ID

// Methods
function openSoul() {
  emit('open-soul')
}

function toggleNoiseMenu() {
  noiseMenuOpen.value = !noiseMenuOpen.value
  if (!noiseMenuOpen.value) noiseCustomOpen.value = false
}

function toggleNoiseCustom() {
  noiseCustomOpen.value = !noiseCustomOpen.value
  if (noiseCustomOpen.value) noiseMenuOpen.value = true
}

function openFilePicker() {
  document.getElementById('noise-file-input').click()
}

function onDragOver(e) {
  e.preventDefault()
  // Visual feedback can be added here
}

function onDragLeave() {
  // Remove visual feedback
}

function onDrop(e) {
  e.preventDefault()
  if (e.dataTransfer.files.length) {
    const file = e.dataTransfer.files[0]
    if (file.type.startsWith('audio/')) {
      selectedFile.value = file
    }
  }
}

function onFileSelect(e) {
  if (e.target.files.length) {
    selectedFile.value = e.target.files[0]
  }
}

async function addNoiseFile() {
  if (!selectedFile.value) return
  try {
    const buffer = await selectedFile.value.arrayBuffer()
    const formData = new FormData()
    formData.append('file', new Blob([buffer]), selectedFile.value.name)
    await audioStore.uploadCustomNoise(formData)
    selectedFile.value = null
    // TODO: 刷新音轨列表
  } catch (e) {
    console.error('Failed to add noise file:', e)
  }
}

function setRate(rate) {
  // 设置所有音频的播放速率
  audioStore.setPlaybackRate(rate)
}

function toggleVolumePopover() {
  volumePopoverOpen.value = !volumePopoverOpen.value
}

function toggleMute() {
  audioStore.mute()
}

function setVolume(e) {
  const vol = parseInt(e.target.value) / 100
  audioStore.setVolume(vol)
}

function openTimer(mode) {
  // TODO: 打开计时器窗口
  console.log('Open timer:', mode)
}

function openLongTasks() {
  // TODO: 打开长期任务窗口
  console.log('Open long tasks')
}

function toggleAlwaysOnTop() {
  // TODO: 通过Electron设置窗口置顶
  electron.toggleAlwaysOnTop().then((enabled) => {
    alwaysOnTop.value = enabled
  })
}

function autoMinimize() {
  electron.autoMinimize()
}

function onAutoMinimize(e) {
  const target = e.target
  // 使用 click 事件代替 change，避免程序化设置 checked 时的冲突
  if (target.checked) {
    minimized.value = true
    emit('minimize-changed', true)
    electron.autoMinimize()
  } else {
    // 取消勾选 = 恢复窗口大小
    minimized.value = false
    emit('minimize-changed', false)
    electron.autoRestore()
  }
}

function onMinimizedChanged(minimizedState) {
  minimized.value = minimizedState
  emit('minimize-changed', minimizedState)
}

// Watchers
watch(() => audioStore.volume, (vol) => {
  volumePopoverOpen.value = false // Hide popover when volume changes from slider
})

// Initialize
onMounted(() => {
  const bridge = typeof window !== 'undefined'
    ? (window.deepstudyShell || window.electronAPI || null)
    : null
  if (bridge?.onMinimizedChanged) {
    bridge.onMinimizedChanged(onMinimizedChanged)
  }
  electron.getAlwaysOnTop().then((enabled) => {
    alwaysOnTop.value = enabled
  })
  audioStore.loadNoiseTracks()
})
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  align-content: center;
  gap: 8px 18px;
  min-height: 58px;
  padding: 8px 16px;
  background: rgba(255, 253, 249, 0.94);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 8px rgba(57, 78, 67, 0.035);
  backdrop-filter: blur(10px);
  white-space: normal;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}

.brand-dot {
  width: 13px;
  height: 13px;
  border: 3px solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.top-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

/* Button styles (inherited from global CSS) */
.audio-btn, .tool-btn, .segmented button, .icon-btn, .ghost-btn, .duration-btn, .secondary-btn, .breathing-btn, .preset-row button {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 600;
  transition: all var(--transition);
}

/* Active states */
.audio-btn:hover, .tool-btn:hover, .audio-btn.active {
  border-color: var(--accent);
  color: var(--accent-hover);
  background: var(--accent-soft);
}

.audio-btn.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

/* Segmented control */
.segmented {
  display: flex;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.segmented button {
  height: 27px;
  min-width: 36px;
  border: 0;
  background: transparent;
  font-size: 12px;
}

.segmented button.active {
  background: var(--accent);
  color: white;
}

/* Icon button */
.icon-btn {
  height: 34px;
  padding: 0 10px;
}

.icon-btn.compact {
  width: 34px;
  padding: 0;
}

.icon-btn:hover, .icon-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

/* Volume control */
.volume-control {
  position: relative;
}

.volume-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  width: 190px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
  opacity: 0;
  visibility: hidden;
  transform: translate(-50%, -5px);
  transition: all var(--transition);
}

.volume-control:hover .volume-popover,
.volume-control:focus-within .volume-popover {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
}

.volume-popover label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.volume-popover input {
  width: 100%;
  accent-color: var(--accent);
}

/* Noise popover */
.noise-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: 260px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}

/* 卡片界面模式下白噪音浮窗适配窗口宽度 */
.is-minimized .noise-popover {
  position: fixed;
  right: 8px;
  top: 54px;
  width: calc(100vw - 16px);
  max-width: 260px;
}

.noise-list {
  display: grid;
  gap: 7px;
  margin-bottom: 9px;
}

.noise-track {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
}

.noise-track-play {
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.noise-track-play.active {
  color: white;
  border-color: var(--accent);
  background: var(--accent);
}

.noise-remove {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim);
}

.noise-remove:hover {
  background: #fff0f0;
  color: var(--red-hover);
}

.noise-custom-panel {
  display: grid;
  gap: 9px;
  margin-top: 10px;
}

.noise-dropzone {
  display: grid;
  place-items: center;
  min-height: 78px;
  padding: 12px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.noise-dropzone small {
  margin-top: 4px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
}

.noise-dropzone.drag-over {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.noise-custom-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Long task launch button */
.long-task-launch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 118px;
  padding-inline: 13px;
  border-color: rgba(112, 173, 153, 0.4);
  background: linear-gradient(180deg, var(--surface), #f4f8f2);
  color: #527d6d;
  box-shadow: 0 2px 8px rgba(57, 78, 67, 0.045);
}

.long-task-launch:hover,
.long-task-launch:focus-visible {
  border-color: var(--accent);
  background: linear-gradient(180deg, var(--surface), #edf5ee);
  color: var(--accent-hover);
  box-shadow: 0 3px 10px rgba(72, 111, 93, 0.07);
}

.long-task-launch-mark {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow:
    0 0 0 3px rgba(91, 184, 160, 0.18),
    11px 0 0 rgba(240, 192, 96, 0.78);
}

/* AOT label */
.aot-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 13px;
}

.aot-label input {
  accent-color: var(--accent);
}

/* Collapse button in top bar */
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.collapse-btn:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
  background: var(--accent-soft);
}
.collapse-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
