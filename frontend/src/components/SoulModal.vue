<template>
  <section class="modal-card soul-card">
    <div class="settings-heading">
      <div>
        <div class="eyebrow">SOUL ROOM</div>
        <h2 id="soul-title">灵魂按摩间</h2>
      </div>
      <button id="soul-close" class="icon-btn compact" type="button" @click="closeModal" aria-label="关闭灵魂按摩间">×</button>
    </div>

    <form id="soul-form" class="soul-form" @submit.prevent="addSoulQuote">
      <input id="soul-edit-id" type="hidden" v-if="editingId" :value="editingId" />
      <label>
        <span>好句子</span>
        <textarea id="soul-input" rows="3" maxlength="240" placeholder="写下一句你想保存的话" v-model="newQuoteText"></textarea>
      </label>
      <div class="soul-form-actions">
        <button id="soul-cancel-edit" class="secondary-btn" type="button" v-if="editingId" @click="cancelEdit">取消修改</button>
        <button id="soul-save" class="primary-btn" type="submit">{{ editingId ? '更新句子' : '添加句子' }}</button>
        <button
          id="soul-default-library-toggle"
          class="secondary-btn soul-library-toggle"
          :class="{ active: defaultLibraryEnabled }"
          type="button"
          :aria-pressed="String(defaultLibraryEnabled)"
          :title="defaultLibraryEnabled ? '已启用默认好句库；再次点击后，欢迎界面只随机展示自定义好句子。' : '点击后，欢迎界面会从默认好句库和自定义好句子中随机展示；默认库句子不会出现在下方列表。'"
          @click="toggleDefaultLibrary"
        >
          {{ defaultLibraryEnabled ? '取消默认的“好句库”' : '使用默认的“好句库”' }}
        </button>
      </div>
    </form>

    <div id="soul-list" class="soul-list" aria-live="polite">
      <div v-if="soulQuotes.length === 0" class="soul-empty">
        <p>还没有好句子，快去添加第一句吧～</p>
      </div>
      <div v-else class="soul-item" v-for="quote in soulQuotes" :key="quote.id">
        <div class="soul-item-text" v-text="quote.text"></div>
        <div class="soul-item-actions">
          <button class="icon-btn" @click="editQuote(quote.id)" title="编辑">✎</button>
          <button class="icon-btn" @click="deleteQuote(quote.id)" title="删除">×</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '@/api'
import { KEYS } from '@/utils/constants'

const DEFAULT_QUOTE = 'Attention Is All You Need'

const soulQuotes = ref([])
const loading = ref(false)
const newQuoteText = ref('')
const editingId = ref(null)
const defaultLibraryEnabled = ref(readDefaultLibraryEnabled())

function readDefaultLibraryEnabled() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.defaultSoulQuotesEnabled)) === true
  } catch {
    return false
  }
}

function normalizeQuote(item) {
  const text = typeof item === 'string' ? item : item?.text
  return String(text || '').replace(/\s+/g, ' ').trim()
}

async function seedDefaultQuote() {
  const existing = soulQuotes.value.some(q => normalizeQuote(q).toLowerCase() === DEFAULT_QUOTE.toLowerCase())
  if (existing) return
  try {
    const saved = await api.createQuote({ text: DEFAULT_QUOTE })
    soulQuotes.value = [saved]
  } catch {
    soulQuotes.value = [{ id: 'default-attention', text: DEFAULT_QUOTE }]
  }
}

async function loadQuotes() {
  loading.value = true
  try {
    const data = await api.getAllQuotes()
    soulQuotes.value = Array.isArray(data) ? data : []
    if (soulQuotes.value.length === 0) await seedDefaultQuote()
  } catch (e) {
    console.error('Failed to load soul quotes:', e)
    soulQuotes.value = [{ id: 'default-attention', text: DEFAULT_QUOTE }]
  } finally {
    loading.value = false
  }
}

async function addSoulQuote() {
  const text = newQuoteText.value.trim()
  if (!text) return

  try {
    if (editingId.value) {
      // Update existing
      await api.updateQuote(editingId.value, { text })
      const idx = soulQuotes.value.findIndex(q => q.id === editingId.value)
      if (idx !== -1) soulQuotes.value[idx].text = text
      editingId.value = null
    } else {
      // Create new
      const saved = await api.createQuote({ text })
      soulQuotes.value.unshift(saved)
    }
    newQuoteText.value = ''
  } catch (e) {
    console.error('Failed to save soul quote:', e)
  }
}

async function editQuote(id) {
  const quote = soulQuotes.value.find(q => q.id === id)
  if (quote) {
    newQuoteText.value = quote.text
    editingId.value = id
  }
}

async function deleteQuote(id) {
  try {
    await api.deleteQuote(id)
    soulQuotes.value = soulQuotes.value.filter(q => q.id !== id)
    if (editingId.value === id) {
      editingId.value = null
      newQuoteText.value = ''
    }
  } catch (e) {
    console.error('Failed to delete soul quote:', e)
  }
}

function closeModal() {
  // Emit close event via provide/inject or emit - parent will handle v-model
  // For now, we'll just reset state
  editingId.value = null
  newQuoteText.value = ''
  // Parent component should close the modal via v-model
}

function toggleDefaultLibrary() {
  defaultLibraryEnabled.value = !defaultLibraryEnabled.value
  localStorage.setItem(KEYS.defaultSoulQuotesEnabled, JSON.stringify(defaultLibraryEnabled.value))
  window.dispatchEvent(new CustomEvent('deepstudy:soul-library-changed'))
}

watch(() => soulQuotes.value, (quotes) => {
  // Persist to localStorage if needed (but we have backend)
}, { deep: true })

// Initialize
loadQuotes()
</script>

<style scoped>
.soul-card {
  width: min(680px, 100%);
  max-height: min(720px, calc(100vh - 40px));
  overflow: auto;
  padding: 24px;
  border-color: var(--border);
  background: var(--surface);
  box-shadow: 0 10px 30px rgba(50, 68, 59, 0.12);
}

.soul-form {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.soul-form label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.soul-form textarea {
  width: 100%;
  min-height: 88px;
  padding: 11px;
  resize: vertical;
  color: var(--text);
  line-height: 1.55;
  font-weight: 400;
}

.soul-form-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.soul-library-toggle.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.soul-list {
  display: grid;
  gap: 9px;
  max-height: 320px;
  margin-top: 18px;
  padding-right: 2px;
  overflow: auto;
}

.soul-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.soul-item-text {
  min-width: 0;
  color: var(--text);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.soul-empty {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-align: center;
}
</style>
