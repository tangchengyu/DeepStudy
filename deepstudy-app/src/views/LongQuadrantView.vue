<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  longTaskRepository,
  type LongTask,
  type QuadrantId,
} from '../data/longTaskRepository'
import { longTaskRepositoryKey } from '../data/longTaskRepositoryContext'
import { findQuadrant } from '../domain/quadrants'

const props = defineProps<{ quadrantId: QuadrantId }>()
const repository = inject(longTaskRepositoryKey, longTaskRepository)
const tasks = ref<LongTask[]>([])
const completedTasks = ref<LongTask[]>([])
const completingTaskIds = ref(new Set<string>())
const reopeningTaskIds = ref(new Set<string>())
const newTitle = ref('')
const newNotes = ref('')
const newPlannedAt = ref('')
const saving = ref(false)
const saveError = ref('')
const quadrant = computed(() => findQuadrant(props.quadrantId))

onMounted(async () => {
  ;[tasks.value, completedTasks.value] = await Promise.all([
    repository.listByQuadrant(props.quadrantId),
    repository.listCompletedByQuadrant(props.quadrantId),
  ])
})

async function completeTask(task: LongTask) {
  if (completingTaskIds.value.has(task.entityId)) return
  completingTaskIds.value = new Set(completingTaskIds.value).add(task.entityId)
  try {
    if (await repository.complete(task.entityId)) {
      tasks.value = tasks.value.filter((candidate) => candidate.entityId !== task.entityId)
      completedTasks.value = [{ ...task, status: 'completed' }, ...completedTasks.value]
    }
  } finally {
    const remaining = new Set(completingTaskIds.value)
    remaining.delete(task.entityId)
    completingTaskIds.value = remaining
  }
}

async function reopenTask(task: LongTask) {
  if (reopeningTaskIds.value.has(task.entityId)) return
  reopeningTaskIds.value = new Set(reopeningTaskIds.value).add(task.entityId)
  try {
    if (await repository.reopen(task.entityId)) {
      completedTasks.value = completedTasks.value
        .filter((candidate) => candidate.entityId !== task.entityId)
      tasks.value.push({ ...task, status: 'active' })
    }
  } finally {
    const remaining = new Set(reopeningTaskIds.value)
    remaining.delete(task.entityId)
    reopeningTaskIds.value = remaining
  }
}

async function createTask() {
  const title = newTitle.value.trim()
  if (!title || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const task = await repository.create({
      title,
      notes: newNotes.value,
      quadrantId: props.quadrantId,
      plannedAt: newPlannedAt.value.trim() || null,
    })
    tasks.value.push(task)
    newTitle.value = ''
    newNotes.value = ''
    newPlannedAt.value = ''
  } catch {
    saveError.value = '保存失败，已输入的内容仍保留在本机。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page quadrant-page">
    <header class="detail-heading">
      <RouterLink to="/long" class="back-link" aria-label="返回四象限">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
      </RouterLink>
      <div>
        <p class="eyebrow">{{ quadrant.numeral }} 象限</p>
        <h1>{{ quadrant.title }}</h1>
      </div>
    </header>

    <form class="long-create-card" aria-label="添加长期任务" @submit.prevent="createTask">
      <h2>添加任务</h2>
      <label for="long-new-title">任务名称</label>
      <input id="long-new-title" v-model="newTitle" autocomplete="off" placeholder="写下一项长期任务">
      <label for="long-new-notes">备注 / 笔记</label>
      <textarea id="long-new-notes" v-model="newNotes" rows="3" placeholder="可选，支持多行文本" />
      <label for="long-new-planned-at">计划时间</label>
      <input id="long-new-planned-at" v-model="newPlannedAt" autocomplete="off" placeholder="可选，例如 2026-08-01 09:00">
      <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
      <button type="submit" :disabled="saving || !newTitle.trim()">
        {{ saving ? '保存中…' : '添加到当前象限' }}
      </button>
    </form>

    <section class="task-list-card" data-testid="quadrant-list" :aria-label="`${quadrant.title}任务`">
      <header class="task-list-card__header">
        <span>没有日期</span>
        <span>{{ tasks.length }}</span>
      </header>
      <ul v-if="tasks.length" class="task-list">
        <li v-for="task in tasks" :key="task.entityId">
          <button
            class="task-checkbox"
            type="button"
            :aria-label="`完成 ${task.title}`"
            :disabled="completingTaskIds.has(task.entityId)"
            data-testid="complete-long-task"
            @click="completeTask(task)"
          />
          <RouterLink
            :to="`/long/${props.quadrantId}/${task.entityId}`"
            class="task-title"
            data-testid="long-task-link"
          >
            {{ task.title }}
          </RouterLink>
          <svg v-if="task.notes" class="note-indicator" aria-label="包含备注" viewBox="0 0 24 24">
            <path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6" />
          </svg>
        </li>
      </ul>
      <div v-else class="empty-state">
        <p>这个象限还没有任务</p>
        <span>任务会先保存在本机，之后再同步。</span>
      </div>
    </section>

    <section v-if="completedTasks.length" class="task-list-card completed-card" aria-label="已完成长期任务">
      <header class="task-list-card__header">
        <span>已完成</span>
        <span>{{ completedTasks.length }}</span>
      </header>
      <ul class="task-list task-list--completed">
        <li v-for="task in completedTasks" :key="task.entityId">
          <button
            type="button"
            class="reopen-button"
            data-testid="reopen-long-task"
            :disabled="reopeningTaskIds.has(task.entityId)"
            :aria-label="`重新打开 ${task.title}`"
            @click="reopenTask(task)"
          >重开</button>
          <RouterLink :to="`/long/${props.quadrantId}/${task.entityId}`" class="task-title">
            {{ task.title }}
          </RouterLink>
          <svg v-if="task.notes" class="note-indicator" aria-label="包含备注" viewBox="0 0 24 24">
            <path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6" />
          </svg>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.detail-heading {
  align-items: center;
  display: flex;
  gap: 0.8rem;
  margin-bottom: 1.25rem;
}

.long-create-card {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.3rem;
  display: grid;
  gap: 0.55rem;
  margin-bottom: 1rem;
  padding: 1rem;
}

.long-create-card h2 {
  font-size: 1rem;
  margin: 0 0 0.25rem;
}

.long-create-card label {
  font-size: 0.78rem;
  font-weight: 700;
}

.long-create-card input,
.long-create-card textarea,
.long-create-card button,
.reopen-button {
  border: 1px solid var(--border-soft);
  border-radius: 0.8rem;
  min-height: 2.75rem;
}

.long-create-card input,
.long-create-card textarea {
  background: var(--surface);
  color: var(--text-main);
  padding: 0.65rem 0.8rem;
  resize: vertical;
}

.long-create-card button {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}

.save-error {
  color: #a52b3a;
  font-size: 0.8rem;
  margin: 0;
}

.detail-heading h1 {
  font-size: 1.55rem;
  margin: 0.1rem 0 0;
}

.eyebrow {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  margin: 0;
}

.back-link {
  align-items: center;
  border-radius: 0.8rem;
  color: var(--text-main);
  display: inline-flex;
  height: 2.75rem;
  justify-content: center;
  width: 2.75rem;
}

.back-link svg {
  fill: none;
  height: 1.75rem;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  width: 1.75rem;
}

.back-link:focus-visible,
.task-title:focus-visible,
.task-checkbox:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

.task-list-card {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.3rem;
  padding: 0.75rem 1rem 1rem;
}

.completed-card {
  margin-top: 1rem;
}

.task-list--completed .task-title {
  color: var(--text-muted);
  text-decoration: line-through;
}

.reopen-button {
  background: var(--surface-muted);
  color: var(--accent-strong);
  padding: 0 0.65rem;
}

.task-list-card__header {
  color: var(--text-muted);
  display: flex;
  font-size: 0.82rem;
  justify-content: space-between;
  padding: 0.55rem 0.2rem 0.8rem;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-list li {
  align-items: center;
  border-top: 1px solid var(--border-soft);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 4.2rem;
}

.task-checkbox {
  background: transparent;
  border: 2px solid #a4acb8;
  border-radius: 0.72rem;
  height: 2.75rem;
  width: 2.75rem;
}

.task-checkbox:disabled {
  cursor: wait;
  opacity: 0.55;
}

.task-title {
  color: var(--text-main);
  font-size: 1rem;
  line-height: 1.4;
  padding: 0.8rem 0;
  text-decoration: none;
}

.note-indicator {
  fill: none;
  height: 1.15rem;
  stroke: var(--text-muted);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 1.15rem;
}

.empty-state {
  color: var(--text-muted);
  padding: 3rem 1rem;
  text-align: center;
}

.empty-state p {
  color: var(--text-main);
  font-weight: 700;
  margin: 0 0 0.4rem;
}

.empty-state span {
  font-size: 0.82rem;
}
</style>
