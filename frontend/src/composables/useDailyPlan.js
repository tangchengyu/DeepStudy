import { ref, computed, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { api } from '@/api'
import { todayKey, formatDateLabel } from '@/utils/format'

export function useDailyPlan() {
  // 与后端同步的状态
  const planDate = ref(todayKey())
  const tasks = ref([])
  const loading = ref(false)

  // 计算属性
  const incompleteTasks = computed(() => tasks.value.filter(t => !t.done))
  const completedTasks = computed(() => tasks.value.filter(t => t.done))
  const priorityTasks = computed(() => tasks.value.filter(t => t.priority))
  const totalTasks = computed(() => tasks.value.length)

  // 获取当天计划（从后端）
  async function loadTodayPlan() {
    loading.value = true
    try {
      // 获取今天的计划（后端返回当天的所有任务）
      const date = planDate.value
      const todayTasks = await api.getPlanTasks(date)
      // 按 order 排序
      tasks.value = todayTasks.sort((a, b) => (a.order || 0) - (b.order || 0))
    } finally {
      loading.value = false
    }
  }

  // 创建任务
  async function addTask(text) {
    if (!text.trim()) return
    try {
      const newTask = {
        text: text.trim(),
        priority: false,
        done: false,
        order: tasks.value.length // 最后一个
      }
      const saved = await api.addTask(newTask)
      tasks.value.push(saved)
      return saved
    } catch (e) {
      throw e
    }
  }

  // 更新任务
  async function updateTask(id, updates) {
    try {
      const updated = await api.updateTask(id, updates)
      const idx = tasks.value.findIndex(t => t.id === id)
      if (idx !== -1) tasks.value.splice(idx, 1, updated)
      return updated
    } catch (e) {
      throw e
    }
  }

  // 删除任务
  async function deleteTask(id) {
    await api.deleteTask(id)
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  // 切换完成状态
  async function toggleTaskCompletion(id) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    const updated = await api.updateTask(id, {
      done: !task.done,
      completedAt: task.done ? null : Date.now()
    })
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx !== -1) tasks.value.splice(idx, 1, updated)
    return updated
  }

  // 切换优先级
  async function toggleTaskPriority(id) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    const updated = await api.updateTask(id, { priority: !task.priority })
    const idx = tasks.value.findIndex(t => t.id === id)
    if (idx !== -1) tasks.value.splice(idx, 1, updated)
    return updated
  }

  // 拖拽重新排序
  async function reorderTask(fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    const [moved] = tasks.value.splice(fromIndex, 1)
    tasks.value.splice(toIndex, 0, moved)
    // 更新 order
    const updates = tasks.value.map((task, index) => ({
      id: task.id,
      order: index
    }))
    await api.reorderTasks(updates)
  }

  // 设置日期（切换到其他天）
  async function setDate(dateStr) {
    planDate.value = dateStr
    await loadTodayPlan()
  }

  // 今天
  function setToday() {
    planDate.value = todayKey()
    return loadTodayPlan()
  }

  // 清除已完成
  async function clearCompleted() {
    await api.clearCompleted(planDate.value)
    tasks.value = tasks.value.filter(t => !t.done)
  }

  // 初始化
  watch(() => planDate.value, loadTodayPlan)

  return {
    planDate,
    tasks,
    loading,
    incompleteTasks,
    completedTasks,
    priorityTasks,
    totalTasks,
    loadTodayPlan,
    addTask,
    updateTask,
    deleteTask,
    toggleTaskCompletion,
    toggleTaskPriority,
    reorderTask,
    setDate,
    setToday,
    clearCompleted
  }
}