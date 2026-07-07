import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/http'
import { todayKey } from '@/utils/format'

export const useDailyPlanStore = defineStore('plan', () => {
  const tasks = ref([])
  const loading = ref(false)
  const planDate = ref(todayKey())

  const orderedTasks = computed(() =>
    [...tasks.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  )
  const completedTasks = computed(() => tasks.value.filter(t => t.done))
  const activeTasks = computed(() => tasks.value.filter(t => !t.done))
  const priorityTasks = computed(() => tasks.value.filter(t => t.priority))

  async function fetchTasks(date = planDate.value) {
    loading.value = true
    try {
      const data = await http.get(`/plans?${new URLSearchParams({ date }).toString()}`)
      tasks.value = Array.isArray(data) ? data : []
    } finally {
      loading.value = false
    }
  }

  async function addTask(payload) {
    const created = await http.post('/plans', { ...payload, date: planDate.value })
    tasks.value.push(created)
    return created
  }

  async function updateTask(id, updates) {
    const updated = await http.patch(`/plans/${id}`, updates)
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx >= 0) tasks.value[idx] = { ...tasks.value[idx], ...updated }
    return updated
  }

  async function deleteTask(id) {
    await http.delete(`/plans/${id}`)
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  async function toggleDone(id) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    return updateTask(id, {
      done: !task.done,
      completedAt: task.done ? null : Date.now()
    })
  }

  async function togglePriority(id) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    return updateTask(id, { priority: !task.priority })
  }

  async function reorderTasks(orderedIds) {
    const updates = orderedIds.map((id, order) => ({ id, order }))
    await http.post('/plans/reorder', updates)
    orderedIds.forEach((id, order) => {
      const t = tasks.value.find(t => t.id === id)
      if (t) t.order = order
    })
  }

  async function clearCompleted() {
    await http.post('/plans/clear-completed', { date: planDate.value })
    tasks.value = tasks.value.filter(t => !t.done)
  }

  async function resetPlan() {
    await http.delete(`/plans/reset?${new URLSearchParams({ date: planDate.value }).toString()}`)
    tasks.value = []
  }

  return {
    tasks, loading, planDate,
    orderedTasks, completedTasks, activeTasks, priorityTasks,
    fetchTasks, addTask, updateTask, deleteTask,
    toggleDone, togglePriority, reorderTasks, clearCompleted, resetPlan
  }
})
