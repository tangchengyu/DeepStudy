import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'

export const useReflectionStore = defineStore('reflection', () => {
  const entries = ref([])
  const loading = ref(false)

  const count = computed(() => entries.value.length)

  async function fetchAll() {
    loading.value = true
    try {
      const data = await api.getReflections()
      entries.value = Array.isArray(data) ? data.sort((a, b) => b.date.localeCompare(a.date)) : []
    } catch (e) {
      entries.value = []
    } finally {
      loading.value = false
    }
  }

  async function createEntry(text) {
    if (!text.trim()) return
    try {
      const saved = await api.createReflection({ text: text.trim() })
      entries.value.unshift(saved)
      return saved
    } catch (e) {
      console.error('Failed to create reflection:', e)
    }
  }

  async function updateEntry(id, text) {
    try {
      const updated = await api.updateReflection(id, { text })
      const idx = entries.value.findIndex(e => e.id === id)
      if (idx !== -1) entries.value[idx] = { ...entries.value[idx], ...updated }
      return updated
    } catch (e) {
      console.error('Failed to update reflection:', e)
    }
  }

  async function deleteEntry(id) {
    try {
      await api.deleteReflection(id)
      entries.value = entries.value.filter(e => e.id !== id)
    } catch (e) {
      console.error('Failed to delete reflection:', e)
    }
  }

  async function exportAll() {
    try {
      return await api.exportReflections()
    } catch (e) {
      console.error('Export failed:', e)
      return ''
    }
  }

  async function saveCurrentDay(text) {
    const today = new Date().toISOString().slice(0, 10)
    const existing = entries.value.find(e => e.date === today)
    if (existing) {
      return updateEntry(existing.id, text)
    } else {
      return createEntry(text)
    }
  }

  return {
    entries, loading, count,
    fetchAll, createEntry, updateEntry, deleteEntry, exportAll, saveCurrentDay
  }
})
