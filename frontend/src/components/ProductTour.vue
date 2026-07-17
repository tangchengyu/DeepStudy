<template>
  <Teleport to="body">
    <div v-if="active" class="tutorial-layer">
      <div ref="topScrim" class="tutorial-scrim"></div>
      <div ref="leftScrim" class="tutorial-scrim"></div>
      <div ref="rightScrim" class="tutorial-scrim"></div>
      <div ref="bottomScrim" class="tutorial-scrim"></div>
      <div ref="blocker" class="tutorial-target-blocker" aria-hidden="true"></div>
      <div ref="ring" class="tutorial-focus-ring" aria-hidden="true"></div>
      <section
        ref="card"
        class="tutorial-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-description"
      >
        <div class="tutorial-progress-track">
          <div class="tutorial-progress" :style="{ width: `${((index + 1) / steps.length) * 100}%` }"></div>
        </div>
        <div class="tutorial-card-body">
          <div class="tutorial-card-header">
            <div>
              <div class="tutorial-kicker">使用教程</div>
              <h2 id="tutorial-title" class="tutorial-title">{{ currentStep.title }}</h2>
            </div>
            <button class="tutorial-close" type="button" aria-label="退出使用教程" @click="finish">×</button>
          </div>
          <p id="tutorial-description" class="tutorial-description" v-html="currentStep.description"></p>
          <div class="tutorial-footer">
            <span class="tutorial-count">{{ index + 1 }} / {{ steps.length }}</span>
            <div class="tutorial-actions">
              <button v-if="index < steps.length - 1" class="tutorial-action" type="button" @click="finish">跳过教程</button>
              <button class="tutorial-action" type="button" :disabled="index === 0" @click="previous">上一步</button>
              <button ref="nextButton" class="tutorial-action primary" type="button" @click="next">
                {{ index === steps.length - 1 ? '完成' : '下一步' }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useRuntimeStore } from '@/stores/runtime'

const SEEN_KEY = 'deepstudy.tutorial.seen.v1'
const runtime = useRuntimeStore()
const route = useRoute()

const steps = [
  { target: '#top-bar', title: '欢迎来到 DeepStudy', description: '这是一段可随时退出的交互式教程。我们会依次认识计划、专注、恢复和复盘工具；教程不会替你修改任务，也不会启动计时。', view: 'gate' },
  { target: '#daily-plan-sidebar', title: '先把今天变得清晰', description: '在每日计划中输入任务并按回车添加，勾选即可完成。优先任务、重置和清除已完成操作都集中在这里。', view: 'gate' },
  { target: '#chat-toggle', title: '让 AI 帮你拆解计划', description: '打开 AI 对话后，可以描述今天的目标，由计划助手整理成可执行任务；右上角设置按钮用于配置你自己的 API。', view: 'gate' },
  { target: '#noise-control', title: '用稳定声音保护注意力', description: '“我的白噪音”提供内置音轨、音量和倍速控制，也支持拖入本地音频。它适合掩蔽突发环境噪声。', view: 'gate' },
  { target: '#open-stopwatch', title: '独立秒表与倒计时', description: '秒表适合开放式投入，倒计时适合有明确边界的任务。两者会在独立小窗口中打开，不打断主界面。', view: 'gate' },
  { target: '#long-tasks-open', title: '管理长期任务', description: '长期任务使用重要/紧急四象限整理目标，并可把下一步拖入今日计划，适合承接跨天项目。', view: 'gate' },
  { target: '#soul-open', title: '维护你的灵魂按摩间', description: '这里保存能让你恢复方向感的句子。入口页会随机展示你的收藏，也可以启用内置好句库。', view: 'gate' },
  { target: '#focus-quote-screen', title: '进入前，先清理注意力残留', description: '点击好句卡片可随机刷新一句话。真正开始前，建议闭眼静心几分钟，让上一件事从工作记忆中退出。', view: 'gate' },
  { target: '#enter-gate', title: '进入注意力空间', description: '准备好后点击这里进入工作区。教程下一步会先带你预览内部功能，预览结束后仍会回到这个入口。', view: 'gate' },
  { target: '.mode-tabs', title: '三种状态，职责分明', description: '专注模式负责单任务投入，休息模式负责恢复，长期习惯构建用于时间审计与复盘。你可以随时切换。', view: 'focus' },
  { target: '.focus-mode .section-header', title: '设定边界，再开始专注', description: '在专注模式中设置时长、区分核心或维持性工作，然后开始、暂停或重置本次专注。计时记录会进入复盘数据。', view: 'focus' },
  { target: '#quick-distraction', title: '捕捉干扰，不跟着它走', description: '分心出现时点击“快速添加干扰”，或直接按 <kbd>Ctrl</kbd> + <kbd>D</kbd>。先记下来，再把注意力带回当前任务。', view: 'focus' },
  { target: '.breathing-card', title: '休息不是继续接收信息', description: '休息模式包含计时、呼吸练习与本地音频提示。让身体动起来或跟随呼吸节奏，比继续刷信息更有助于恢复。', view: 'rest' },
  { target: '.habit-mode', title: '用记录建立长期反馈', description: '在长期习惯构建中查看时间审计、专注记录与每日反思，观察核心工作占比，并据此调整下一天。', view: 'habit' },
  { target: '#back-to-gate', title: '教程完成', description: '“返回”会带你回到注意力空间入口。以后只要尚未进入工作区，点击顶栏的“使用教程”就能重新查看本教程。', view: 'focus' }
]

const active = ref(false)
const index = ref(0)
const card = ref(null)
const ring = ref(null)
const blocker = ref(null)
const topScrim = ref(null)
const leftScrim = ref(null)
const rightScrim = ref(null)
const bottomScrim = ref(null)
const nextButton = ref(null)
const currentStep = computed(() => steps[index.value])
let target = null
let previousFocus = null
let renderToken = 0

function applyView(view) {
  if (view === 'gate') {
    runtime.enterGate()
    runtime.setMode('focus')
  } else {
    runtime.exitGate()
    runtime.setMode(view)
  }
}

function setBox(element, { top, left, width, height }) {
  if (!element) return
  element.style.top = `${Math.max(0, top)}px`
  element.style.left = `${Math.max(0, left)}px`
  element.style.width = `${Math.max(0, width)}px`
  element.style.height = `${Math.max(0, height)}px`
}

function positionCard(rect) {
  if (!card.value) return
  const margin = 14
  const cardRect = card.value.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  let left
  let top

  if (viewportWidth - rect.right >= cardRect.width + margin * 2) {
    left = rect.right + margin
    top = rect.top
  } else if (rect.left >= cardRect.width + margin * 2) {
    left = rect.left - cardRect.width - margin
    top = rect.top
  } else if (viewportHeight - rect.bottom >= cardRect.height + margin * 2) {
    left = rect.left
    top = rect.bottom + margin
  } else {
    left = rect.left
    top = rect.top - cardRect.height - margin
  }

  left = Math.min(Math.max(margin, left), viewportWidth - cardRect.width - margin)
  top = Math.min(Math.max(margin, top), viewportHeight - cardRect.height - margin)
  card.value.style.left = `${left}px`
  card.value.style.top = `${top}px`
}

function positionOverlay() {
  if (!active.value || !target) return
  const gap = 7
  const raw = target.getBoundingClientRect()
  const rect = {
    top: Math.max(6, raw.top - gap),
    left: Math.max(6, raw.left - gap),
    right: Math.min(window.innerWidth - 6, raw.right + gap),
    bottom: Math.min(window.innerHeight - 6, raw.bottom + gap)
  }
  rect.width = rect.right - rect.left
  rect.height = rect.bottom - rect.top
  setBox(topScrim.value, { top: 0, left: 0, width: window.innerWidth, height: rect.top })
  setBox(leftScrim.value, { top: rect.top, left: 0, width: rect.left, height: rect.height })
  setBox(rightScrim.value, { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.height })
  setBox(bottomScrim.value, { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom })
  setBox(ring.value, rect)
  setBox(blocker.value, rect)
  positionCard(rect)
}

async function renderStep() {
  const token = ++renderToken
  applyView(currentStep.value.view)
  await nextTick()
  target = document.querySelector(currentStep.value.target)
  if (!target) {
    if (index.value < steps.length - 1) {
      index.value += 1
      renderStep()
    } else {
      finish()
    }
    return
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!active.value || token !== renderToken) return
    positionOverlay()
    nextButton.value?.focus({ preventScroll: true })
  }))
}

async function start() {
  if (active.value || route.path !== '/') return
  previousFocus = document.activeElement
  index.value = 0
  active.value = true
  await nextTick()
  renderStep()
}

function finish() {
  if (!active.value) return
  active.value = false
  localStorage.setItem(SEEN_KEY, 'true')
  target = null
  runtime.enterGate()
  runtime.setMode('focus')
  const focusTarget = previousFocus?.isConnected ? previousFocus : document.querySelector('#tutorial-open')
  nextTick(() => focusTarget?.focus({ preventScroll: true }))
}

function next() {
  if (index.value >= steps.length - 1) return finish()
  index.value += 1
  renderStep()
}

function previous() {
  if (index.value === 0) return
  index.value -= 1
  renderStep()
}

function onKeydown(event) {
  if (!active.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    finish()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    previous()
  } else if (event.key === 'Tab' && card.value) {
    const focusable = Array.from(card.value.querySelectorAll('button:not([disabled])'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}

onMounted(() => {
  window.addEventListener('resize', positionOverlay)
  window.addEventListener('scroll', positionOverlay, true)
  document.addEventListener('keydown', onKeydown, true)
  if (route.path === '/' && localStorage.getItem(SEEN_KEY) !== 'true') {
    window.setTimeout(start, 550)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', positionOverlay)
  window.removeEventListener('scroll', positionOverlay, true)
  document.removeEventListener('keydown', onKeydown, true)
})

defineExpose({ start })
</script>

<style src="../assets/styles/tutorial.css"></style>
