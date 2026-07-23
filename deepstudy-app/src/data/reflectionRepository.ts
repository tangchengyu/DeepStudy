import type { InjectionKey } from 'vue'
import {
  createSyncRepository,
  syncDatabase,
  syncScopeController,
  type SyncDatabase,
  type SyncMutationInput,
  type SyncPayload,
  type SyncRepository,
  type SyncRepositoryOptions,
} from './syncRepository'

export type AuditCategory = 'core' | 'maintenance' | 'rest' | 'distraction'

export interface AuditTotals {
  core: number
  maintenance: number
  rest: number
  distraction: number
}

export interface AuditSummary {
  today: AuditTotals
  sevenDays: AuditTotals
}

export interface ReflectionEntry extends SyncPayload {
  entityId: string
  id: string
  date: string
  content: string
  kind: string
  updatedAt: number
  sourceTaskId?: string
  sourceTaskIds?: string[]
}

export interface ReflectionDateGroup {
  date: string
  entries: ReflectionEntry[]
}

export interface CompletedTaskReflectionInput {
  sourceType: 'daily' | 'long'
  sourceEntityId: string
  text: string
  completedAt: number
}

export interface CompletedTaskReflectionPlan {
  entry: ReflectionEntry
  mutations: SyncMutationInput[]
}

export interface ReflectionRepository {
  get(entityId: string): Promise<ReflectionEntry | undefined>
  saveManual(content: string, date?: string): Promise<ReflectionEntry>
  update(entityId: string, content: string): Promise<boolean>
  remove(entityId: string): Promise<boolean>
  listGrouped(): Promise<ReflectionDateGroup[]>
  getAuditSummary(at?: Date): Promise<AuditSummary>
  recordCompletedTask(input: CompletedTaskReflectionInput): Promise<ReflectionEntry>
}

export interface ReflectionRepositoryOptions extends Partial<SyncRepositoryOptions> {
  createEntityId?: () => string
}

const auditCategories = new Set<AuditCategory>(['core', 'maintenance', 'rest', 'distraction'])

function emptyTotals(): AuditTotals {
  return { core: 0, maintenance: 0, rest: 0, distraction: 0 }
}

export function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function reflectionFromPayload(entityId: string, payload: SyncPayload): ReflectionEntry {
  return {
    ...payload,
    entityId,
    id: typeof payload.id === 'string' ? payload.id : entityId,
    date: typeof payload.date === 'string' ? payload.date : '',
    content: typeof payload.content === 'string' ? payload.content : '',
    kind: typeof payload.kind === 'string' ? payload.kind : 'manual',
    updatedAt: Number(payload.updatedAt) || 0,
  }
}

function isCompletedTaskEntry(entry: ReflectionEntry) {
  return entry.kind === 'completed-task' || entry.kind === 'completed-task-summary'
}

function cleanCompletedLine(value: unknown) {
  return String(value ?? '').replace(/^已完成[：:]\s*/, '').trim()
}

function intervalFor(payload: SyncPayload) {
  const start = Number(payload.start)
  const explicitEnd = Number(payload.end)
  const durationMs = Number(payload.durationMs)
  if (!Number.isFinite(start)) return null
  const end = Number.isFinite(explicitEnd)
    ? explicitEnd
    : Number.isFinite(durationMs) ? start + durationMs : Number.NaN
  if (!Number.isFinite(end) || end <= start) return null
  return { start, end }
}

function addClippedAudit(
  totals: AuditTotals,
  category: AuditCategory,
  start: number,
  end: number,
  lowerBound: number,
  upperBound: number,
) {
  const clippedStart = Math.max(start, lowerBound)
  const clippedEnd = Math.min(end, upperBound)
  if (clippedEnd > clippedStart) totals[category] += clippedEnd - clippedStart
}

export async function planCompletedTaskReflection(
  sync: SyncRepository,
  input: CompletedTaskReflectionInput,
  options: { now: () => number; createEntityId: () => string },
): Promise<CompletedTaskReflectionPlan> {
  const text = input.text.trim()
  if (!text) throw new Error('COMPLETED_TASK_TEXT_REQUIRED')
  const date = localDateKey(new Date(input.completedAt))
  const entries = (await sync.listRecords('reflection'))
    .map((record) => reflectionFromPayload(record.entityId, record.payload))
  const completedEntries = entries
    .filter((entry) => entry.date === date && isCompletedTaskEntry(entry))
    .sort((left, right) => left.updatedAt - right.updatedAt || left.entityId.localeCompare(right.entityId))
  const target = completedEntries[0]
  const sourceId = `${input.sourceType}:${input.sourceEntityId}`
  const sourceOrder: string[] = []
  const textBySource = new Map<string, string>()
  const unboundTexts: string[] = []

  for (const entry of completedEntries) {
    const lines = entry.content.split('\n').map(cleanCompletedLine).filter(Boolean)
    const sources = [
      ...(typeof entry.sourceTaskId === 'string' ? [entry.sourceTaskId] : []),
      ...(Array.isArray(entry.sourceTaskIds)
        ? entry.sourceTaskIds.filter((value): value is string => typeof value === 'string')
        : []),
    ]
    lines.forEach((line, index) => {
      const source = sources[index]
      if (source) {
        if (!sourceOrder.includes(source)) sourceOrder.push(source)
        if (!textBySource.has(source)) textBySource.set(source, line)
      } else if (!unboundTexts.includes(line)) {
        unboundTexts.push(line)
      }
    })
    for (const source of sources.slice(lines.length)) {
      if (!sourceOrder.includes(source)) sourceOrder.push(source)
    }
  }

  if (!sourceOrder.includes(sourceId)) sourceOrder.push(sourceId)
  textBySource.set(sourceId, text)
  const orderedTexts: string[] = []
  for (const source of sourceOrder) {
    const sourceText = textBySource.get(source)
    if (sourceText && !orderedTexts.includes(sourceText)) orderedTexts.push(sourceText)
  }
  for (const unboundText of unboundTexts) {
    if (!orderedTexts.includes(unboundText)) orderedTexts.push(unboundText)
  }

  const entityId = target?.entityId ?? options.createEntityId()
  const payload: SyncPayload = {
    ...target,
    entityId: undefined,
    id: target?.id ?? entityId,
    date,
    content: orderedTexts.map((entry) => `已完成：${entry}`).join('\n'),
    kind: 'completed-task-summary',
    sourceTaskIds: sourceOrder,
    updatedAt: options.now(),
  }
  delete payload.entityId
  const mutations: SyncMutationInput[] = [{
    entityType: 'reflection',
    entityId,
    operation: 'upsert',
    payload,
  }]
  for (const duplicate of completedEntries.slice(1)) {
    mutations.push({
      entityType: 'reflection',
      entityId: duplicate.entityId,
      operation: 'delete',
    })
  }
  return { entry: reflectionFromPayload(entityId, payload), mutations }
}

export async function recordCompletedTaskReflection(
  sync: SyncRepository,
  input: CompletedTaskReflectionInput,
  options: { now: () => number; createEntityId: () => string },
) {
  const plan = await planCompletedTaskReflection(sync, input, options)
  await sync.enqueueBatch(plan.mutations)
  return plan.entry
}

export function createReflectionRepository(
  database: SyncDatabase,
  options: ReflectionRepositoryOptions = {},
): ReflectionRepository {
  const { createEntityId = () => crypto.randomUUID(), ...syncOptions } = options
  const sync = createSyncRepository(database, syncOptions)
  const now = options.now ?? (() => Date.now())

  async function get(entityId: string) {
    const record = await sync.getRecord('reflection', entityId)
    if (!record || record.deleted) return undefined
    return reflectionFromPayload(entityId, record.payload)
  }

  async function activeEntries() {
    return (await sync.listRecords('reflection'))
      .map((record) => reflectionFromPayload(record.entityId, record.payload))
  }

  return {
    get,
    async saveManual(rawContent, date = localDateKey(new Date(now()))) {
      const content = rawContent.trim()
      if (!content) throw new Error('REFLECTION_CONTENT_REQUIRED')
      const existing = (await activeEntries())
        .filter((entry) => entry.date === date && !isCompletedTaskEntry(entry))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      const entityId = existing?.entityId ?? createEntityId()
      const payload: SyncPayload = {
        ...existing,
        entityId: undefined,
        id: existing?.id ?? entityId,
        date,
        content,
        kind: existing?.kind ?? 'manual',
        updatedAt: now(),
      }
      delete payload.entityId
      await sync.enqueueUpsert('reflection', entityId, payload)
      return reflectionFromPayload(entityId, payload)
    },
    async update(entityId, rawContent) {
      const content = rawContent.trim()
      if (!content) throw new Error('REFLECTION_CONTENT_REQUIRED')
      const current = await sync.getRecord('reflection', entityId)
      if (!current || current.deleted) return false
      await sync.enqueueUpsert('reflection', entityId, {
        ...current.payload,
        content,
        updatedAt: now(),
      })
      return true
    },
    async remove(entityId) {
      const current = await sync.getRecord('reflection', entityId)
      if (!current || current.deleted) return false
      await sync.enqueueDelete('reflection', entityId)
      return true
    },
    async listGrouped() {
      const groups = new Map<string, ReflectionEntry[]>()
      const entries = (await activeEntries()).sort((left, right) => (
        right.date.localeCompare(left.date)
        || right.updatedAt - left.updatedAt
        || left.entityId.localeCompare(right.entityId)
      ))
      for (const entry of entries) {
        if (!groups.has(entry.date)) groups.set(entry.date, [])
        groups.get(entry.date)!.push(entry)
      }
      return [...groups].map(([date, groupedEntries]) => ({ date, entries: groupedEntries }))
    },
    async getAuditSummary(at = new Date(now())) {
      const upperBound = at.getTime()
      const todayStartDate = new Date(at)
      todayStartDate.setHours(0, 0, 0, 0)
      const sevenDayStartDate = new Date(todayStartDate)
      sevenDayStartDate.setDate(sevenDayStartDate.getDate() - 6)
      const summary: AuditSummary = { today: emptyTotals(), sevenDays: emptyTotals() }
      for (const record of await sync.listRecords('time_audit')) {
        const category = record.payload.category
        if (typeof category !== 'string' || !auditCategories.has(category as AuditCategory)) continue
        const interval = intervalFor(record.payload)
        if (!interval) continue
        addClippedAudit(
          summary.today,
          category as AuditCategory,
          interval.start,
          interval.end,
          todayStartDate.getTime(),
          upperBound,
        )
        addClippedAudit(
          summary.sevenDays,
          category as AuditCategory,
          interval.start,
          interval.end,
          sevenDayStartDate.getTime(),
          upperBound,
        )
      }
      return summary
    },
    recordCompletedTask(input) {
      return recordCompletedTaskReflection(sync, input, { now, createEntityId })
    },
  }
}

export const reflectionRepository = createReflectionRepository(syncDatabase, {
  scopeController: syncScopeController,
})

export const reflectionRepositoryKey: InjectionKey<ReflectionRepository> = Symbol('reflectionRepository')
