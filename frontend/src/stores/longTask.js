import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'

export const useLongTaskStore = defineStore('longTask', () => {
  const tasks = ref([])
  const loading = ref(false)
  const aiConfig = ref(null)
  const chatHistory = ref([])

  const activeTasks = computed(() => tasks.value.filter(t => t.status !== 'completed'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'completed'))

  const byQuadrant = computed(() => {
    const groups = {
      'important-urgent': [],
      'important-not-urgent': [],
      'urgent-not-important': [],
      'not-important-not-urgent': []
    }
    for (const t of tasks.value) {
      const q = t.quadrant || 'not-important-not-urgent'
      if (groups[q]) groups[q].push(t)
    }
    return groups
  })

  async function fetchTasks() {
    loading.value = true
    try {
      const data = await api.getLongTasks()
      tasks.value = Array.isArray(data) ? data : []
    } catch (e) {
      tasks.value = []
    } finally {
      loading.value = false
    }
  }

  async function createTask(task) {
    try {
      const saved = await api.createLongTask(task)
      tasks.value.push(saved)
      return saved
    } catch (e) {
      console.error('Create long task failed:', e)
    }
  }

  async function updateTask(id, updates) {
    try {
      const updated = await api.updateLongTask(id, updates)
      const idx = tasks.value.findIndex(t => t.id === id)
      if (idx !== -1) tasks.value[idx] = { ...tasks.value[idx], ...updated }
      return updated
    } catch (e) {
      console.error('Update long task failed:', e)
    }
  }

  async function deleteTask(id) {
    try {
      await api.deleteLongTask(id)
      tasks.value = tasks.value.filter(t => t.id !== id)
    } catch (e) {
      console.error('Delete long task failed:', e)
    }
  }

  async function reorderTasks(orderedTasks) {
    try {
      await api.reorderLongTasks(orderedTasks)
      orderedTasks.forEach((t, i) => {
        const item = tasks.value.find(x => x.id === t.id)
        if (item) item.order = i
      })
    } catch (e) {
      console.error('Reorder long tasks failed:', e)
    }
  }

  async function completeTask(id) {
    try {
      await api.completeLongTask(id)
      const item = tasks.value.find(t => t.id === id)
      if (item) {
        item.status = 'completed'
        item.completedAt = Date.now()
      }
    } catch (e) {
      console.error('Complete long task failed:', e)
    }
  }

  async function aiChat(payload) {
    try {
      const result = await api.aiChat(payload)
      chatHistory.value.push({ role: 'assistant', content: result })
      return result
    } catch (e) {
      console.error('AI chat failed:', e)
      return null
    }
  }

  async function plannerChat(message) {
    try {
      const result = await api.plannerChat({
        message,
        history: chatHistory.value.slice(-8),
        tasks: tasks.value
      })
      chatHistory.value.push({ role: 'user', content: message })
      chatHistory.value.push({ role: 'assistant', content: result.reply })
      return result
    } catch (e) {
      console.error('Planner chat failed:', e)
      return null
    }
  }

  async function fetchAiConfig(scope = 'planner') {
    try {
      aiConfig.value = await api.getAiConfig(scope)
      return aiConfig.value
    } catch (e) {
      console.error('Fetch AI config failed:', e)
      return null
    }
  }

  async function saveAiConfig(scope, config) {
    try {
      const saved = await api.saveAiConfig(scope, config)
      aiConfig.value = saved
      return saved
    } catch (e) {
      console.error('Save AI config failed:', e)
      return null
    }
  }

  function clearChat() {
    chatHistory.value = []
  }

  return {
    tasks, loading, aiConfig, chatHistory,
    activeTasks, completedTasks, byQuadrant,
    fetchTasks, createTask, updateTask, deleteTask,
    reorderTasks, completeTask, aiChat, plannerChat,
    fetchAiConfig, saveAiConfig, clearChat
  }
})
