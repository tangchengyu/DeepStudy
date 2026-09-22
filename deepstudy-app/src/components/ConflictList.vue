<script setup lang="ts">
import type { SyncConflictRecord, SyncRecordEnvelope } from '../data/syncRepository'

defineProps<{
  conflicts: SyncConflictRecord[]
  busyId: string | null
}>()

const emit = defineEmits<{
  resolve: [id: string, resolution: 'keep_local' | 'keep_remote']
  resolveAll: [resolution: 'keep_local' | 'keep_remote']
}>()

const IGNORED_PAYLOAD_FIELDS = new Set(['updatedAt', 'clientUpdatedAt', 'serverUpdatedAt'])

function comparableRecord(record: SyncRecordEnvelope | null) {
  if (!record) return { deleted: true, payload: null }
  return {
    deleted: Boolean(record.deleted),
    payload: Object.fromEntries(
      Object.entries(record.payload).filter(([key]) => !IGNORED_PAYLOAD_FIELDS.has(key)),
    ),
  }
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameContent(conflict: SyncConflictRecord) {
  return stableValue(comparableRecord(conflict.local)) === stableValue(comparableRecord(conflict.remote))
}

type FlatRecord = Record<string, unknown>

function flatten(value: unknown, prefix = '', output: FlatRecord = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length) {
      for (const [key, item] of entries) flatten(item, prefix ? `${prefix}.${key}` : key, output)
      return output
    }
  }
  output[prefix || '值'] = value
  return output
}

const FIELD_LABELS: Record<string, string> = {
  deleted: '删除状态', title: '标题', text: '文本', content: '内容', notes: '备注', note: '备注',
  workType: '工作类型', category: '类别', state: '状态', date: '日期', priority: '优先级',
  durationMs: '时长（毫秒）', durationMinutes: '时长（分钟）', plannedAt: '计划时间',
  startedAt: '开始时间', start: '开始时间', occurredAt: '发生时间', timestamp: '发生时间',
}

function fieldLabel(path: string) {
  const field = path.replace(/^payload\./, '')
  return FIELD_LABELS[field] ?? field.replaceAll('.', ' › ')
}

function displayValue(value: unknown) {
  if (value === undefined) return '（无此字段）'
  if (value === null || value === '') return '（空）'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function changedFields(conflict: SyncConflictRecord) {
  const local = flatten(comparableRecord(conflict.local))
  const remote = flatten(comparableRecord(conflict.remote))
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .filter((path) => stableValue(local[path]) !== stableValue(remote[path]))
    .map((path) => ({ path, label: fieldLabel(path), local: local[path], remote: remote[path] }))
}

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
    <div class="bulk-actions" aria-label="批量处理冲突">
      <button
        data-testid="keep-all-remote"
        type="button"
        :disabled="busyId !== null || conflicts.length === 0"
        @click="emit('resolveAll', 'keep_remote')"
      >全部使用云端</button>
      <button
        class="primary"
        data-testid="keep-all-local"
        type="button"
        :disabled="busyId !== null || conflicts.length === 0"
        @click="emit('resolveAll', 'keep_local')"
      >全部使用本机</button>
    </div>
    <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-card">
      <div class="conflict-kind">{{ conflict.entityType }} · {{ conflict.entityId }}</div>
      <p v-if="conflict.status === 'resolving'" class="resolution-pending">
        上次“{{ conflict.resolution === 'keep_local' ? '保留本机' : '保留云端' }}”的响应中断，请重试确认结果。
      </p>
      <p v-else-if="conflict.reconciledGatewayStatus" class="resolution-pending">
        云端已由其他操作更新。本机修改仍保留，请比较最新版本后重新选择。
      </p>
      <p v-if="sameContent(conflict)" class="same-content">
        内容相同，仅同步版本信息不同。任选一项都不会改变实际内容。
      </p>
      <div v-else class="field-diff" aria-label="不同字段">
        <div class="diff-heading" aria-hidden="true">
          <span>不同字段</span><span>本机</span><span>云端</span>
        </div>
        <div v-for="field in changedFields(conflict)" :key="field.path" class="diff-row">
          <strong>{{ field.label }}</strong>
          <span>{{ displayValue(field.local) }}</span>
          <span>{{ displayValue(field.remote) }}</span>
        </div>
      </div>
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

.bulk-actions {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(2, 1fr);
}

.bulk-actions button,
.conflict-actions button {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  min-height: 2.7rem;
}

.bulk-actions button.primary,
.conflict-actions button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.bulk-actions button:disabled,
.conflict-actions button:disabled {
  opacity: 0.5;
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

.same-content {
  background: #eef8f2;
  border-radius: 0.65rem;
  color: #276444;
  font-size: 0.72rem;
  line-height: 1.45;
  margin: 0.6rem 0 0;
  padding: 0.55rem 0.65rem;
}

.field-diff {
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  margin-top: 0.65rem;
  overflow: hidden;
}

.diff-heading,
.diff-row {
  display: grid;
  gap: 0.35rem;
  grid-template-columns: minmax(4.2rem, 0.75fr) repeat(2, minmax(0, 1fr));
  padding: 0.5rem 0.6rem;
}

.diff-heading {
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 0.65rem;
}

.diff-row {
  border-top: 1px solid var(--border-soft);
  font-size: 0.7rem;
  line-height: 1.4;
}

.diff-row strong,
.diff-row span {
  overflow-wrap: anywhere;
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

@media (max-width: 390px) {
  .diff-heading,
  .diff-row {
    grid-template-columns: minmax(3.5rem, 0.65fr) repeat(2, minmax(0, 1fr));
    padding-inline: 0.45rem;
  }
}
</style>
