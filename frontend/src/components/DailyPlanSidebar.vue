<template>
  <aside id="daily-plan-sidebar">
    <!-- Heading -->
    <div class="sidebar-heading">
      <div>
        <div class="eyebrow">TODAY</div>
        <h1>每日计划</h1>
      </div>
      <div class="sidebar-heading-actions">
        <button
          id="chat-toggle"
          class="icon-btn"
          :class="{ active: chatOpen }"
          type="button"
          :aria-pressed="String(chatOpen)"
          @click="toggleChat"
        >
          AI 对话
        </button>
      </div>
    </div>

    <!-- Date display -->
    <div id="plan-date" class="plan-date">{{ dateLabel }}</div>

    <!-- Quick add form -->
    <form id="plan-add-form" class="quick-add" @submit.prevent="addQuickTask">
      <input
        id="plan-input"
        v-model="newTaskText"
        class="sidebar-input"
        maxlength="120"
        autocomplete="off"
        placeholder="添加今日任务，回车添加"
        :disabled="store.loading"
      />
    </form>

    <!-- Task list -->
    <div
      class="plan-list-wrap"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <ul
        id="plan-list"
        v-if="store.orderedTasks.length"
      >
        <li
          v-for="task in store.orderedTasks"
          :key="task.id"
          class="plan-item"
          :class="{
            priority: task.priority,
            completed: task.done,
            dragging: draggingId === task.id,
            'drag-over': dragTargetId === task.id
          }"
          draggable="true"
          :data-id="task.id"
          @dragstart="onDragStart($event, task.id)"
          @dragend="onDragEnd"
          @dragover.prevent="onDragOverItem(task.id)"
          @dragleave="onDragLeaveItem"
          @contextmenu.prevent="showContextMenu($event, task)"
        >
          <span
            class="task-drag-handle"
            title="拖动排序"
          />
          <label class="plan-check">
            <input
              type="checkbox"
              :checked="task.done"
              @change="handleToggleDone(task)"
            />
            <span>
              <b v-if="task.priority" class="priority-star">⭐</b>
              {{ task.text }}
            </span>
          </label>
          <button
            class="task-remove"
            type="button"
            @click="handleDelete(task)"
          >
            ×
          </button>
        </li>
      </ul>
      <p
        id="plan-empty"
        class="empty"
        :hidden="store.orderedTasks.length > 0"
      >
        还没有计划
      </p>
    </div>

    <!-- Sidebar actions -->
    <div class="sidebar-actions">
      <button
        id="clear-completed"
        class="ghost-btn"
        type="button"
        :disabled="store.completedTasks.length === 0"
        @click="handleClearCompleted"
      >
        清除已完成
      </button>
      <button
        id="reset-plan"
        class="ghost-btn danger"
        type="button"
        :disabled="store.tasks.length === 0"
        @click="handleReset"
      >
        重置
      </button>
    </div>

    <!-- Planner chat section -->
    <section
      id="planner-chat"
      class="planner-chat"
      :hidden="!chatOpen"
    >
      <div class="chat-header">
        <strong>AI 计划助手</strong>
        <div class="chat-header-actions">
          <button
            id="chat-new"
            class="icon-btn compact"
            type="button"
            aria-label="清除上下文并开始新聊天"
            title="新聊天"
            :disabled="chatBusy"
            @click="newChat"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14v11H9l-4 3V5Z" />
              <path d="M12 8v5M9.5 10.5h5" />
            </svg>
          </button>
          <button
            id="planner-settings-open"
            class="icon-btn compact"
            type="button"
            aria-label="AI 模型设置"
            title="AI 模型设置"
            @click="$emit('open-settings')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
          <button
            id="chat-close"
            class="icon-btn compact"
            type="button"
            aria-label="关闭 AI 对话"
            @click="chatOpen = false"
          >
            ×
          </button>
        </div>
      </div>
      <div id="planner-config" class="subtle">{{ configStatus }}</div>
      <div
        id="planner-messages"
        class="planner-messages"
        aria-live="polite"
      >
        <div
          v-for="(msg, idx) in chatMessages"
          :key="idx"
          class="chat-message"
          :class="msg.role"
        >
          {{ msg.content }}
        </div>
      </div>
      <form id="planner-form" class="planner-form" @submit.prevent="sendChatMessage">
        <textarea
          id="planner-input"
          v-model="chatInput"
          rows="3"
          maxlength="1000"
          placeholder="告诉我今天想完成什么"
          :disabled="chatBusy"
        />
        <button
          id="planner-send"
          class="primary-btn"
          type="submit"
          :disabled="chatBusy || !chatInput.trim()"
        >
          生成计划
        </button>
      </form>
    </section>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="task-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button type="button" @click="togglePriorityFromMenu">
          {{ contextMenu.task?.priority ? '取消优先任务' : '加入优先任务' }}
        </button>
      </div>
    </Teleport>

    <!-- Reset confirm modal -->
    <Teleport to="body">
      <div
        v-if="showResetModal"
        class="reset-confirm-overlay"
        @click.self="showResetModal = false"
      >
        <div class="reset-confirm-modal">
          <p>确认重置今日计划？</p>
          <div class="reset-confirm-actions">
            <button ref="resetOkRef" class="primary-btn compact" type="button" @click="confirmReset(true)">
              确认
            </button>
            <button class="ghost-btn" type="button" @click="confirmReset(false)">
              取消
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useDailyPlanStore } from '@/stores/plan'
import { formatDateLabel, todayKey } from '@/utils/format'
import { api } from '@/api'

defineEmits(['open-settings'])

// Store
const store = useDailyPlanStore()

// Date
const dateLabel = computed(() => formatDateLabel(new Date()))

// ---- Daily Plan ----
const newTaskText = ref('')
const showResetModal = ref(false)
const resetOkRef = ref(null)

async function addQuickTask() {
  const text = newTaskText.value.trim()
  if (!text) return
  try {
    await store.addTask({ text })
    newTaskText.value = ''
  } catch {
    // Error handled by http interceptor
  }
}

function handleToggleDone(task) {
  store.toggleDone(task.id)
}

function handleDelete(task) {
  store.deleteTask(task.id)
}

async function handleClearCompleted() {
  try {
    await store.clearCompleted()
  } catch {
    // handled by interceptor
  }
}

function handleReset() {
  if (store.tasks.length > 0) {
    showResetModal.value = true
    nextTick(() => resetOkRef.value?.focus())
  }
}

async function confirmReset(confirmed) {
  showResetModal.value = false
  if (confirmed) {
    try {
      await store.resetPlan()
    } catch {
      // handled by interceptor
    }
  }
}

// ---- Context Menu ----
const contextMenu = ref({ visible: false, x: 0, y: 0, task: null })

function showContextMenu(event, task) {
  contextMenu.value = {
    visible: true,
    x: Math.min(event.clientX, window.innerWidth - 170),
    y: Math.min(event.clientY, window.innerHeight - 44),
    task
  }
}

function hideContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.task = null
}

function togglePriorityFromMenu() {
  const task = contextMenu.value.task
  if (task) store.togglePriority(task.id)
  hideContextMenu()
}

document.addEventListener('click', (event) => {
  if (contextMenu.value.visible && !event.target.closest('.task-context-menu')) {
    hideContextMenu()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && contextMenu.value.visible) hideContextMenu()
})

// ---- Drag and drop ----
const draggingId = ref(null)
const dragTargetId = ref(null)
const dragOver = ref(false)

function onDragStart(event, taskId) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-deepstudy-daily-task', taskId)
  draggingId.value = taskId
}

function onDragEnd() {
  draggingId.value = null
  dragTargetId.value = null
  dragOver.value = false
}

function onDragOver(event) {
  const types = Array.from(event.dataTransfer.types || [])
  if (!types.includes('application/x-deepstudy-daily-task')) return
  event.dataTransfer.dropEffect = 'move'
  dragOver.value = true
}

function onDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    dragOver.value = false
    dragTargetId.value = null
  }
}

function onDragOverItem(taskId) {
  if (taskId !== draggingId.value) {
    dragTargetId.value = taskId
  }
}

function onDragLeaveItem() {
  dragTargetId.value = null
}

async function onDrop(event) {
  dragOver.value = false
  const taskId = event.dataTransfer.getData('application/x-deepstudy-daily-task')
  if (!taskId) return
  const beforeId = dragTargetId.value || ''
  dragTargetId.value = null
  draggingId.value = null
  if (taskId === beforeId) return
  const ordered = [...store.orderedTasks]
  const movingIdx = ordered.findIndex(t => t.id === taskId)
  const beforeIdx = beforeId ? ordered.findIndex(t => t.id === beforeId) : ordered.length
  if (movingIdx < 0) return
  const [moving] = ordered.splice(movingIdx, 1)
  const insertAt = beforeIdx > movingIdx ? beforeIdx - 1 : beforeIdx
  ordered.splice(insertAt, 0, moving)
  const orderedIds = ordered.map(t => t.id)
  await store.reorderTasks(orderedIds)
}

// ---- Planner Chat ----
const chatOpen = ref(false)
const chatBusy = ref(false)
const chatMessages = ref([])
const chatInput = ref('')
const configStatus = ref('正在读取 API 配置…')

function toggleChat() {
  chatOpen.value = !chatOpen.value
  if (chatOpen.value) {
    nextTick(() => {
      document.getElementById('planner-input')?.focus()
    })
  }
}

function newChat() {
  if (chatBusy.value) return
  chatMessages.value = []
}

function scrollMessagesToBottom() {
  nextTick(() => {
    const el = document.getElementById('planner-messages')
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function sendChatMessage() {
  const message = chatInput.value.trim()
  if (!message || chatBusy.value) return
  chatBusy.value = true
  chatMessages.value.push({ role: 'user', content: message })
  chatInput.value = ''
  scrollMessagesToBottom()
  try {
    const history = chatMessages.value
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content }))
    const reply = await api.plannerChat({
      message,
      date: todayKey(),
      history
    })
    const content = String(reply.content || reply || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim()
    chatMessages.value.push({ role: 'assistant', content })
    scrollMessagesToBottom()
    // Parse plan items from AI response
    const planItems = parsePlanItems(content)
    const itemsToAdd = planItems.length ? planItems : fallbackPlanItemsFromText(message)
    if (itemsToAdd.length) {
      // Add each item as a task
      let addedCount = 0
      for (const item of itemsToAdd) {
        const text = item.replace(/^\[PRIORITY\]\s*/i, '').trim()
        if (text) {
          await store.addTask({ text, priority: /^\[PRIORITY\]/i.test(item) })
          addedCount++
        }
      }
      if (addedCount > 0) {
        chatMessages.value.push({
          role: 'system',
          content: `已添加 ${addedCount} 项到今日计划。`
        })
        scrollMessagesToBottom()
      }
    }
  } catch (error) {
    chatMessages.value.push({
      role: 'system',
      content: `AI 模型暂不可用：${error.message}`
    })
    scrollMessagesToBottom()
  } finally {
    chatBusy.value = false
  }
}

function parsePlanItems(content) {
  const source = String(content || '')
  const marker = source.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?PLAN_ITEMS\s*[:：]?(?:\*\*)?\s*\n([\s\S]*)$/i
  )
  const candidate = marker
    ? marker[1]
    : source
        .split('\n')
        .filter(line => /\[PRIORITY\]/i.test(line))
        .join('\n')
  return candidate
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*•]|^\d+[.)]/.test(line))
    .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, ''))
    .map(line => line.replace(/^\*\*(\[PRIORITY\])\*\*/i, '$1'))
    .map(line => line.trim())
    .filter(item => {
      const text = String(item || '').replace(/^\[PRIORITY\]\s*/i, '').trim()
      if (text.length < 2) return false
      if (/^[\s[\]{}()（）,，.。:：;；'"`-]+$/.test(text)) return false
      if (/^(null|undefined|none|无)$/i.test(text)) return false
      return /[\p{L}\p{N}]/u.test(text)
    })
}

function fallbackPlanItemsFromText(text) {
  const source = String(text || '').trim()
  if (!source) return []
  const segments = source
    .replace(/然后再/g, '然后')
    .split(/(?:，|,|。|；|;|\n|然后|再|接着|之后|并且|同时)+/g)
    .map(cleanFallbackTask)
    .filter(item => {
      const text = String(item || '').replace(/^\[PRIORITY\]\s*/i, '').trim()
      if (text.length < 2) return false
      if (/^[\s[\]{}()（）,，.。:：;；'"`-]+$/.test(text)) return false
      if (/^(null|undefined|none|无)$/i.test(text)) return false
      return /[\p{L}\p{N}]/u.test(text)
    })
  return [...new Set(segments)].slice(0, 8)
}

function cleanFallbackTask(segment) {
  let text = String(segment || '')
    .replace(/\s+/g, ' ')
    .replace(/^(我)?(今天|今日)?(先)?/g, '')
    .replace(/^(先|然后|再|接着|之后|并且|同时)/g, '')
    .replace(/^(去|去一趟|做一下)/g, '')
    .replace(/^把(.+?)(过完|看完|整理完|处理完)$/g, '$2$1')
    .replace(/^把/g, '')
    .replace(/看个/g, '看')
    .trim()
  text = text.replace(/[，。,.；;：:、]+$/g, '').trim()
  if (/^(我|今天|今日|安排|计划|任务)$/.test(text)) return ''
  return text.slice(0, 80)
}

// Fetch AI config status
async function fetchConfigStatus() {
  try {
    const config = await api.getAiConfig('planner')
    const model = config?.api?.model || config?.model || '未配置'
    configStatus.value = `${model} · API 运行`
  } catch {
    configStatus.value = 'API 配置读取失败'
  }
}

// Lifecycle
onMounted(async () => {
  try {
    await store.fetchTasks(todayKey())
  } catch {
    // handled by interceptor
  }
  fetchConfigStatus()
})
</script>

<style scoped>
/* === Core sidebar layout === */
#daily-plan-sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  padding: 18px;
  background-color: var(--sidebar);
  background-image:
    repeating-linear-gradient(0deg, rgba(75, 104, 87, 0.018) 0, rgba(75, 104, 87, 0.018) 1px, transparent 1px, transparent 5px),
    linear-gradient(145deg, rgba(255, 255, 255, 0.22), transparent 52%);
  border-right: 1px solid var(--border);
}

/* === Heading === */
.sidebar-heading,
.chat-header,
.card-title-row,
.section-header,
.reflection-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.eyebrow {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--accent-hover);
  font-weight: 800;
}

.sidebar-heading h1 {
  font-size: 21px;
  margin: 0;
  line-height: 1.2;
}

.sidebar-heading-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sidebar-heading-actions .icon-btn {
  padding: 0 8px;
  font-size: 12px;
}

/* === Icon buttons === */
.icon-btn {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
}

.icon-btn.compact {
  width: 34px;
  padding: 0;
}

.icon-btn:hover,
.icon-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.icon-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

/* === Date === */
.plan-date,
.subtle {
  color: var(--text-muted);
  font-size: 13px;
}

/* === Quick add === */
.quick-add {
  display: grid;
  grid-template-columns: 1fr;
}

.quick-add input,
.sidebar-input {
  min-width: 0;
  padding: 0 10px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
}

.quick-add input:focus,
.sidebar-input:focus {
  outline: none;
  border-color: var(--accent);
}

/* === Plan list wrapper === */
.plan-list-wrap {
  flex: 1;
  min-height: 72px;
  max-height: 154px;
  overflow: auto;
  border-radius: var(--radius);
}

.plan-list-wrap.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: 3px;
}

#plan-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.empty {
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  margin: 0;
}

/* === Plan item === */
.plan-item {
  display: grid;
  grid-template-columns: 18px 1fr 26px;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-left: 4px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  cursor: grab;
  transition: transform var(--transition), box-shadow var(--transition);
}

.plan-item.dragging {
  opacity: 0.55;
  box-shadow: 0 8px 22px rgba(44, 62, 56, 0.14);
}

.plan-item.drag-over {
  transform: translateY(1px);
}

.plan-item.priority {
  border-left-color: var(--plan);
  background: #fffaf0;
}

.plan-item.completed {
  opacity: 0.55;
}

/* === Drag handle === */
.task-drag-handle {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--text-dim);
  cursor: grab;
  user-select: none;
}

.task-drag-handle:hover {
  color: var(--accent-hover);
}

.task-drag-handle::before {
  content: "\22EE\22EE";
  letter-spacing: -1px;
  font-size: 11px;
  line-height: 1;
}

/* === Task check === */
.plan-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
}

.plan-check input {
  margin-top: 3px;
  accent-color: var(--accent);
}

.plan-check span {
  overflow-wrap: anywhere;
}

.plan-item.completed .plan-check span {
  text-decoration: line-through;
}

/* === Priority star === */
.priority-star {
  margin-right: 4px;
  color: #d59b22;
}

/* === Remove button === */
.task-remove {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 17px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--transition);
}

.task-remove:hover {
  color: var(--red);
}

/* === Context menu === */
.task-context-menu {
  position: fixed;
  z-index: 100;
  min-width: 150px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: white;
  box-shadow: var(--shadow);
}

.task-context-menu button {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  border: none;
  background: transparent;
  text-align: left;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.task-context-menu button:hover {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

/* === Sidebar actions === */
.sidebar-actions {
  display: flex;
  gap: 7px;
}

.ghost-btn {
  height: 32px;
  padding: 0 9px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  color: var(--text);
  transition: all var(--transition);
}

.ghost-btn:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.ghost-btn.danger:hover {
  border-color: var(--red);
  color: var(--red);
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* === Planner chat === */
.planner-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 48vh;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.chat-header-actions {
  display: flex;
  gap: 6px;
}

.planner-messages {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 70px;
  overflow: auto;
  max-height: 300px;
}

.chat-message {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.chat-message.user {
  align-self: flex-end;
  background: var(--accent-soft);
}

.chat-message.system {
  color: var(--text-muted);
  border: 1px dashed var(--border);
}

/* === Planner form === */
.planner-form {
  display: grid;
  gap: 7px;
}

.planner-form textarea {
  padding: 9px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 13px;
  background: var(--surface);
  color: var(--text);
  min-height: 60px;
}

.planner-form textarea:focus {
  outline: none;
  border-color: var(--accent);
}

/* === Primary button === */
.primary-btn,
.danger-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  border: none;
  color: white;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition);
}

.primary-btn.compact,
.secondary-btn.compact {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

.primary-btn {
  background: var(--green);
}

.primary-btn:hover {
  background: var(--green-hover);
}

.danger-btn {
  background: var(--red);
}

.danger-btn:hover {
  background: var(--red-hover);
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
}

/* === Reset Confirm Modal === */
.reset-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.reset-confirm-modal {
  padding: 22px 26px;
  border-radius: var(--radius);
  background: white;
  box-shadow: var(--shadow);
  text-align: center;
}

.reset-confirm-modal p {
  margin: 0 0 16px;
  font-size: 15px;
  color: var(--text);
}

.reset-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

/* Plan item placeholder */
.plan-item-placeholder {
  height: 46px;
  margin: 0;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: var(--accent-soft);
  opacity: 0.7;
  pointer-events: none;
  list-style: none;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

@media (max-width: 760px) {
  #daily-plan-sidebar {
    display: grid;
    grid-template-columns: minmax(150px, 0.85fr) minmax(0, 1.15fr);
    grid-template-rows: auto auto auto minmax(0, auto);
    grid-template-areas:
      "heading list"
      "add list"
      "actions list"
      "chat chat";
    align-items: start;
    gap: 7px 10px;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-heading {
    grid-area: heading;
    gap: 8px;
  }

  .sidebar-heading h1 {
    font-size: 18px;
  }

  .plan-date {
    display: none;
  }

  .quick-add {
    grid-area: add;
    min-width: 0;
  }

  .quick-add input,
  .sidebar-input {
    height: 32px;
  }

  .plan-list-wrap {
    grid-area: list;
    min-height: 82px;
  }

  .sidebar-actions {
    grid-area: actions;
    align-self: start;
    min-width: 0;
    flex-wrap: wrap;
  }

  .sidebar-actions .ghost-btn {
    flex: 1 1 70px;
    min-width: 0;
  }

  .planner-chat {
    grid-area: chat;
    min-height: 0;
    max-height: min(34vh, 220px);
    overflow: hidden;
  }
}

@media (max-width: 460px) {
  #daily-plan-sidebar {
    grid-template-columns: 1fr;
    grid-template-areas:
      "heading"
      "add"
      "actions"
      "list"
      "chat";
  }

  .plan-list-wrap {
    min-height: 72px;
  }

  .planner-chat {
    max-height: min(38vh, 240px);
  }
}
</style>
