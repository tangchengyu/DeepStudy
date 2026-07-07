import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/http'
import { todayKey } from '@/utils/format'

export const useDistractionStore = defineStore('distraction', () => {
  const distractions = ref([])
  const loading = ref(false)
  const planDate = ref(todayKey())

  const byQuadrant = computed(() => {
    const groups = {
      'controllable-interesting': [],
      'controllable-boring': [],
      'uncontrollable-interesting': [],
      'uncontrollable-boring': []
    }
    for (const d of distractions.value) {
      const key = `${d.control || 'controllable'}-${d.interest || 'boring'}`
      if (groups[key]) groups[key].push(d)
    }
    return groups
  })

  const count = computed(() => distractions.value.length)

  async function fetchDistractions(date = planDate.value) {
    loading.value = true
    try {
      const data = await http.get(`/distractions?${new URLSearchParams({ date }).toString()}`)
      distractions.value = Array.isArray(data) ? data : []
    } catch (e) {
      distractions.value = []
    } finally {
      loading.value = false
    }
  }

  async function addDistraction(payload) {
    const entry = {
      text: payload.text,
      control: payload.control || 'controllable',
      interest: payload.interest || 'boring',
      quadrant: `${payload.control || 'controllable'}-${payload.interest || 'boring'}`,
      durationMs: payload.durationMs || 0,
      resolved: false,
      date: planDate.value
    }
    try {
      const saved = await http.post('/distractions', entry)
      distractions.value.unshift(saved)
      return saved
    } catch (e) {
      // Fallback local entry
      const local = { ...entry, id: `local-${Date.now()}`, timestamp: Date.now() }
      distractions.value.unshift(local)
      return local
    }
  }

  async function resolveDistraction(id) {
    try {
      await http.patch(`/distractions/${id}/resolve`)
    } catch (e) { /* ignore */ }
    const item = distractions.value.find(d => d.id === id)
    if (item) item.resolved = true
  }

  async function updateDistraction(id, updates) {
    try {
      const updated = await http.patch(`/distractions/${id}`, updates)
      const idx = distractions.value.findIndex(d => d.id === id)
      if (idx >= 0) distractions.value[idx] = { ...distractions.value[idx], ...updated }
      return updated
    } catch (e) { /* ignore */ }
  }

  async function deleteDistraction(id) {
    try {
      await http.delete(`/distractions/${id}`)
    } catch (e) { /* ignore */ }
    distractions.value = distractions.value.filter(d => d.id !== id)
  }

  async function fetchRange(start, end) {
    loading.value = true
    try {
      const data = await http.get(`/distractions/range?${new URLSearchParams({ start, end }).toString()}`)
      return Array.isArray(data) ? data : []
    } finally {
      loading.value = false
    }
  }

  return {
    distractions, loading, planDate,
    byQuadrant, count,
    fetchDistractions, addDistraction, resolveDistraction,
    updateDistraction, deleteDistraction, fetchRange
  }
})
