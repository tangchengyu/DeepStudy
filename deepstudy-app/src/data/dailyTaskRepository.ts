import {
  createSyncRepository,
  syncDatabase,
  syncScopeController,
  type SyncDatabase,
  type SyncPayload,
  type SyncRepositoryOptions,
} from './syncRepository'
import { planCompletedTaskReflection } from './reflectionRepository'

export interface DailyTask extends SyncPayload {
  entityId: string
  id: string
  text: string
  priority: boolean
  done: boolean
  createdAt: number
  completedAt: number | null
  order: number
}

export interface DailyTaskRepository {
  create(text: string, order?: number): Promise<DailyTask>
  get(entityId: string): Promise<DailyTask | undefined>
  listForDate(date?: Date): Promise<DailyTask[]>
  rename(entityId: string, text: string): Promise<boolean>
  togglePriority(entityId: string): Promise<boolean>
  complete(entityId: string): Promise<boolean>
  reopen(entityId: string): Promise<boolean>
  move(entityId: string, direction: 'up' | 'down', date?: Date): Promise<boolean>
  remove(entityId: string): Promise<boolean>
  pendingCount(): Promise<number>
}

export interface DailyTaskRepositoryOptions extends Partial<SyncRepositoryOptions> {
  createEntityId?: () => string
  createReflectionId?: () => string
}

function localDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function payloadDate(payload: SyncPayload, legacySourceId?: string) {
  if (typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return payload.date
  }
  const legacyDate = legacySourceId?.match(/\|date=([^|]*)/)?.[1]
  if (legacyDate) return decodeURIComponent(legacyDate)
  const createdAt = Number(payload.createdAt)
  return Number.isFinite(createdAt) ? localDateKey(new Date(createdAt)) : ''
}

function fromRecord(entityId: string, payload: SyncPayload): DailyTask {
  return { ...payload, entityId } as DailyTask
}

export function createDailyTaskRepository(
  database: SyncDatabase,
  options: DailyTaskRepositoryOptions = {},
): DailyTaskRepository {
  const {
    createEntityId = () => crypto.randomUUID(),
    createReflectionId = () => crypto.randomUUID(),
    ...syncOptions
  } = options
  const sync = createSyncRepository(database, syncOptions)
  const now = options.now ?? (() => Date.now())

  async function get(entityId: string) {
    const record = await sync.getRecord('daily_task', entityId)
    if (!record || record.deleted) return undefined
    return fromRecord(record.entityId, record.payload)
  }

  async function merge(entityId: string, changes: SyncPayload) {
    const current = await sync.getRecord('daily_task', entityId)
    if (!current || current.deleted) return false
    await sync.enqueueUpsert('daily_task', entityId, { ...current.payload, ...changes })
    return true
  }

  return {
    async create(rawText, requestedOrder) {
      const text = rawText.trim()
      if (!text) throw new Error('DAILY_TASK_TEXT_REQUIRED')
      const entityId = createEntityId()
      const createdAt = now()
      const payload: SyncPayload = {
        id: entityId,
        text,
        priority: false,
        done: false,
        createdAt,
        completedAt: null,
        order: requestedOrder ?? createdAt,
        date: localDateKey(new Date(createdAt)),
      }
      await sync.enqueueUpsert('daily_task', entityId, payload)
      return fromRecord(entityId, payload)
    },
    get,
    async listForDate(date = new Date(now())) {
      const dateKey = localDateKey(date)
      return (await sync.listRecords('daily_task'))
        .filter((record) => payloadDate(record.payload, record.legacySourceId) === dateKey)
        .map((record) => fromRecord(record.entityId, record.payload))
        .sort((left, right) => Number(left.order) - Number(right.order)
          || Number(left.createdAt) - Number(right.createdAt))
    },
    async rename(entityId, rawText) {
      const text = rawText.trim()
      if (!text) throw new Error('DAILY_TASK_TEXT_REQUIRED')
      return merge(entityId, { text })
    },
    async togglePriority(entityId) {
      const task = await get(entityId)
      return task ? merge(entityId, { priority: !task.priority }) : false
    },
    async complete(entityId) {
      const current = await sync.getRecord('daily_task', entityId)
      if (!current || current.deleted) return false
      const completedAt = now()
      const payload = {
        ...current.payload,
        done: true,
        completedAt,
      }
      const reflection = await planCompletedTaskReflection(sync, {
        sourceType: 'daily',
        sourceEntityId: entityId,
        text: String(current.payload.text ?? ''),
        completedAt,
      }, { now, createEntityId: createReflectionId })
      await sync.enqueueBatch([
        { entityType: 'daily_task', entityId, operation: 'upsert', payload },
        ...reflection.mutations,
      ])
      return true
    },
    reopen(entityId) {
      return merge(entityId, { done: false, completedAt: null })
    },
    async move(entityId, direction, date = new Date(now())) {
      const tasks = await this.listForDate(date)
      const currentIndex = tasks.findIndex((task) => task.entityId === entityId)
      const targetIndex = currentIndex + (direction === 'up' ? -1 : 1)
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= tasks.length) return false
      const current = tasks[currentIndex]
      const target = tasks[targetIndex]
      await merge(current.entityId, { order: target.order })
      await merge(target.entityId, { order: current.order })
      return true
    },
    async remove(entityId) {
      const current = await sync.getRecord('daily_task', entityId)
      if (!current || current.deleted) return false
      await sync.enqueueDelete('daily_task', entityId)
      return true
    },
    async pendingCount() {
      return (await sync.listPendingMutations())
        .filter((mutation) => mutation.entityType === 'daily_task').length
    },
  }
}

export const dailyTaskRepository = createDailyTaskRepository(syncDatabase, {
  scopeController: syncScopeController,
})
