<template>
  <section class="gate-view">
    <figure class="attention-arena">
      <img
        src="@/assets/focus-gate.png"
        alt="你的注意力空间"
        decoding="async"
        @error="onImgError"
      />
    </figure>
    <div
      class="quote-screen"
      role="button"
      tabindex="0"
      aria-label="随机刷新一句好句子"
      @click="refreshQuote"
      @keydown.enter="refreshQuote"
      @keydown.space.prevent="refreshQuote"
    >
      <div class="quote-screen-text">{{ currentQuote }}</div>
    </div>
    <p>确保至少 5 分钟闭眼静心，清除注意力残留后，进入注意力空间。</p>
    <button id="enter-gate" class="gate-button" type="button" @click="$emit('start')" title="进入前先清空上一任务的注意力残留。【注意力残留理论认为，开始新任务时，未完成思绪会占用认知资源，短暂静心有助于降低切换成本。】">
      进入注意力空间
    </button>
    <small>守门员不是消灭分心，而是觉察它，并把注意力带回来。</small>
  </section>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/api'
import { DEFAULT_SOUL_QUOTES } from '@/utils/defaultSoulQuotes'
import { KEYS } from '@/utils/constants'

const props = defineProps({
  defaultQuote: { type: String, default: 'Attention Is All You Need' }
})

const emit = defineEmits(['start'])

const currentQuote = ref(props.defaultQuote)
const customQuotes = ref([])

function normalizeQuote(item) {
  const text = typeof item === 'string' ? item : item?.text
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function defaultLibraryEnabled() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.defaultSoulQuotesEnabled)) === true
  } catch {
    return false
  }
}

function quotePool() {
  const texts = customQuotes.value.map(normalizeQuote).filter(Boolean)
  if (defaultLibraryEnabled()) texts.push(...DEFAULT_SOUL_QUOTES)
  if (!texts.length) texts.push(props.defaultQuote)
  const seen = new Set()
  return texts.filter((text) => {
    const key = text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function loadCustomQuotes() {
  try {
    const data = await api.getAllQuotes()
    customQuotes.value = Array.isArray(data) ? data : []
  } catch {
    customQuotes.value = []
  }
}

function refreshQuote() {
  const pool = quotePool()
  const current = currentQuote.value
  let next = pool[Math.floor(Math.random() * pool.length)] || props.defaultQuote
  while (next === current && pool.length > 1) next = pool[Math.floor(Math.random() * pool.length)]
  currentQuote.value = next
}

async function refreshLibraryState() {
  await loadCustomQuotes()
  refreshQuote()
}

function onImgError(e) {
  e.target.style.display = 'none'
}

onMounted(async () => {
  await refreshLibraryState()
  window.addEventListener('deepstudy:soul-library-changed', refreshLibraryState)
})

onBeforeUnmount(() => {
  window.removeEventListener('deepstudy:soul-library-changed', refreshLibraryState)
})
</script>

<style scoped>
.gate-view {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 20px;
}

.gate-view p {
  max-width: 530px;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.7;
}

.gate-view small {
  color: var(--text-dim);
}

.attention-arena {
  width: min(760px, 100%);
  aspect-ratio: 1844 / 853;
  margin-bottom: 4px;
  overflow: hidden;
  border-radius: 28px;
  background: #e3f2ef;
  box-shadow: 0 7px 22px rgba(63, 111, 98, 0.09);
}

.attention-arena img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.quote-screen {
  position: relative;
  width: min(720px, 100%);
  height: 156px;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 26px 48px 38px;
  border: 1px solid rgba(137, 214, 216, 0.74);
  border-radius: 40px;
  background:
    radial-gradient(circle at 16% 28%, rgba(255, 255, 255, 0.92) 0 15px, transparent 16px),
    radial-gradient(circle at 20% 31%, rgba(255, 255, 255, 0.72) 0 18px, transparent 19px),
    radial-gradient(circle at 84% 30%, rgba(255, 255, 255, 0.84) 0 13px, transparent 14px),
    radial-gradient(circle at 88% 32%, rgba(255, 255, 255, 0.64) 0 17px, transparent 18px),
    radial-gradient(ellipse at 18% 94%, rgba(133, 215, 167, 0.48) 0 24%, transparent 25%),
    radial-gradient(ellipse at 82% 95%, rgba(109, 198, 190, 0.34) 0 27%, transparent 28%),
    linear-gradient(180deg, rgba(219, 248, 255, 0.96) 0%, rgba(237, 255, 252, 0.9) 53%, rgba(223, 246, 218, 0.92) 100%);
  box-shadow:
    inset 0 0 0 10px rgba(255, 255, 255, 0.58),
    inset 0 0 0 13px rgba(100, 204, 202, 0.34),
    inset 0 0 0 20px rgba(255, 255, 255, 0.46),
    0 7px 22px rgba(63, 111, 98, 0.08);
  cursor: pointer;
  transition: transform var(--transition), box-shadow var(--transition);
}

.quote-screen:hover,
.quote-screen:focus-visible {
  box-shadow:
    inset 0 0 0 10px rgba(255, 255, 255, 0.64),
    inset 0 0 0 13px rgba(100, 204, 202, 0.44),
    inset 0 0 0 20px rgba(255, 255, 255, 0.5),
    0 8px 24px rgba(63, 111, 98, 0.1);
}

.quote-screen:focus-visible {
  outline: 3px solid var(--accent-soft);
  outline-offset: 4px;
}

.quote-screen-text {
  position: relative;
  z-index: 3;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  color: #073f3b;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.16;
  text-shadow:
    0 2px 0 rgba(255, 255, 255, 0.76),
    0 9px 18px rgba(13, 70, 65, 0.16);
  text-align: center;
  overflow-wrap: anywhere;
  word-break: break-word;
  hyphens: auto;
  white-space: normal;
  overflow: hidden;
  animation: quote-roll-in 0.55s ease both;
}

.gate-button {
  min-width: 280px;
  padding: 15px 30px;
  border-radius: 18px;
  background: linear-gradient(135deg, #7db7a4, #83aac6);
  color: white;
  font-size: 18px;
  font-weight: 800;
  box-shadow: 0 5px 16px rgba(63, 111, 98, 0.12);
  transition: 0.25s;
}

.gate-button:hover {
  background: linear-gradient(135deg, #70ad99, #789eb9);
  box-shadow: 0 6px 18px rgba(63, 111, 98, 0.14);
}
</style>
