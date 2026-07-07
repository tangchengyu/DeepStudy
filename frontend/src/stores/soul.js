import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'

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

  async function fetchRandom() {
    try {
      const quote = await api.getRandomQuote()
      if (quote?.text) {
        currentQuote.value = quote.text
        return quote
      }
    } catch (e) {
      // Use fallback
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
