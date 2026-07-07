<template>
  <section class="habit-mode">
    <div class="target-banner">
      <strong>长期目标</strong>
      <span>争取每日总专注时长达到 6 小时，每周达到 40 小时。</span>
    </div>

    <ElCard class="card time-audit-card">
      <div class="card-title-row">
        <div>
          <h3>时间审计</h3>
          <p>核心工作、维持工作、主动休息与分心的真实分配。</p>
        </div>
        <span id="audit-refresh-status" class="subtle"></span>
      </div>
      <div id="time-audit" class="time-audit"></div>
    </ElCard>

    <ElCard class="card reflection-card">
      <h3>每日反思</h3>
      <p>每周末可将前 7 天记录导出，交给自动化整理成周报。</p>

      <ElInput
        type="textarea"
        id="reflection-input"
        v-model="reflectionText"
        :rows="5"
        maxlength="500"
        show-word-limit
        placeholder="今天在专注力管理方面有什么心得？今天又学到了哪些知识？见识了哪些风景？遇到了哪些挫折？哪些地方可以改进？"
      />

      <div class="reflection-footer">
        <span id="reflection-count" class="reflection-count">{{ reflectionCharCount }} / 300–500</span>
        <div class="reflection-actions">
          <ElButton
            id="reflection-cancel"
            class="secondary-btn compact"
            :hidden="!isEditing"
            @click="cancelEdit"
          >
            取消编辑
          </ElButton>
          <ElButton
            id="reflection-save"
            class="primary-btn"
            @click="saveReflection"
          >
            {{ editId ? '更新' : '保存' }}
          </ElButton>
          <ElButton
            id="reflection-export"
            class="secondary-btn compact"
            @click="exportAllReflections"
          >
            导出全部 TXT
          </ElButton>
        </div>
      </div>
    </ElCard>

    <ElCard class="card history-card">
      <div class="history-header">
        <h4>历史记录</h4>
        <div class="history-actions">
          <ElButton
            id="reflection-select-all"
            class="secondary-btn compact"
            @click="selectAll"
          >
            全选
          </ElButton>
          <ElButton
            id="reflection-deselect-all"
            class="secondary-btn compact"
            @click="deselectAll"
          >
            取消全选
          </ElButton>
          <ElButton
            id="reflection-export-selected"
            class="secondary-btn compact"
            :disabled="selectedIds.size === 0"
            @click="exportSelectedReflections"
          >
            导出选中 TXT
          </ElButton>
          <ElButton
            id="reflection-delete-selected"
            class="secondary-btn danger-lite compact"
            :disabled="selectedIds.size === 0"
            @click="deleteSelectedReflections"
          >
            删除选中
          </ElButton>
        </div>
      </div>

      <div id="reflection-list" class="reflection-list"></div>
    </ElCard>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElButton, ElCard, ElInput } from 'element-plus'
import { api } from '@/api'
import { formatMinutes, todayKey } from '@/utils/format'

const reflectionText = ref('')
const reflections = ref([])
const editId = ref(null)
const isEditing = ref(false)
const selectedIds = ref(new Set())

// Reflection character count
const reflectionCharCount = computed(() => reflectionText.value.length)

// Load reflections from API
async function fetchReflections() {
  try {
    const data = await api.getReflections(todayKey())
    reflections.value = Array.isArray(data) ? data : []
    loadTodayReflection()
  } catch (error) {
    console.error('Failed to fetch reflections:', error)
  }
}

// Load the reflection for today
function loadTodayReflection() {
  const today = reflections.value.find(r =>
    r.date === todayKey() && !r.kind?.startsWith('completed-task')
  )

  if (today) {
    reflectionText.value = today.content || ''
    editId.value = today.id
    isEditing.value = true
  } else {
    reflectionText.value = ''
    editId.value = null
    isEditing.value = false
  }
}

// Save or update reflection
async function saveReflection() {
  const content = reflectionText.value.trim()
  if (!content) return

  try {
    if (editId.value) {
      // Update existing
      await api.updateReflection(editId.value, { content })
    } else {
      // Create new
      await api.saveReflection({ content, date: todayKey() })
    }

    await fetchReflections()

    // Clear form
    reflectionText.value = ''
    editId.value = null
    isEditing.value = false
  } catch (error) {
    console.error('Failed to save reflection:', error)
  }
}

// Cancel edit
function cancelEdit() {
  reflectionText.value = ''
  editId.value = null
  isEditing.value = false
}

// Export all reflections
async function exportAllReflections() {
  try {
    const all = [...reflections.value].sort((a, b) =>
      a.date.localeCompare(b.date)
    )

    const content = [
      '专注力每日反思（全部历史记录）',
      '',
      ...all.flatMap(x => [`【${x.date}】`, x.content, ''])
    ].join('\r\n')

    // Create download link
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `专注力反思_${todayKey()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to export reflections:', error)
  }
}

// Export selected reflections
async function exportSelectedReflections() {
  if (selectedIds.value.size === 0) return

  try {
    const selected = reflections.value
      .filter(r => selectedIds.value.has(r.id))
      .sort((a, b) => a.date.localeCompare(b.date))

    const content = [
      '专注力历史记录（已选）',
      '',
      ...selected.flatMap(x => [`【${x.date}】`, x.content, ''])
    ].join('\r\n')

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `专注力历史记录_${todayKey()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Failed to export selected reflections:', error)
  }
}

// Delete selected reflections
async function deleteSelectedReflections() {
  if (selectedIds.value.size === 0) return

  if (!confirm(`确定删除选中的 ${selectedIds.value.size} 条记录？`)) return

  try {
    // Delete in parallel
    await Promise.all(
      Array.from(selectedIds.value).map(id => api.deleteReflection(id))
    )

    await fetchReflections()
    selectedIds.value.clear()
  } catch (error) {
    console.error('Failed to delete reflections:', error)
  }
}

// Select all
function selectAll() {
  reflections.value.forEach(r => selectedIds.value.add(r.id))
}

// Deselect all
function deselectAll() {
  selectedIds.value.clear()
}

// Group items by date
function groupItemsByDate() {
  const groups = new Map()
  // Create a sorted array of reflections
  const sorted = []
  for (const item of reflections.value) {
    sorted.push(item)
  }
  sorted.sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt - a.updatedAt))
  for (const item of sorted) {
    if (!groups.has(item.date)) {
      groups.set(item.date, [])
    }
    const dateGroup = groups.get(item.date)
    if (dateGroup) {
      dateGroup.push(item)
    }
  }
  return groups
}

// Render reflections
function renderReflections() {
  const root = document.getElementById('reflection-list')
  if (!root) return

  root.innerHTML = ''

  if (reflections.value.length === 0) {
    root.innerHTML = '<p class="subtle">暂无记录</p>'
    return
  }

  const groups = groupItemsByDate()

  groups.forEach((dayItems, date) => {
    const dayEl = document.createElement('div')
    dayEl.className = 'reflection-day'

    const allDaySelected = dayItems.length > 0 &&
      dayItems.every(item => selectedIds.value.has(item.id))

    const dayHeader = document.createElement('div')
    dayHeader.className = 'reflection-day-header'
    dayHeader.innerHTML = `
      <label>
        <input
          type="checkbox"
          data-date="${date}"
          ${allDaySelected ? 'checked' : ''}
        >
        ${date} · ${dayItems.length} 条
      </label>
    `

    dayEl.appendChild(dayHeader)

    dayItems.forEach((item) => {
      const entryEl = document.createElement('div')
      entryEl.className = `reflection-entry ${item.kind?.startsWith('completed-task') ? 'auto-task' : ''}`

      entryEl.innerHTML = `
        <input
          type="checkbox"
          data-select-id="${item.id}"
          ${selectedIds.value.has(item.id) ? 'checked' : ''}
        >
        <p>${item.content}</p>
        <div class="reflection-entry-actions">
          <button class="reflection-action edit" type="button" data-action="edit" data-id="${item.id}">编辑</button>
          <button class="reflection-action delete" type="button" data-action="delete" data-id="${item.id}">删除</button>
        </div>
      `

      dayEl.appendChild(entryEl)
    })

    root.appendChild(dayEl)
  })
}

// Handle click events
function setupEventListeners() {
  const listEl = document.getElementById('reflection-list')
  if (!listEl) return

  // Checkbox selection
  listEl.addEventListener('click', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]') ||
                   event.target.closest('label')?.querySelector('input[type="checkbox"]')

    if (checkbox) {
      const date = checkbox.dataset.date
      if (date) {
        const dayItems = reflections.value.filter(item => item.date === date)
        const allSelected = dayItems.every(item => selectedIds.value.has(item.id))

        dayItems.forEach(item => {
          if (allSelected) {
            selectedIds.value.delete(item.id)
          } else {
            selectedIds.value.add(item.id)
          }
        })
        renderReflections()
        return
      } else {
        const id = checkbox.dataset.selectId
        if (selectedIds.value.has(id)) {
          selectedIds.value.delete(id)
        } else {
          selectedIds.value.add(id)
        }
        renderReflections()
        return
      }
    }

    // Handle action buttons
    const button = event.target.closest('.reflection-action')
    if (!button) return

    const id = button.dataset.id
    const action = button.dataset.action
    const item = reflections.value.find(r => r.id === id)

    if (!item) return

    if (action === 'edit') {
      editId.value = item.id
      reflectionText.value = item.content || ''
      isEditing.value = true
      renderReflections()
      return
    }

    if (action === 'delete') {
      if (!confirm(`删除 ${item.date} 的这条记录？`)) return

      ;(async () => {
        await api.deleteReflection(item.id)
        if (id === editId.value) {
          reflectionText.value = ''
          editId.value = null
          isEditing.value = false
        }
        selectedIds.value.delete(id)
        await fetchReflections()
      })()
    }
  })
}

// Fetch reflections on mount
onMounted(async () => {
  await fetchReflections()
  setupEventListeners()
  renderReflections()
})

onBeforeUnmount(() => {
  // Cleanup
})
</script>

<style scoped>
.habit-mode {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 0;
}

.target-banner {
  padding: 16px;
  background: var(--accent-soft);
  border-radius: var(--radius);
  font-size: 14px;
  line-height: 1.5;
}

.target-banner strong {
  font-size: 16px;
  font-weight: 600;
  margin-right: 8px;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 7px 24px rgba(44, 62, 56, 0.045);
  padding: 24px;
}

.card h3 {
  margin-bottom: 8px;
  font-size: 18px;
}

.card p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 19px;
}

.time-audit-card {
  margin-bottom: 24px;
}

.reflection-card {
  margin-bottom: 24px;
}

.reflection-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
  gap: 16px;
  flex-wrap: wrap;
}

.reflection-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.reflection-count {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}

.ElInput {
  margin-bottom: 16px;
}

.history-card {
  margin-bottom: 24px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 19px;
}

.history-header h4 {
  margin: 0;
  font-size: 16px;
}

.history-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.reflection-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.reflection-day {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reflection-day-header {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.reflection-day-header label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.reflection-entry {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
}

.reflection-entry:last-child {
  border-bottom: none;
}

.reflection-entry auto-task {
  background: var(--surface-2);
  border-left: 3px solid var(--green);
}

.reflection-entry input[type="checkbox"] {
  margin-right: 12px;
}

.reflection-entry p {
  margin: 0;
  line-height: 1.6;
  word-break: break-word;
}

.reflection-entry-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.reflection-action {
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
}

.reflection-action.edit {
  color: var(--accent-hover);
  border-color: var(--accent);
}

.reflection-action.edit:hover {
  background: var(--accent-soft);
}

.reflection-action.delete {
  color: var(--red);
  border-color: var(--red);
}

.reflection-action.delete:hover {
  background: var(--red-soft);
}

@media (max-width: 768px) {
  .history-actions {
    justify-content: center;
  }

  .reflection-footer {
    flex-direction: column;
    gap: 12px;
  }

  .reflection-card,
  .time-audit-card {
    padding: 16px;
  }
}
</style>