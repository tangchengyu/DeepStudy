<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  localDateKey,
  reflectionRepository,
  reflectionRepositoryKey,
  type AuditCategory,
  type AuditSummary,
  type ReflectionDateGroup,
  type ReflectionEntry,
} from '../data/reflectionRepository'

const repository = inject(reflectionRepositoryKey, reflectionRepository)
const groups = ref<ReflectionDateGroup[]>([])
const audit = ref<AuditSummary>({
  today: { core: 0, maintenance: 0, rest: 0, distraction: 0 },
  sevenDays: { core: 0, maintenance: 0, rest: 0, distraction: 0 },
})
const today = ref(localDateKey(new Date()))
const todayContent = ref('')
const editingId = ref<string | null>(null)
const editingContent = ref('')
const busy = ref(false)
const message = ref('')
const errorMessage = ref('')
let dateInterval: ReturnType<typeof setInterval> | null = null

const categoryLabels: Record<AuditCategory, string> = {
  core: '核心工作',
  maintenance: '维持工作',
  rest: '主动休息',
  distraction: '分心',
}
const categories = Object.keys(categoryLabels) as AuditCategory[]

const todayManual = computed(() => groups.value
  .find((group) => group.date === today.value)?.entries
  .find((entry) => !entry.kind.startsWith('completed-task')))

function formatDuration(durationMs: number) {
  const minutes = Math.round(durationMs / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`
}

function replaceEntry(next: ReflectionEntry) {
  const existingGroup = groups.value.find((group) => group.date === next.date)
  if (!existingGroup) {
    groups.value = [{ date: next.date, entries: [next] }, ...groups.value]
      .sort((left, right) => right.date.localeCompare(left.date))
    return
  }
  const index = existingGroup.entries.findIndex((entry) => entry.entityId === next.entityId)
  if (index >= 0) existingGroup.entries[index] = next
  else existingGroup.entries.unshift(next)
}

async function load() {
  try {
    const [nextGroups, nextAudit] = await Promise.all([
      repository.listGrouped(),
      repository.getAuditSummary(),
    ])
    groups.value = nextGroups
    audit.value = nextAudit
    todayContent.value = todayManual.value?.content ?? ''
  } catch {
    errorMessage.value = '暂时无法读取反思记录，请稍后重试。'
  }
}

async function saveToday() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  errorMessage.value = ''
  try {
    const saved = await repository.saveManual(todayContent.value, today.value)
    replaceEntry(saved)
    todayContent.value = saved.content
    message.value = '已保存到本机，等待同步。'
  } catch {
    errorMessage.value = '保存失败，文字仍保留在编辑框中。'
  } finally {
    busy.value = false
  }
}

function startEditing(entry: ReflectionEntry) {
  editingId.value = entry.entityId
  editingContent.value = entry.content
  message.value = ''
  errorMessage.value = ''
}

function cancelEditing() {
  editingId.value = null
  editingContent.value = ''
}

async function saveHistory(entry: ReflectionEntry) {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const changed = await repository.update(entry.entityId, editingContent.value)
    if (!changed) throw new Error('REFLECTION_NOT_FOUND')
    entry.content = editingContent.value.trim()
    cancelEditing()
    message.value = '反思已更新并等待同步。'
  } catch {
    errorMessage.value = '更新失败，修改内容尚未丢失。'
  } finally {
    busy.value = false
  }
}

async function removeEntry(entry: ReflectionEntry) {
  if (busy.value) return
  if (!window.confirm(`确认删除 ${entry.date} 的反思吗？`)) return
  busy.value = true
  errorMessage.value = ''
  try {
    const removed = await repository.remove(entry.entityId)
    if (!removed) throw new Error('REFLECTION_NOT_FOUND')
    const removedTodayManual = todayManual.value?.entityId === entry.entityId
    groups.value = groups.value
      .map((group) => ({
        ...group,
        entries: group.entries.filter((candidate) => candidate.entityId !== entry.entityId),
      }))
      .filter((group) => group.entries.length > 0)
    if (removedTodayManual) todayContent.value = ''
    if (editingId.value === entry.entityId) cancelEditing()
    message.value = '反思已删除，删除操作等待同步。'
  } catch {
    errorMessage.value = '删除失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
  dateInterval = setInterval(() => {
    const nextToday = localDateKey(new Date())
    if (nextToday === today.value) return
    today.value = nextToday
    void load()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (dateInterval) clearInterval(dateInterval)
})
</script>

<template>
  <main class="page habit-page">
    <header class="screen-heading">
      <h1>习惯</h1>
      <p>长期习惯从每天的回顾开始：记录选择，也看见时间流向。</p>
    </header>

    <section class="surface-card reflection-editor-card" aria-labelledby="today-reflection-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">今日反思</p>
          <h2 id="today-reflection-heading">今天哪个选择最值得保留？</h2>
        </div>
        <span class="date-chip">{{ today }}</span>
      </div>
      <form aria-label="编辑今日反思" @submit.prevent="saveToday">
        <label for="today-reflection">反思内容</label>
        <textarea
          id="today-reflection"
          v-model="todayContent"
          rows="6"
          placeholder="写下今天有效的方法、遇到的阻力，以及明天想继续的行动……"
        />
        <button class="primary-action" type="submit" :disabled="busy || !todayContent.trim()">
          {{ busy ? '保存中…' : todayManual ? '更新今日反思' : '保存今日反思' }}
        </button>
      </form>
      <p v-if="message" class="save-status" aria-live="polite">{{ message }}</p>
      <p v-if="errorMessage" class="error-status" role="alert">{{ errorMessage }}</p>
    </section>

    <section class="audit-section" aria-labelledby="audit-heading">
      <div class="section-title-row">
        <div>
          <p class="eyebrow">时间审计</p>
          <h2 id="audit-heading">专注、维护、休息与分心</h2>
        </div>
      </div>
      <div class="audit-grid">
        <article class="surface-card audit-card" aria-label="今日时间审计">
          <h3>今日</h3>
          <dl>
            <div v-for="category in categories" :key="category" :class="['audit-row', category]">
              <dt><i aria-hidden="true" />{{ categoryLabels[category] }}</dt>
              <dd>{{ formatDuration(audit.today[category]) }}</dd>
            </div>
          </dl>
        </article>
        <article class="surface-card audit-card" aria-label="近 7 天时间审计">
          <h3>近 7 天</h3>
          <dl>
            <div v-for="category in categories" :key="category" :class="['audit-row', category]">
              <dt><i aria-hidden="true" />{{ categoryLabels[category] }}</dt>
              <dd>{{ formatDuration(audit.sevenDays[category]) }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>

    <section class="history-section" aria-labelledby="history-heading">
      <div class="section-title-row">
        <div>
          <p class="eyebrow">反思历史</p>
          <h2 id="history-heading">按日期回看</h2>
        </div>
      </div>
      <p v-if="!groups.length" class="surface-card empty-state">还没有反思记录，从今天开始就好。</p>
      <div v-else class="history-list">
        <section
          v-for="group in groups"
          :key="group.date"
          class="surface-card date-group"
          data-testid="reflection-date-group"
          :data-date="group.date"
        >
          <header>
            <h3>{{ group.date }}</h3>
            <span>{{ group.entries.length }} 条</span>
          </header>
          <article v-for="entry in group.entries" :key="entry.entityId" class="history-entry">
            <form
              v-if="editingId === entry.entityId"
              :aria-label="`编辑 ${group.date} 的反思`"
              @submit.prevent="saveHistory(entry)"
            >
              <label :for="`reflection-edit-${entry.entityId}`">反思内容</label>
              <textarea
                :id="`reflection-edit-${entry.entityId}`"
                v-model="editingContent"
                rows="5"
              />
              <div class="entry-actions">
                <button type="button" class="secondary-action" @click="cancelEditing">取消</button>
                <button type="submit" class="primary-action" :disabled="busy || !editingContent.trim()">保存</button>
              </div>
            </form>
            <template v-else>
              <span v-if="entry.kind.startsWith('completed-task')" class="entry-kind">已完成任务</span>
              <p data-testid="reflection-content">{{ entry.content }}</p>
              <div class="entry-actions">
                <button
                  type="button"
                  class="secondary-action"
                  :aria-label="`编辑 ${group.date} 的反思`"
                  @click="startEditing(entry)"
                >编辑</button>
                <button
                  type="button"
                  class="danger-action"
                  :aria-label="`删除 ${group.date} 的反思`"
                  @click="removeEntry(entry)"
                >删除</button>
              </div>
            </template>
          </article>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.habit-page {
  display: grid;
  gap: 1.1rem;
}

.habit-page .screen-heading {
  margin-bottom: 0.1rem;
}

.section-heading,
.section-title-row,
.date-group > header,
.entry-actions {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 0.8rem;
}

.eyebrow {
  color: var(--accent-strong);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}

h2,
h3 {
  margin: 0;
}

h2 {
  font-size: 1.25rem;
  line-height: 1.4;
}

.date-chip,
.entry-kind {
  background: var(--accent-soft, rgb(112 173 153 / 16%));
  border-radius: 999px;
  color: var(--accent-strong);
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.45rem 0.65rem;
}

form {
  display: grid;
  gap: 0.65rem;
  margin-top: 1rem;
}

label {
  font-size: 0.82rem;
  font-weight: 700;
}

textarea {
  background: var(--surface-soft);
  border: 1px solid #d7dbe7;
  border-radius: 1rem;
  color: var(--text-main);
  line-height: 1.6;
  min-height: 8rem;
  padding: 0.9rem;
  resize: vertical;
  width: 100%;
}

textarea:focus-visible,
button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--focus-ring) 55%, transparent);
  outline-offset: 2px;
}

button {
  border-radius: 0.85rem;
  font-weight: 750;
  min-height: 2.75rem;
  padding: 0.65rem 0.9rem;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.primary-action {
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
}

.secondary-action,
.danger-action {
  background: #fff;
  border: 1px solid var(--border-soft);
  color: var(--text-main);
}

.danger-action {
  color: #a33a45;
}

.save-status,
.error-status {
  font-size: 0.82rem;
  line-height: 1.5;
  margin: 0.75rem 0 0;
}

.save-status {
  color: #197053;
}

.error-status {
  color: #a33a45;
}

.audit-section,
.history-section {
  display: grid;
  gap: 0.8rem;
}

.audit-grid {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.audit-card h3 {
  font-size: 1rem;
  margin-bottom: 0.65rem;
}

.audit-card dl {
  display: grid;
  gap: 0.55rem;
  margin: 0;
}

.audit-row {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.audit-row dt {
  align-items: center;
  color: var(--text-muted);
  display: flex;
  font-size: 0.78rem;
  gap: 0.4rem;
}

.audit-row dd {
  font-size: 0.8rem;
  font-weight: 800;
  margin: 0;
  text-align: right;
}

.audit-row i {
  background: var(--accent);
  border-radius: 50%;
  height: 0.5rem;
  width: 0.5rem;
}

.audit-row.maintenance i { background: var(--plan); }
.audit-row.rest i { background: #7caf91; }
.audit-row.distraction i { background: #cf5b6a; }

.history-list {
  display: grid;
  gap: 0.8rem;
}

.date-group > header {
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 0.75rem;
}

.date-group > header h3 {
  font-size: 1rem;
}

.date-group > header span {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.history-entry {
  border-bottom: 1px solid var(--border-soft);
  padding: 0.9rem 0;
}

.history-entry:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.history-entry > p {
  line-height: 1.65;
  margin: 0.55rem 0 0.8rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.entry-kind {
  display: inline-block;
  font-size: 0.7rem;
}

.entry-actions {
  justify-content: flex-end;
}

.empty-state {
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 430px) {
  .audit-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
