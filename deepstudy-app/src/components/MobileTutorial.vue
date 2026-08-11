<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const stepIndex = ref(0)

const steps = [
  {
    route: '/today',
    title: '每日计划',
    body: '在这里添加今天要做的任务。任务先保存在手机本机，登录后再进入账号同步。',
  },
  {
    route: '/long',
    title: '长期四象限',
    body: '长期任务按重要性和紧急程度归类，适合管理暂时不一定今天完成、但需要持续推进的事。',
  },
  {
    route: '/focus',
    title: '专注与休息',
    body: '专注页现在与电脑软件一致：上方切换专注模式和休息模式，下方直接开始计时。',
  },
  {
    route: '/focus',
    title: '我的白噪音',
    body: '圆形音符按钮可以打开内置木鱼白噪音和雨声白噪音，支持离线播放、音量和倍速。',
  },
  {
    route: '/focus',
    title: '呼吸练习',
    body: '切到休息模式后，可以使用电脑软件同款的 4-4-4-4 腹式呼吸和冰人呼吸法。',
  },
  {
    route: '/mine',
    title: '账号同步',
    body: '登录后先做首次同步，之后日常只需要点立即同步；待上传、冲突和最后同步时间都在“我的”页查看。',
  },
]

const currentStep = computed(() => steps[stepIndex.value])
const isLastStep = computed(() => stepIndex.value === steps.length - 1)

function close() {
  emit('close')
}

function next() {
  if (isLastStep.value) {
    close()
    return
  }
  stepIndex.value += 1
}

function previous() {
  stepIndex.value = Math.max(0, stepIndex.value - 1)
}

watch(currentStep, (step) => {
  void router.push(step.route).catch(() => undefined)
}, { immediate: true })
</script>

<template>
  <div class="tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="mobile-tutorial-title">
    <section class="tutorial-card">
      <div class="tutorial-progress">
        <span :style="{ width: `${((stepIndex + 1) / steps.length) * 100}%` }" />
      </div>
      <div class="tutorial-heading">
        <p>使用教程</p>
        <button type="button" aria-label="关闭使用教程" @click="close">×</button>
      </div>
      <h2 id="mobile-tutorial-title">{{ currentStep.title }}</h2>
      <p class="tutorial-body">{{ currentStep.body }}</p>
      <div class="tutorial-footer">
        <span>{{ stepIndex + 1 }} / {{ steps.length }}</span>
        <div class="tutorial-actions">
          <button type="button" class="secondary-button" :disabled="stepIndex === 0" @click="previous">
            上一步
          </button>
          <button type="button" class="primary-button" @click="next">
            {{ isLastStep ? '完成' : '下一步' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tutorial-overlay {
  align-items: flex-end;
  background: rgb(18 25 42 / 42%);
  bottom: 0;
  display: flex;
  left: 0;
  padding: 1rem;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 80;
}

.tutorial-card {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  box-shadow: 0 1rem 2.5rem rgb(32 55 47 / 22%);
  color: var(--text-main);
  overflow: hidden;
  padding: 1rem;
  width: 100%;
}

.tutorial-progress {
  background: var(--surface-muted);
  border-radius: 999px;
  height: 0.35rem;
  overflow: hidden;
}

.tutorial-progress span {
  background: var(--accent);
  display: block;
  height: 100%;
  transition: width 180ms ease;
}

.tutorial-heading,
.tutorial-footer,
.tutorial-actions {
  align-items: center;
  display: flex;
}

.tutorial-heading {
  justify-content: space-between;
  margin-top: 0.9rem;
}

.tutorial-heading p {
  color: var(--accent-strong);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  margin: 0;
}

.tutorial-heading button {
  background: var(--surface-soft);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-main);
  height: 2.2rem;
  width: 2.2rem;
}

.tutorial-card h2 {
  font-size: 1.25rem;
  letter-spacing: 0;
  line-height: 1.25;
  margin: 0.55rem 0 0;
}

.tutorial-body {
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.65;
  margin: 0.65rem 0 1.1rem;
}

.tutorial-footer {
  justify-content: space-between;
}

.tutorial-footer > span {
  color: var(--text-muted);
  font-size: 0.82rem;
}

.tutorial-actions {
  gap: 0.5rem;
}

.tutorial-actions button {
  border-radius: 999px;
  min-height: 2.4rem;
  padding: 0 0.9rem;
}

.primary-button {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
  font-weight: 760;
}

.secondary-button {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  color: var(--text-main);
}

button:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

@media (min-width: 560px) {
  .tutorial-overlay {
    align-items: center;
    justify-content: center;
  }

  .tutorial-card {
    max-width: 28rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style>
