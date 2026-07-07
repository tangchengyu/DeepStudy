<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="modal-overlay"
        @click.self="handleOverlayClick"
        @keydown.escape="close"
      >
        <div class="modal-card">
          <div class="modal-alert">注意力正在离开球门</div>
          <h2>先停一下，觉察发生了什么</h2>
          <div id="modal-timer" class="modal-timer">{{ modalTimer }}</div>
          <p id="modal-help" class="modal-help">两分钟内处理或记下干扰，然后回到当前任务。</p>

          <ElInput
            id="modal-distraction-text"
            v-model="distractionText"
            maxlength="120"
            placeholder="这次干扰是什么？"
            @keydown.enter="handleEnter"
          />

          <div class="modal-selects">
            <ElSelect
              id="modal-control"
              v-model="controlValue"
              placeholder="可控性"
              class="modal-select"
            >
              <ElOption value="controllable" label="可控" />
              <ElOption value="uncontrollable" label="不可控" />
            </ElSelect>

            <ElSelect
              id="modal-interest"
              v-model="interestValue"
              placeholder="趣味性"
              class="modal-select"
            >
              <ElOption value="interesting" label="有意思" />
              <ElOption value="boring" label="没意思" />
            </ElSelect>
          </div>

          <div class="modal-actions">
            <ElButton
              id="modal-end"
              class="primary-btn"
              @click="handleEndDistraction"
            >
              结束分心
            </ElButton>
            <ElButton
              id="modal-continue"
              class="danger-btn"
              @click="handleContinue"
            >
              继续解决干扰
            </ElButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElButton, ElInput, ElSelect, ElOption } from 'element-plus'
import { useFocusStore } from '@/stores/focus'
import { formatClock } from '@/utils/format'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'confirm'])

// Store
const focusStore = useFocusStore()

// State
const openedAt = ref(0)
const deadline = ref(0)
const solving = ref(false)
const distractionText = ref('')
const controlValue = ref('controllable')
const interestValue = ref('interesting')

// Timer display
const modalTimer = computed(() => {
  if (solving.value) {
    const elapsed = Date.now() - openedAt.value
    return `+${formatClock(elapsed).slice(3)}`
  }

  return formatClock(Math.max(0, deadline.value - Date.now())).slice(3)
})

// Timer update
let timerInterval = null

function startTimer() {
  timerInterval = setInterval(() => {
    if (Date.now() >= deadline.value) {
      document.getElementById('modal-help').textContent =
        '两分钟已到。请选择回到专注，或明确继续解决。'
    }
  }, 200)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

// Lifecycle
onMounted(() => {
  if (props.visible) {
    openedAt.value = Date.now()
    deadline.value = openedAt.value + 120000 // 2 minutes
    startTimer()
  }
})

onBeforeUnmount(() => {
  stopTimer()
})

// Watch visible prop
watch(() => props.visible, (newVal) => {
  if (newVal) {
    openedAt.value = Date.now()
    deadline.value = openedAt.value + 120000
    solving.value = false
    distractionText.value = ''
    controlValue.value = 'controllable'
    interestValue.value = 'interesting'
    startTimer()
  } else {
    stopTimer()
  }
})

// Event handlers
function handleOverlayClick() {
  // Don't close if actively solving
  if (!solving.value) {
    close()
  }
}

function close() {
  emit('close')
}

function handleEnter(event) {
  if (event.key === 'Enter' && !solving.value) {
    handleEndDistraction()
  }
}

function handleContinue() {
  solving.value = true
}

async function handleEndDistraction() {
  const duration = Date.now() - openedAt.value
  const payload = {
    text: distractionText.value.trim(),
    control: controlValue.value,
    interest: interestValue.value,
    durationMs: duration,
    solving: solving.value
  }

  emit('confirm', payload)
  close()
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(44, 62, 56, 0.58);
  backdrop-filter: blur(5px);
  z-index: 50;
  isolation: isolate;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.modal-card {
  width: min(460px, 90vw);
  max-height: min(90vh, 540px);
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: 0 10px 40px rgba(44, 62, 56, 0.32);
  padding: 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-alert {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  padding: 4px 8px;
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
  text-align: center;
  align-self: center;
  min-width: 140px;
}

.modal-alert::first-letter {
  margin-right: 0.25em;
}

.modal-card h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  text-align: center;
}

.modal-timer {
  font-family: Consolas, 'Cascadia Code', monospace;
  font-size: 32px;
  font-weight: 700;
  color: var(--red);
  text-align: center;
  padding: 8px;
  background: var(--red-soft);
  border-radius: var(--radius);
}

.modal-help {
  margin: 0;
  text-align: center;
  font-size: 14px;
  color: var(--text-muted);
  font-weight: 500;
}

#modal-distraction-text {
  font-size: 14px;
  padding: 10px 12px;
  resize: none;
  min-height: 60px;
  line-height: 1.5;
}

.modal-selects {
  display: flex;
  gap: 12px;
}

.modal-select {
  flex: 1;
}

.modal-select .el-select__wrapper,
.modal-select .el-select__selected {
  background: var(--surface-2);
}

.modal-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 480px) {
  .modal-card {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    padding: 16px;
  }

  .modal-selects {
    flex-direction: column;
  }

  .modal-actions {
    flex-direction: column-reverse;
    gap: 8px;
  }

  .modal-actions .primary-btn,
  .modal-actions .danger-btn {
    width: 100%;
  }
}
</style>