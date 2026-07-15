import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'
import { DEFAULT_SOUL_QUOTES } from '@/utils/defaultSoulQuotes'
import { KEYS } from '@/utils/constants'

export const useSoulStore = defineStore('soul', () => {
  const quotes = ref([])
  const loading = ref(false)
  const currentQuote = ref('Attention Is All You Need')

  const count = computed(() => quotes.value.length)

  async function fetchAll() {
    loading.value = true
    try {
      const data = await api.getAllQuotes()
      quotes.value = Array.isArray(data) ? data : []
    } catch (e) {
      quotes.value = []
    } finally {
      loading.value = false
    }
  }

  function defaultLibraryEnabled() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.defaultSoulQuotesEnabled)) === true
    } catch {
      return false
    }
  }

  function localQuotePool() {
    const texts = quotes.value.map(q => String(q?.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (defaultLibraryEnabled()) texts.push(...DEFAULT_SOUL_QUOTES)
    if (!texts.length) texts.push('Attention Is All You Need')
    const seen = new Set()
    return texts.filter((text) => {
      const key = text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async function fetchRandom() {
    try {
      if (!quotes.value.length) await fetchAll()
      const pool = localQuotePool()
      const text = pool[Math.floor(Math.random() * pool.length)]
      currentQuote.value = text
      return { text }
    } catch (e) {
      const pool = localQuotePool()
      currentQuote.value = pool[Math.floor(Math.random() * pool.length)]
    }
    return null
  }

  async function addQuote(text) {
    if (!text.trim()) return
    try {
      const saved = await api.createQuote({ text: text.trim() })
      quotes.value.unshift(saved)
      return saved
    } catch (e) {
      console.error('Failed to add quote:', e)
    }
  }

  async function updateQuote(id, updates) {
    try {
      const updated = await api.updateQuote(id, updates)
      const idx = quotes.value.findIndex(q => q.id === id)
      if (idx !== -1) quotes.value[idx] = { ...quotes.value[idx], ...updated }
      return updated
    } catch (e) {
      console.error('Failed to update quote:', e)
    }
  }

  async function deleteQuote(id) {
    try {
      await api.deleteQuote(id)
      quotes.value = quotes.value.filter(q => q.id !== id)
    } catch (e) {
      console.error('Failed to delete quote:', e)
    }
  }

  return {
    quotes, loading, currentQuote, count,
    fetchAll, fetchRandom, addQuote, updateQuote, deleteQuote
  }
})
