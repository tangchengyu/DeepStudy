<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  dailyTaskRepository,
  type DailyTask,
} from '../data/dailyTaskRepository'
import { dailyTaskRepositoryKey } from '../data/dailyTaskRepositoryContext'

const repository = inject(dailyTaskRepositoryKey, dailyTaskRepository)
const tasks = ref<DailyTask[]>([])
const newTaskText = ref('')
const pendingCount = ref(0)
const saving = ref(false)
const editingId = ref<string>()
const editText = ref('')
const saveError = ref('')
let loadedDateKey = ''
let dateInterval: ReturnType<typeof setInterval> | null = null

function localDateKey(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function refreshPending() {
  pendingCount.value = await repository.pendingCount()
}

async function loadToday() {
  loadedDateKey = localDateKey()
  tasks.value = await repository.listForDate()
  await refreshPending()
}

onMounted(async () => {
  await loadToday()
  dateInterval = setInterval(() => {
    if (localDateKey() !== loadedDateKey) void loadToday()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (dateInterval) clearInterval(dateInterval)
})

async function createTask() {
  const text = newTaskText.value.trim()
  if (!text || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const created = await repository.create(text)
    tasks.value.push(created)
    newTaskText.value = ''
    await refreshPending()
  } catch {
    saveError.value = '保存失败，请重试。已输入的内容仍保留在本机。'
  } finally {
    saving.value = false
  }
}

function startEdit(task: DailyTask) {
  editingId.value = task.entityId
  editText.value = task.text
}

async function submitEdit(task: DailyTask) {
  const text = editText.value.trim()
  if (!text) return
  if (await repository.rename(task.entityId, text)) task.text = text
  editingId.value = undefined
  await refreshPending()
}

async function togglePriority(task: DailyTask) {
  if (await repository.togglePriority(task.entityId)) task.priority = !task.priority
  await refreshPending()
}

async function toggleDone(task: DailyTask) {
  const changed = task.done
    ? await repository.reopen(task.entityId)
    : await repository.complete(task.entityId)
  if (changed) task.done = !task.done
  await refreshPending()
}

async function moveTask(task: DailyTask, direction: 'up' | 'down') {
  if (!await repository.move(task.entityId, direction)) return
  const index = tasks.value.findIndex((item) => item.entityId === task.entityId)
  const target = index + (direction === 'up' ? -1 : 1)
  ;[tasks.value[index], tasks.value[target]] = [tasks.value[target], tasks.value[index]]
  await refreshPending()
}

async function removeTask(task: DailyTask) {
  if (!window.confirm(`确认删除“${task.text}”吗？`)) return
  if (await repository.remove(task.entityId)) {
    tasks.value = tasks.value.filter((item) => item.entityId !== task.entityId)
  }
  await refreshPending()
}
</script>

<template>
  <main class="page">
    <header class="screen-heading">
      <p class="date-label">今天</p>
      <h1>把注意力留给重要的事</h1>
      <p>任务会先保存到这台手机，即使暂时断网也能查看。</p>
    </header>

    <section class="today-card surface-card" aria-labelledby="today-tasks-title">
      <div class="today-card__heading">
        <p class="section-kicker">今日任务</p>
        <h2 id="today-tasks-title">安排今天</h2>
      </div>
      <p v-if="pendingCount" class="sync-state" role="status">
        {{ pendingCount }} 项更改等待同步，本机编辑不受影响
      </p>
      <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>

      <form class="add-task-form" aria-label="添加今日任务" @submit.prevent="createTask">
        <label for="today-new-task">任务内容</label>
        <div class="add-task-form__row">
          <input
            id="today-new-task"
            v-model="newTaskText"
            autocomplete="off"
            placeholder="写下下一件事"
          >
          <button type="submit" :disabled="saving || !newTaskText.trim()">添加</button>
        </div>
      </form>

      <ul v-if="tasks.length" class="today-task-list">
        <li v-for="task in tasks" :key="task.entityId">
          <form
            v-if="editingId === task.entityId"
            class="edit-task-form"
            :aria-label="`编辑 ${task.text}`"
            @submit.prevent="submitEdit(task)"
          >
            <label :for="`edit-${task.entityId}`">任务内容</label>
            <input :id="`edit-${task.entityId}`" v-model="editText">
            <button type="submit">保存</button>
          </form>
          <template v-else>
            <span data-testid="daily-task-text" :class="{ 'task-text--done': task.done }">{{ task.text }}</span>
            <div class="task-actions">
              <button type="button" :aria-label="`${task.priority ? '取消优先' : '设为优先'} ${task.text}`" @click="togglePriority(task)">
                {{ task.priority ? '★' : '☆' }}
              </button>
              <button type="button" :aria-label="`${task.done ? '重新打开' : '完成'} ${task.text}`" @click="toggleDone(task)">
                {{ task.done ? '重开' : '完成' }}
              </button>
              <button type="button" :aria-label="`上移 ${task.text}`" @click="moveTask(task, 'up')">↑</button>
              <button type="button" :aria-label="`下移 ${task.text}`" @click="moveTask(task, 'down')">↓</button>
              <button type="button" :aria-label="`编辑 ${task.text}`" @click="startEdit(task)">编辑</button>
              <button type="button" :aria-label="`删除 ${task.text}`" @click="removeTask(task)">删除</button>
            </div>
          </template>
        </li>
      </ul>
      <div v-else class="empty-state">
        <strong>今天还没有任务</strong>
        <span>从一件小事开始。</span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.date-label,
.section-kicker {
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  margin: 0 0 0.35rem;
}

.today-card {
  display: grid;
  gap: 1rem;
}

.today-card h2 {
  font-size: 1.25rem;
  margin: 0.2rem 0 0;
}

.sync-state {
  background: var(--accent-soft, rgb(112 173 153 / 16%));
  border-radius: 0.8rem;
  color: var(--accent-strong);
  font-size: 0.82rem;
  margin: 0;
  padding: 0.7rem 0.8rem;
}

.save-error {
  background: #fff0f1;
  border-radius: 0.8rem;
  color: #a52b3a;
  font-size: 0.82rem;
  margin: 0;
  padding: 0.7rem 0.8rem;
}

.add-task-form {
  display: grid;
  gap: 0.45rem;
}

.add-task-form label {
  font-size: 0.82rem;
  font-weight: 700;
}

.add-task-form__row {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.add-task-form input,
.add-task-form button {
  border: 1px solid var(--border-soft);
  border-radius: 0.85rem;
  min-height: 2.75rem;
}

.add-task-form input {
  background: var(--surface);
  color: var(--text-main);
  min-width: 0;
  padding: 0 0.85rem;
}

.add-task-form button {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  padding: 0 1rem;
}

.today-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.today-task-list li {
  align-items: center;
  border-top: 1px solid var(--border-soft);
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 2.75rem;
  padding: 0.8rem 0;
}

.today-task-list button,
.edit-task-form input {
  min-height: 2.75rem;
}

.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}

.task-actions button {
  background: var(--surface-muted);
  border: 0;
  border-radius: 0.65rem;
  min-width: 2.75rem;
}

.task-text--done {
  color: var(--text-muted);
  text-decoration: line-through;
}

.edit-task-form {
  display: grid;
  gap: 0.45rem;
  grid-template-columns: minmax(0, 1fr) auto;
  width: 100%;
}

.edit-task-form label {
  grid-column: 1 / -1;
}

.empty-state {
  color: var(--text-muted);
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 2.4rem 1rem;
  text-align: center;
}

.empty-state strong {
  color: var(--text-main);
}
</style>
