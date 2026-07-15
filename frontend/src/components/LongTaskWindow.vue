<template>
  <div class="long-task-window">
    <div class="window-header">
      <h2 class="window-title">长期任务管理</h2>
      <div class="window-actions">
        <el-button type="primary" :icon="Refresh" @click="refreshTasks" size="small">
          刷新
        </el-button>
        <el-button type="success" :icon="CirclePlus" @click="showAddTaskDialog = true" size="small">
          添加任务
        </el-button>
      </div>
    </div>

    <div class="quadrants-grid">
      <div v-for="(quadrant, key) in quadrantMeta" :key="key" class="quadrant">
        <div class="quadrant-header" :style="{ background: quadrant.color + '20', borderBottomColor: quadrant.color }">
          <h3 :style="{ color: quadrant.color }">{{ quadrant.label }}</h3>
          <p class="quadrant-subtitle">{{ quadrant.subtitle }}</p>
        </div>

        <div class="quadrant-body">
          <div v-for="task in tasksByQuadrant[key]" :key="task.id" class="task-card" :class="{ 'task-card-completed': task.status === 'completed' }">
            <div class="task-card-header">
              <el-checkbox v-model="task.completed" @change="toggleTaskCompletion(task)" />
              <span class="task-card-title">{{ task.title }}</span>
              <el-tooltip content="AI 辅助" placement="top">
                <el-button :icon="Star" @click="showAiAssistant(task)" size="small" class="ai-btn" :disabled="aiLoading" />
              </el-tooltip>
              <el-dropdown trigger="click">
                <span class="dropdown-label">
                  <el-icon><More /></el-icon>
                </span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="editTask(task)">编辑</el-dropdown-item>
                    <el-dropdown-item @click="deleteTask(task)" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <div class="task-card-content" v-if="!task.completed || showCompletedToggle">
              <div class="task-card-description" v-if="task.description">
                {{ task.description }}
              </div>
              <div class="task-card-footer">
                <el-tag :type="getQuadrantType(task.quadrant)" size="small">
                  {{ task.quadrant ? quadrantMeta[task.quadrant].label : '' }}
                </el-tag>
                <span class="task-card-time">{{ formatDate(task.createdAt) }}</span>
              </div>
            </div>
          </div>

          <div v-if="tasksByQuadrant[key].length === 0" class="empty-quadrant">
            暂无任务
          </div>
        </div>
      </div>
    </div>

    <!-- Add Task Dialog -->
    <el-dialog v-model="showAddTaskDialog" title="添加长期任务" width="500px">
      <el-form :model="newTask" label-width="100px">
        <el-form-item label="标题" required>
          <el-input v-model="newTask.title" placeholder="请输入任务标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newTask.description" type="textarea" rows="3" placeholder="请输入任务描述（可选）" maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item label="象限">
          <el-radio-group v-model="newTask.quadrant">
            <el-radio-button v-for="(meta, qKey) in quadrantMeta" :key="qKey" :value="qKey" :label="qKey">
              {{ meta.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="优先级">
          <el-switch v-model="newTask.priority" active-text="高" inactive-text="普通" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddTaskDialog = false">取消</el-button>
        <el-button type="primary" @click="handleAddTask">确定</el-button>
      </template>
    </el-dialog>

    <!-- Edit Task Dialog -->
    <el-dialog v-model="showEditTaskDialog" title="编辑任务" width="500px">
      <el-form :model="editTaskData" label-width="100px">
        <el-form-item label="标题" required>
          <el-input v-model="editTaskData.title" placeholder="请输入任务标题" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editTaskData.description" type="textarea" rows="3" placeholder="请输入任务描述（可选）" maxlength="300" show-word-limit />
        </el-form-item>
        <el-form-item label="象限">
          <el-radio-group v-model="editTaskData.quadrant">
            <el-radio-button v-for="(meta, qKey) in quadrantMeta" :key="qKey" :value="qKey" :label="qKey">
              {{ meta.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="优先级">
          <el-switch v-model="editTaskData.priority" active-text="高" inactive-text="普通" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditTaskDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpdateTask">确定修改</el-button>
      </template>
    </el-dialog>

    <!-- AI Assistant Dialog -->
    <el-dialog v-model="showAiDialog" :title="aiDialogTitle" width="560px">
      <div class="ai-chat-box">
        <div class="ai-chat-messages" ref="chatBoxRef">
          <div v-for="(msg, idx) in aiMessages" :key="idx" class="ai-msg" :class="msg.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'">
            <span>{{ msg.content }}</span>
          </div>
        </div>
        <div class="ai-chat-input-row">
          <el-input v-model="aiInput" placeholder="向 AI 助手提问..." @keyup.enter.prevent="handleAiSend" :disabled="aiLoading" />
          <el-button type="primary" :icon="Position" :loading="aiLoading" @click="handleAiSend">发送</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useLongTaskStore } from '@/stores/longTask'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, CirclePlus, Star, Position, More } from '@element-plus/icons-vue'
import { QUADRANT_META } from '@/utils/constants'

const longTaskStore = useLongTaskStore()

// -- 常量 --
const quadrantMeta = computed(() => QUADRANT_META)

// -- 表单状态 --
const newTask = reactive({
  title: '',
  description: '',
  quadrant: 'important-not-urgent',
  priority: false,
})

const editTaskData = reactive({
  id: null,
  title: '',
  description: '',
  quadrant: 'important-not-urgent',
  priority: false,
})

// -- 对话框状态 --
const showAddTaskDialog = ref(false)
const showEditTaskDialog = ref(false)
const showAiDialog = ref(false)
const showCompletedToggle = ref(false)

// -- AI 状态 --
const aiDialogTitle = computed(() => {
  const t = longTaskStore.tasks.find(t => t.id === currentAiTaskId)
  return t ? `AI 助手 — ${t.title}` : 'AI 助手'
})
const currentAiTaskId = ref(null)
const aiMessages = reactive([])
const aiInput = ref('')
const aiLoading = ref(false)
const chatBoxRef = ref(null)

// ======= 生命周期 =======
onMounted(() => {
  longTaskStore.fetchTasks()
})

// ======= 计算属性 =======
const tasksByQuadrant = computed(() => {
  const grouped = {
    'important-urgent': [],
    'important-not-urgent': [],
    'urgent-not-important': [],
    'not-important-not-urgent': [],
  }
  for (const task of longTaskStore.tasks) {
    if (grouped[task.quadrant]) {
      grouped[task.quadrant].push(task)
    }
  }
  return grouped
})

// ======= 方法 =======
function getQuadrantType(quadrant) {
  const map = {
    'important-urgent': 'danger',
    'important-not-urgent': 'warning',
    'urgent-not-important': 'info',
    'not-important-not-urgent': 'success',
  }
  return map[quadrant] || 'info'
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function resetNewTaskForm() {
  newTask.title = ''
  newTask.description = ''
  newTask.quadrant = 'important-not-urgent'
  newTask.priority = false
}

function resetEditTaskForm() {
  editTaskData.id = null
  editTaskData.title = ''
  editTaskData.description = ''
  editTaskData.quadrant = 'important-not-urgent'
  editTaskData.priority = false
}

// 添加任务
async function handleAddTask() {
  if (!newTask.title.trim()) {
    ElMessage.warning('请输入任务标题')
    return
  }
  await longTaskStore.createTask({ ...newTask })
  resetNewTaskForm()
  showAddTaskDialog.value = false
}

// 编辑任务
async function handleUpdateTask() {
  if (!editTaskData.title.trim()) {
    ElMessage.warning('请输入任务标题')
    return
  }
  await longTaskStore.updateTask(editTaskData.id, { ...editTaskData })
  resetEditTaskForm()
  showEditTaskDialog.value = false
}

// 删除任务
async function deleteTask(task) {
  try {
    await ElMessageBox.confirm(`确定删除任务「${task.title}」吗？`, '确认删除', { type: 'warning' })
    await longTaskStore.deleteTask(task.id)
  } catch (e) {
    // 用户取消删除
  }
}

// 切换完成状态
async function toggleTaskCompletion(task) {
  task.completed = !task.completed
  await longTaskStore.updateTask(task.id, { completed: task.completed })
}

// 编辑入口
function editTask(task) {
  editTaskData.id = task.id
  editTaskData.title = task.title
  editTaskData.description = task.description || ''
  editTaskData.quadrant = task.quadrant
  editTaskData.priority = task.priority || false
  showEditTaskDialog.value = true
}

// 拖拽排序
async function handleDragEnd({ fromIndex, toIndex }) {
  // 简单更新顺序
  await longTaskStore.reorderTasks(longTaskStore.tasks.map((t, i) => ({ id: t.id, order: i })))
}

// AI 聊天
async function showAiAssistant(task) {
  currentAiTaskId.value = task.id
  aiMessages.length = 0
  aiInput.value = ''
  aiMessages.push({ role: 'assistant', content: `我已了解任务「${task.title}」。请告诉我您需要什么帮助？` })
  showAiDialog.value = true
  await nextTick()
  scrollChatBox()
}

async function handleAiSend() {
  if (!aiInput.value.trim() || aiLoading.value) return
  const text = aiInput.value.trim()
  aiMessages.push({ role: 'user', content: text })
  aiInput.value = ''
  aiLoading.value = true
  try {
    const result = await longTaskStore.plannerChat(text)
    aiMessages.push({ role: 'assistant', content: result ? result.reply : 'AI 回复为空' })
  } catch (e) {
    ElMessage.error('AI 助手响应失败')
  } finally {
    aiLoading.value = false
    await nextTick()
    scrollChatBox()
  }
}

function scrollChatBox() {
  const box = chatBoxRef.value
  if (box) box.scrollTop = box.scrollHeight
}

function refreshTasks() {
  longTaskStore.fetchTasks()
}
</script>

<style scoped>
.long-task-window {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg);
  background-image: repeating-linear-gradient(0deg, rgba(80, 104, 91, 0.016) 0, rgba(80, 104, 91, 0.016) 1px, transparent 1px, transparent 4px);
}

/* 窗口头部 */
.window-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.window-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.window-actions {
  display: flex;
  gap: 8px;
}

/* 四象限网格 */
.quadrants-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
  flex: 1;
  min-height: 0;
}

/* 单个象限 */
.quadrant {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.quadrant-header {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius) var(--radius) 0 0;
}

.quadrant-header h3 {
  margin: 0 0 2px 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.quadrant-subtitle {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.quadrant-body {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
  min-height: 0;
}

/* 任务卡片 */
.task-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  background: var(--surface);
  transition: box-shadow 0.2s;
}

.task-card:hover {
  box-shadow: 0 2px 8px rgba(57, 78, 67, 0.055);
}

.task-card-completed .task-card-title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.task-card-completed {
  opacity: 0.65;
}

.task-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
}

.task-card-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 0.9rem;
}

.dropdown-label {
  cursor: pointer;
  display: flex;
  align-items: center;
  padding: 2px 4px;
  border-radius: 4px;
}

.dropdown-label:hover {
  background: var(--surface-3);
}

.ai-btn {
  color: var(--accent);
}

.task-card-content {
  padding: 8px 10px 10px;
  border-top: 1px dashed var(--border);
}

.task-card-description {
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.5;
  margin-bottom: 6px;
}

.task-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.task-card-time {
  font-size: 0.72rem;
}

.empty-quadrant {
  text-align: center;
  color: var(--text-muted);
  padding: 40px 0;
  font-size: 0.85rem;
}

/* AI 对话框 */
.ai-chat-box {
  display: flex;
  flex-direction: column;
  height: 360px;
}

.ai-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 10px;
  line-height: 1.5;
  font-size: 0.9rem;
}

.ai-msg-user {
  align-self: flex-end;
  background: var(--accent);
  color: white;
}

.ai-msg-assistant {
  align-self: flex-start;
  background: var(--surface-3);
}

.ai-chat-input-row {
  display: flex;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

/* 拖拽占位 */
.sortable-ghost {
  opacity: 0.4;
}

/* 响应式 */
@media (max-width: 768px) {
  .quadrants-grid {
    grid-template-columns: 1fr;
  }
}
</style>
