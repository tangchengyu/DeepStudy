<script setup lang="ts">
import { onMounted, ref } from 'vue'

defineProps<{
  code: string
  reason: 'new-account' | 'rotated'
}>()

const emit = defineEmits<{ confirmed: [] }>()
const saved = ref(false)
const copied = ref(false)
const copyButton = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

onMounted(() => {
  copyButton.value?.focus()
})

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [href]',
  )].filter((element) => element.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section ref="panel" class="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="recovery-title" @keydown="trapFocus">
    <div class="recovery-panel__icon" aria-hidden="true">✓</div>
    <h2 id="recovery-title">{{ reason === 'new-account' ? '账号创建成功' : '密码已恢复' }}</h2>
    <p>这是唯一一次显示恢复码。请保存到可靠的密码管理器；丢失后我们无法替你找回。</p>
    <button ref="copyButton" class="recovery-code" type="button" @click="copyCode(code)">
      <strong>{{ code }}</strong>
      <span>{{ copied ? '已复制' : '点按复制' }}</span>
    </button>
    <label class="saved-check">
      <input v-model="saved" type="checkbox">
      <span>我已将恢复码保存到安全的位置</span>
    </label>
    <button
      class="primary-action"
      data-testid="confirm-recovery-code"
      type="button"
      :disabled="!saved"
      @click="emit('confirmed')"
    >
      确认并继续
    </button>
  </section>
</template>

<style scoped>
.recovery-panel {
  background: var(--surface);
  border-radius: 1.55rem;
  box-shadow: 0 1.2rem 3rem rgb(31 38 63 / 20%);
  margin: auto;
  max-width: 29rem;
  padding: 1.4rem;
  width: calc(100vw - 2rem);
}

.recovery-panel__icon {
  align-items: center;
  background: #e9f9ef;
  border-radius: 999px;
  color: #138a47;
  display: flex;
  font-weight: 800;
  height: 3rem;
  justify-content: center;
  width: 3rem;
}

h2 {
  font-size: 1.35rem;
  margin: 1rem 0 0.45rem;
}

p {
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.6;
  margin: 0;
}

.recovery-code {
  align-items: center;
  background: #f1efff;
  border: 1px solid #dcd7ff;
  border-radius: 1rem;
  color: var(--accent-strong);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 1.15rem 0;
  min-height: 5rem;
  padding: 0.75rem;
  width: 100%;
}

.recovery-code strong {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: clamp(1rem, 5.5vw, 1.3rem);
  letter-spacing: 0.06em;
}

.recovery-code span {
  font-size: 0.75rem;
}

.saved-check {
  align-items: flex-start;
  display: flex;
  font-size: 0.88rem;
  gap: 0.65rem;
  line-height: 1.45;
}

.saved-check input {
  height: 1.2rem;
  margin: 0.05rem 0 0;
  width: 1.2rem;
}

.primary-action {
  background: var(--accent);
  border: 0;
  border-radius: 0.9rem;
  color: #fff;
  font-weight: 700;
  margin-top: 1rem;
  min-height: 3.25rem;
  width: 100%;
}

.primary-action:disabled {
  opacity: 0.42;
}
</style>
