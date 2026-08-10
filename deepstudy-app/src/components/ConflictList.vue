<script setup lang="ts">
import type { SyncConflictRecord, SyncRecordEnvelope } from '../data/syncRepository'

defineProps<{
  conflicts: SyncConflictRecord[]
  busyId: string | null
}>()

const emit = defineEmits<{
  resolve: [id: string, resolution: 'keep_local' | 'keep_remote']
}>()

function recordTitle(record: SyncRecordEnvelope | null) {
  if (!record) return '云端已不存在此项目'
  const title = record.payload.title
    ?? record.payload.text
    ?? record.payload.content
    ?? record.payload.workType
    ?? record.payload.state
    ?? record.payload.category
    ?? record.entityId
  return String(title)
}

function readable(value: unknown) {
  return value === undefined || value === null || value === '' ? null : String(value)
}

function duration(record: SyncRecordEnvelope) {
  const milliseconds = Number(record.payload.durationMs)
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return `${Math.round(milliseconds / 60_000)} 分钟`
  }
  const minutes = Number(record.payload.durationMinutes)
  return Number.isFinite(minutes) && minutes >= 0 ? `${minutes} 分钟` : null
}

function recordDetails(record: SyncRecordEnvelope | null) {
  if (!record) return ['保留云端会删除本机项目']
  const payload = record.payload
  const values: Array<string | null> = []
  const categories: Record<string, string> = {
    core: '核心工作', maintenance: '维持工作', rest: '休息', distraction: '分心',
  }
  switch (record.entityType) {
    case 'daily_task':
      values.push(readable(payload.title ?? payload.text), readable(payload.notes ?? payload.note), readable(payload.priority), readable(payload.plannedAt))
      break
    case 'long_task':
      values.push(readable(payload.notes ?? payload.note), readable(payload.quadrantId), readable(payload.plannedAt))
      break
    case 'focus_session':
      values.push(
        categories[String(payload.workType)] ?? readable(payload.workType ?? payload.title),
        duration(record),
        readable(payload.startedAt ?? payload.start),
      )
      break
    case 'mode_event': {
      const modes: Record<string, string> = { focus: '专注', rest: '休息' }
      const actions: Record<string, string> = { started: '开始', paused: '暂停', resumed: '继续', completed: '完成' }
      const mode = readable(payload.mode)
      const action = readable(payload.action)
      values.push(
        mode ? (modes[mode] ?? mode) : null,
        action ? (actions[action] ?? action) : null,
        readable(payload.state),
        readable(payload.occurredAt ?? payload.timestamp),
      )
      break
    }
    case 'time_audit':
      values.push(
        categories[String(payload.category)] ?? readable(payload.category ?? payload.title),
        duration(record),
        readable(payload.start),
        readable(payload.notes ?? payload.note),
      )
      break
    case 'distraction':
      values.push(
        readable(payload.content ?? payload.text ?? payload.title),
        duration(record),
        readable(payload.occurredAt ?? payload.timestamp),
        readable(payload.trigger ?? payload.control),
      )
      break
    case 'reflection':
      values.push(readable(payload.content ?? payload.title), readable(payload.date), readable(payload.notes ?? payload.note))
      break
    case 'soul_quote':
      values.push(readable(payload.text ?? payload.content ?? payload.title), readable(payload.source), readable(payload.createdAt))
      break
  }
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function safeJson(record: SyncRecordEnvelope | null) {
  if (!record) return '{\n  "deleted": true\n}'
  try {
    return JSON.stringify({
      payload: record.payload,
      deleted: record.deleted,
      revision: record.revision,
      updatedAt: record.serverUpdatedAt ?? record.clientUpdatedAt,
    }, null, 2)
  } catch {
    return '数据包含无法格式化的内容'
  }
}
</script>

<template>
  <section class="conflict-section" aria-labelledby="conflict-title">
    <header>
      <div>
        <h2 id="conflict-title">需要你选择</h2>
        <p>冲突不会自动覆盖。比较两个版本后再决定。</p>
      </div>
      <span>{{ conflicts.length }}</span>
    </header>
    <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-card">
      <div class="conflict-kind">{{ conflict.entityType }} · {{ conflict.entityId }}</div>
      <p v-if="conflict.status === 'resolving'" class="resolution-pending">
        上次“{{ conflict.resolution === 'keep_local' ? '保留本机' : '保留云端' }}”的响应中断，请重试确认结果。
      </p>
      <p v-else-if="conflict.reconciledGatewayStatus" class="resolution-pending">
        云端已由其他操作更新。本机修改仍保留，请比较最新版本后重新选择。
      </p>
      <div class="version-grid">
        <section>
          <small>本机版本</small>
          <strong>{{ recordTitle(conflict.local) }}</strong>
          <ul v-if="recordDetails(conflict.local).length">
            <li v-for="detail in recordDetails(conflict.local)" :key="detail">{{ detail }}</li>
          </ul>
          <details>
            <summary>查看完整数据</summary>
            <pre>{{ safeJson(conflict.local) }}</pre>
          </details>
        </section>
        <section>
          <small>云端版本</small>
          <strong>{{ recordTitle(conflict.remote) }}</strong>
          <ul v-if="recordDetails(conflict.remote).length">
            <li v-for="detail in recordDetails(conflict.remote)" :key="detail">{{ detail }}</li>
          </ul>
          <details>
            <summary>查看完整数据</summary>
            <pre>{{ safeJson(conflict.remote) }}</pre>
          </details>
        </section>
      </div>
      <div class="conflict-actions">
        <button
          data-testid="keep-remote"
          type="button"
          :disabled="busyId === conflict.id || (conflict.status === 'resolving' && conflict.resolution !== 'keep_remote')"
          @click="emit('resolve', conflict.id, 'keep_remote')"
        >保留云端</button>
        <button
          class="primary"
          data-testid="keep-local"
          type="button"
          :disabled="busyId === conflict.id || (conflict.status === 'resolving' && conflict.resolution !== 'keep_local')"
          @click="emit('resolve', conflict.id, 'keep_local')"
        >保留本机</button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.conflict-section {
  margin-top: 0.9rem;
}

.conflict-section > header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.65rem;
}

.conflict-section h2,
.conflict-section header p {
  margin: 0;
}

.conflict-section h2 {
  font-size: 1.05rem;
}

.conflict-section header p {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 0.15rem;
}

.conflict-section header > span {
  background: #fff0f1;
  border-radius: 999px;
  color: #b4232c;
  font-size: 0.78rem;
  font-weight: 750;
  padding: 0.3rem 0.55rem;
}

.conflict-card {
  background: var(--surface);
  border: 1px solid #f0cfd2;
  border-radius: 1.1rem;
  margin-top: 0.65rem;
  padding: 0.9rem;
}

.conflict-kind {
  color: var(--text-muted);
  font-size: 0.7rem;
  overflow-wrap: anywhere;
}

.resolution-pending {
  background: #fff8e6;
  border-radius: 0.6rem;
  color: #7a4b00;
  font-size: 0.7rem;
  line-height: 1.4;
  margin: 0.45rem 0 0;
  padding: 0.45rem 0.55rem;
}

.version-grid {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0.65rem;
}

.version-grid section {
  background: var(--surface-muted);
  border-radius: 0.8rem;
  min-width: 0;
  padding: 0.7rem;
}

.version-grid small,
.version-grid strong,
.version-grid p {
  display: block;
}

.version-grid small {
  color: var(--text-muted);
  font-size: 0.68rem;
}

.version-grid strong {
  font-size: 0.82rem;
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
}

.version-grid ul {
  color: var(--text-muted);
  font-size: 0.7rem;
  line-height: 1.4;
  margin: 0.35rem 0 0;
  padding-left: 1rem;
}

.version-grid details {
  color: var(--text-muted);
  font-size: 0.68rem;
  margin-top: 0.45rem;
}

.version-grid summary {
  cursor: pointer;
}

.version-grid pre {
  background: var(--surface);
  border-radius: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.62rem;
  line-height: 1.35;
  margin: 0.35rem 0 0;
  max-height: 12rem;
  overflow: auto;
  padding: 0.45rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.conflict-actions {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(2, 1fr);
  margin-top: 0.75rem;
}

.conflict-actions button {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  min-height: 2.7rem;
}

.conflict-actions button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.conflict-actions button:disabled {
  opacity: 0.5;
}
</style>
