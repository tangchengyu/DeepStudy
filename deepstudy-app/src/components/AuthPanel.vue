<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import TurnstileChallenge from './TurnstileChallenge.vue'

type Mode = 'sign-in' | 'register' | 'recover'

const props = defineProps<{
  siteKey: string
  minimumPasswordLength: number
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  'sign-in': [value: { username: string; password: string; turnstileToken: string }]
  register: [value: { username: string; password: string; turnstileToken: string }]
  recover: [value: {
    username: string
    recoveryCode: string
    newPassword: string
    turnstileToken: string
  }]
}>()

const mode = ref<Mode>('sign-in')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const recoveryCode = ref('')
const turnstileToken = ref('')
const challengeSequence = ref(0)
const localError = ref<string | null>(null)
const usernameInput = ref<HTMLInputElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const title = computed(() => ({
  'sign-in': '登录 DeepStudy',
  register: '创建账号',
  recover: '恢复密码',
})[mode.value])

watch(mode, () => {
  password.value = ''
  confirmPassword.value = ''
  recoveryCode.value = ''
  turnstileToken.value = ''
  localError.value = null
})

onMounted(() => {
  usernameInput.value?.focus()
})

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]',
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

function changeMode(next: Mode) {
  mode.value = next
}

function submit() {
  localError.value = null
  const normalizedUsername = username.value.trim()
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(normalizedUsername)) {
    localError.value = '用户名需为 3–30 位字母、数字、下划线或点号'
    return
  }
  if (password.value.length < props.minimumPasswordLength) {
    localError.value = `密码至少需要 ${props.minimumPasswordLength} 位`
    return
  }
  if (!turnstileToken.value) {
    localError.value = '请先完成人机验证'
    return
  }
  if (mode.value === 'register') {
    if (password.value !== confirmPassword.value) {
      localError.value = '两次输入的密码不一致'
      return
    }
    const token = turnstileToken.value
    turnstileToken.value = ''
    challengeSequence.value += 1
    emit('register', {
      username: normalizedUsername,
      password: password.value,
      turnstileToken: token,
    })
    return
  }
  if (mode.value === 'recover') {
    if (!recoveryCode.value.trim()) {
      localError.value = '请输入恢复码'
      return
    }
    const token = turnstileToken.value
    turnstileToken.value = ''
    challengeSequence.value += 1
    emit('recover', {
      username: normalizedUsername,
      recoveryCode: recoveryCode.value.trim(),
      newPassword: password.value,
      turnstileToken: token,
    })
    return
  }
  const token = turnstileToken.value
  turnstileToken.value = ''
  challengeSequence.value += 1
  emit('sign-in', {
    username: normalizedUsername,
    password: password.value,
    turnstileToken: token,
  })
}
</script>

<template>
  <section ref="panel" class="auth-sheet" role="dialog" aria-modal="true" aria-labelledby="auth-title" @keydown="trapFocus">
    <header class="auth-sheet__header">
      <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">×</button>
      <div>
        <h2 id="auth-title">{{ title }}</h2>
        <p>用同一账号连接手机和电脑上的任务</p>
      </div>
    </header>

    <nav class="mode-tabs" aria-label="账号操作">
      <button :class="{ active: mode === 'sign-in' }" type="button" @click="changeMode('sign-in')">登录</button>
      <button data-testid="mode-register" :class="{ active: mode === 'register' }" type="button" @click="changeMode('register')">注册</button>
      <button data-testid="mode-recover" :class="{ active: mode === 'recover' }" type="button" @click="changeMode('recover')">找回密码</button>
    </nav>

    <form @submit.prevent="submit">
      <label>
        <span>用户名</span>
        <input
          ref="usernameInput"
          v-model="username"
          autocomplete="username"
          autocapitalize="none"
          inputmode="text"
          maxlength="30"
          placeholder="3–30 位字母或数字"
          required
        >
      </label>
      <label v-if="mode === 'recover'">
        <span>一次性恢复码</span>
        <input
          v-model="recoveryCode"
          autocomplete="one-time-code"
          autocapitalize="characters"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          required
        >
      </label>
      <label>
        <span>{{ mode === 'recover' ? '新密码' : '密码' }}</span>
        <input
          v-model="password"
          :autocomplete="mode === 'sign-in' ? 'current-password' : 'new-password'"
          type="password"
          :minlength="minimumPasswordLength"
          placeholder="至少 10 位"
          required
        >
      </label>
      <label v-if="mode === 'register'">
        <span>再次输入密码</span>
        <input
          v-model="confirmPassword"
          autocomplete="new-password"
          type="password"
          :minlength="minimumPasswordLength"
          required
        >
      </label>

      <TurnstileChallenge
        :key="`${mode}-${challengeSequence}`"
        :site-key="siteKey"
        :action="mode"
        @token="turnstileToken = $event"
        @error="localError = $event"
      />
      <p v-if="localError || error" class="form-error" role="alert">{{ localError || error }}</p>
      <button class="submit-button" type="submit" :disabled="busy">
        {{ busy ? '请稍候…' : title }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.auth-sheet {
  background: var(--surface);
  border-radius: 1.55rem 1.55rem 0 0;
  box-shadow: 0 -1rem 3rem rgb(31 38 63 / 18%);
  margin: auto auto 0;
  max-height: calc(100dvh - env(safe-area-inset-top));
  max-width: 40rem;
  overflow-y: auto;
  padding: 1rem 1rem calc(1.2rem + env(safe-area-inset-bottom));
  width: 100%;
}

.auth-sheet__header {
  align-items: center;
  display: flex;
  gap: 0.8rem;
}

.auth-sheet__header h2,
.auth-sheet__header p {
  margin: 0;
}

.auth-sheet__header h2 {
  font-size: 1.35rem;
}

.auth-sheet__header p {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.2rem;
}

.icon-button {
  background: var(--surface-muted);
  border: 0;
  border-radius: 999px;
  color: var(--text-main);
  flex: 0 0 auto;
  font-size: 1.55rem;
  height: 2.7rem;
  line-height: 1;
  width: 2.7rem;
}

.mode-tabs {
  background: var(--surface-muted);
  border-radius: 0.9rem;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 1.1rem 0;
  padding: 0.22rem;
}

.mode-tabs button {
  background: transparent;
  border: 0;
  border-radius: 0.7rem;
  color: var(--text-muted);
  font-size: 0.83rem;
  font-weight: 650;
  min-height: 2.65rem;
}

.mode-tabs button.active {
  background: var(--surface);
  box-shadow: 0 0.15rem 0.5rem rgb(30 40 70 / 8%);
  color: var(--accent);
}

form,
label {
  display: flex;
  flex-direction: column;
}

form {
  gap: 0.9rem;
}

label {
  color: var(--text-main);
  font-size: 0.82rem;
  font-weight: 650;
  gap: 0.42rem;
}

input {
  background: #fafbfe;
  border: 1px solid var(--border-soft);
  border-radius: 0.9rem;
  color: var(--text-main);
  font-size: 1rem;
  min-height: 3.25rem;
  padding: 0 0.9rem;
  width: 100%;
}

input:focus {
  border-color: var(--accent);
  outline: 3px solid color-mix(in srgb, var(--focus-ring) 30%, transparent);
}

.form-error {
  background: #fff0f1;
  border-radius: 0.75rem;
  color: #b4232c;
  font-size: 0.82rem;
  margin: 0;
  padding: 0.7rem;
}

.submit-button {
  background: var(--accent);
  border: 0;
  border-radius: 0.9rem;
  color: #fff;
  font-weight: 750;
  min-height: 3.35rem;
}

.submit-button:disabled {
  opacity: 0.55;
}
</style>
