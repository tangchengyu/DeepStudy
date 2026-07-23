<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  platformTurnstileAdapter,
  type TurnstileAction,
} from '../services/turnstile'

const props = defineProps<{
  siteKey: string
  action: TurnstileAction
}>()

const emit = defineEmits<{
  token: [value: string]
  error: [message: string]
}>()

const host = ref<HTMLElement | null>(null)
const loading = ref(true)
let cleanup: (() => void) | null = null

async function renderChallenge() {
  cleanup?.()
  cleanup = null
  emit('token', '')
  loading.value = true
  await nextTick()
  if (!host.value || !props.siteKey) {
    loading.value = false
    return
  }
  try {
    cleanup = await platformTurnstileAdapter.render(host.value, {
      siteKey: props.siteKey,
      action: props.action,
      onToken: (token) => emit('token', token),
      onError: (message) => emit('error', message),
    })
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

onMounted(renderChallenge)
watch(() => [props.siteKey, props.action], renderChallenge)
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <div class="turnstile-field">
    <div ref="host" class="turnstile-field__host" />
    <small v-if="!siteKey">请先在“我的”页面配置网关</small>
    <small v-else-if="loading">正在加载安全验证…</small>
  </div>
</template>

<style scoped>
.turnstile-field {
  min-height: 4.1rem;
  overflow: hidden;
  width: 100%;
}

.turnstile-field__host {
  width: 100%;
}

small {
  color: var(--text-muted);
}
</style>
