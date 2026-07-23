<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  longTaskRepository,
  type LongTask,
  type QuadrantId,
} from '../data/longTaskRepository'
import { longTaskRepositoryKey } from '../data/longTaskRepositoryContext'
import { quadrants } from '../domain/quadrants'

const props = defineProps<{ quadrantId: QuadrantId; taskId: string }>()
const repository = inject(longTaskRepositoryKey, longTaskRepository)
const task = ref<LongTask>()
const editing = ref(false)
const saving = ref(false)
const deleted = ref(false)
const saveError = ref('')
const editTitle = ref('')
const editNotes = ref('')
const editPlannedAt = ref('')
const editQuadrant = ref<QuadrantId>(props.quadrantId)
const backQuadrant = computed(() => task.value?.quadrantId ?? props.quadrantId)

onMounted(async () => {
  task.value = await repository.get(props.taskId)
})

function startEdit() {
  if (!task.value) return
  editTitle.value = task.value.title
  editNotes.value = task.value.notes ?? ''
  editPlannedAt.value = task.value.plannedAt == null ? '' : String(task.value.plannedAt)
  editQuadrant.value = task.value.quadrantId
  saveError.value = ''
  editing.value = true
}

async function saveEdit() {
  if (!task.value || saving.value) return
  const title = editTitle.value.trim()
  if (!title) {
    saveError.value = '任务名称不能为空。'
    return
  }
  saving.value = true
  saveError.value = ''
  const entityId = task.value.entityId
  const originalQuadrant = task.value.quadrantId
  try {
    const updated = await repository.update(entityId, {
      title,
      notes: editNotes.value,
      plannedAt: editPlannedAt.value.trim() || null,
    })
    if (!updated) throw new Error('LONG_TASK_NOT_FOUND')
    if (editQuadrant.value !== originalQuadrant) {
      const moved = await repository.moveToQuadrant(entityId, editQuadrant.value)
      if (!moved) throw new Error('LONG_TASK_MOVE_FAILED')
    }
    task.value = {
      ...task.value,
      title,
      notes: editNotes.value,
      plannedAt: editPlannedAt.value.trim() || null,
      quadrantId: editQuadrant.value,
    }
    editing.value = false
  } catch {
    saveError.value = '保存失败，编辑内容已保留，请重试。'
  } finally {
    saving.value = false
  }
}

async function toggleCompleted() {
  if (!task.value || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    const changed = task.value.status === 'completed'
      ? await repository.reopen(task.value.entityId)
      : await repository.complete(task.value.entityId)
    if (!changed) throw new Error('LONG_TASK_NOT_FOUND')
    task.value = {
      ...task.value,
      status: task.value.status === 'completed' ? 'active' : 'completed',
    }
  } catch {
    saveError.value = '任务状态保存失败，请重试。'
  } finally {
    saving.value = false
  }
}

async function removeTask() {
  if (!task.value || saving.value) return
  if (!window.confirm(`确认删除“${task.value.title}”吗？`)) return
  saving.value = true
  saveError.value = ''
  try {
    if (!await repository.remove(task.value.entityId)) throw new Error('LONG_TASK_NOT_FOUND')
    deleted.value = true
    task.value = undefined
  } catch {
    saveError.value = '删除失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page task-detail-page">
    <header class="task-detail-toolbar">
      <RouterLink :to="`/long/${backQuadrant}`" class="back-link" aria-label="返回象限列表">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
      </RouterLink>
      <p>任务详情</p>
    </header>

    <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>

    <form v-if="task && editing" class="task-editor" aria-label="编辑长期任务" @submit.prevent="saveEdit">
      <label for="long-edit-title">任务名称</label>
      <input id="long-edit-title" v-model="editTitle" autocomplete="off">
      <label for="long-edit-notes">备注 / 笔记</label>
      <textarea id="long-edit-notes" v-model="editNotes" rows="9" />
      <label for="long-edit-planned-at">计划时间</label>
      <input id="long-edit-planned-at" v-model="editPlannedAt" autocomplete="off" placeholder="可选">
      <label for="long-edit-quadrant">所属象限</label>
      <select id="long-edit-quadrant" v-model="editQuadrant">
        <option v-for="quadrant in quadrants" :key="quadrant.id" :value="quadrant.id">
          {{ quadrant.numeral }} {{ quadrant.title }}
        </option>
      </select>
      <div class="editor-actions">
        <button type="button" class="secondary-button" @click="editing = false">取消</button>
        <button type="submit" :disabled="saving || !editTitle.trim()">保存</button>
      </div>
    </form>

    <article v-else-if="task" class="task-paper">
      <div class="task-title-row">
        <span class="detail-checkbox" aria-hidden="true" />
        <h1>{{ task.title }}</h1>
      </div>
      <p v-if="task.notes" class="task-notes" data-testid="task-notes" v-text="task.notes" />
      <p v-else class="task-notes task-notes--empty">还没有添加备注。</p>
      <dl class="task-meta">
        <template v-if="task.plannedAt != null && task.plannedAt !== ''">
          <dt>计划时间</dt>
          <dd>{{ task.plannedAt }}</dd>
        </template>
      </dl>
      <div class="task-actions">
        <button type="button" aria-label="编辑长期任务" @click="startEdit">编辑</button>
        <button
          type="button"
          :aria-label="task.status === 'completed' ? '重新打开长期任务' : '完成长期任务'"
          :disabled="saving"
          @click="toggleCompleted"
        >{{ task.status === 'completed' ? '重新打开' : '完成' }}</button>
        <button type="button" class="danger-button" aria-label="删除长期任务" :disabled="saving" @click="removeTask">删除</button>
      </div>
    </article>
    <section v-else-if="deleted" class="missing-task" role="status">
      <h1>任务已删除</h1>
      <p>删除会先记录在本机，之后同步到其他设备。</p>
      <RouterLink :to="`/long/${backQuadrant}`">返回象限列表</RouterLink>
    </section>
    <section v-else class="missing-task">
      <h1>未找到任务</h1>
      <p>这条任务可能已被移动或删除。</p>
    </section>
  </main>
</template>

<style scoped>
.task-detail-toolbar {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.task-detail-toolbar p {
  color: var(--text-muted);
  font-size: 0.83rem;
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

.back-link:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

.task-paper {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.35rem;
  min-height: min(65vh, 36rem);
  padding: 1.4rem 1.2rem 2rem;
}

.task-editor {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.35rem;
  display: grid;
  gap: 0.55rem;
  padding: 1.2rem;
}

.task-editor label {
  font-size: 0.8rem;
  font-weight: 700;
}

.task-editor input,
.task-editor textarea,
.task-editor select,
.task-editor button,
.task-actions button {
  border: 1px solid var(--border-soft);
  border-radius: 0.8rem;
  min-height: 2.75rem;
}

.task-editor input,
.task-editor textarea,
.task-editor select {
  background: var(--surface);
  color: var(--text-main);
  padding: 0.65rem 0.8rem;
}

.task-editor textarea {
  resize: vertical;
}

.editor-actions,
.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.5rem;
}

.editor-actions button,
.task-actions button {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  padding: 0 1rem;
}

.editor-actions .secondary-button {
  background: var(--surface-muted);
  color: var(--text-main);
}

.task-actions .danger-button {
  background: #fff0f1;
  color: #a52b3a;
}

.save-error {
  background: #fff0f1;
  border-radius: 0.8rem;
  color: #a52b3a;
  font-size: 0.82rem;
  padding: 0.7rem 0.8rem;
}

.task-title-row {
  align-items: start;
  display: grid;
  gap: 0.9rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.task-title-row h1 {
  font-size: clamp(1.55rem, 7vw, 2.25rem);
  letter-spacing: -0.035em;
  line-height: 1.18;
  margin: 0;
}

.detail-checkbox {
  border: 2px solid #a4acb8;
  border-radius: 0.45rem;
  height: 1.55rem;
  margin-top: 0.18rem;
  width: 1.55rem;
}

.task-notes {
  color: var(--text-main);
  font-size: 1rem;
  line-height: 1.75;
  margin: 2rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.task-notes--empty,
.missing-task {
  color: var(--text-muted);
}

.task-meta {
  border-top: 1px solid var(--border-soft);
  display: grid;
  font-size: 0.85rem;
  gap: 0.35rem;
  grid-template-columns: auto minmax(0, 1fr);
  margin: 1.5rem 0 0;
  padding-top: 1rem;
}

.task-meta dt {
  color: var(--text-muted);
}

.task-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.missing-task {
  padding: 4rem 1rem;
  text-align: center;
}
</style>
