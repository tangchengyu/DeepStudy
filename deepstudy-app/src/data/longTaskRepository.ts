import {
  createSyncDatabase,
  createSyncRepository,
  syncDatabase,
  syncScopeController,
  type SyncDatabase,
  type SyncPayload,
  type SyncRepositoryOptions,
} from './syncRepository'
import { planCompletedTaskReflection } from './reflectionRepository'

export type QuadrantId =
  | 'important-urgent'
  | 'important-not-urgent'
  | 'urgent-not-important'
  | 'not-important-not-urgent'

export interface LongTask extends SyncPayload {
  entityId: string
  id: string
  title: string
  notes: string
  quadrantId: QuadrantId
  status: 'active' | 'completed' | 'planned'
  order: number
  createdAt: number
  updatedAt: number
  completedAt?: number | null
  plannedAt?: string | number | null
}

export interface CreateLongTaskInput {
  title: string
  notes?: string
  quadrantId: QuadrantId
  plannedAt?: string | number | null
}

export interface SaveLongTaskInput extends SyncPayload {
  entityId?: string
  id: string
  title: string
  notes: string
  quadrantId: QuadrantId
  status: 'active' | 'completed' | 'planned'
  order: number
  createdAt: number
  updatedAt: number
  completedAt?: number | null
  plannedAt?: string | number | null
}

export type LongTaskDatabase = SyncDatabase

export interface LongTaskRepository {
  create(input: CreateLongTaskInput): Promise<LongTask>
  save(task: SaveLongTaskInput): Promise<string>
  get(id: string): Promise<LongTask | undefined>
  listByQuadrant(quadrantId: QuadrantId): Promise<LongTask[]>
  listCompletedByQuadrant(quadrantId: QuadrantId): Promise<LongTask[]>
  update(entityId: string, changes: Pick<Partial<LongTask>, 'title' | 'notes' | 'plannedAt'>): Promise<boolean>
  complete(id: string): Promise<boolean>
  reopen(id: string): Promise<boolean>
  moveToQuadrant(id: string, quadrantId: QuadrantId): Promise<boolean>
  remove(id: string): Promise<boolean>
  readLongTaskImageDataUrl(id: string): Promise<string | null>
}

export interface LongTaskRepositoryOptions extends Partial<SyncRepositoryOptions> {
  createEntityId?: () => string
  createReflectionId?: () => string
}

export function createLongTaskDatabase(name = 'deepstudy-mobile'): LongTaskDatabase {
  return createSyncDatabase(name)
}

function taskFromPayload(id: string, payload: SyncPayload): LongTask {
  const quadrantId = isQuadrantId(payload.quadrant)
    ? payload.quadrant
    : payload.quadrantId
  return { ...payload, quadrantId, entityId: id } as LongTask
}

function isQuadrantId(value: unknown): value is QuadrantId {
  return value === 'important-urgent'
    || value === 'important-not-urgent'
    || value === 'urgent-not-important'
    || value === 'not-important-not-urgent'
}

function safeImageId(value: string) {
  const id = value.trim()
  return /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|bmp)$/i.test(id) ? id : ''
}

function imageTypeFromId(id: string) {
  const extension = id.split('.').pop()?.toLowerCase()
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
  } as Record<string, string>)[extension || ''] ?? 'application/octet-stream'
}

export function createLongTaskRepository(
  database: LongTaskDatabase,
  options: LongTaskRepositoryOptions = {},
): LongTaskRepository {
  const {
    createEntityId = () => crypto.randomUUID(),
    createReflectionId = () => crypto.randomUUID(),
    ...syncOptions
  } = options
  const sync = createSyncRepository(database, syncOptions)
  const now = options.now ?? (() => Date.now())

  async function save(task: SaveLongTaskInput) {
    const { entityId = task.id, quadrantId, ...rest } = task
    const current = await sync.getRecord('long_task', entityId)
    const merged: SyncPayload = { ...current?.payload, ...rest, quadrant: quadrantId }
    if (current?.payload.id !== undefined) merged.id = current.payload.id
    await sync.enqueueUpsert('long_task', entityId, merged)
    return entityId
  }

  async function get(id: string) {
    const record = await sync.getRecord('long_task', id)
    if (!record || record.deleted) return undefined
    return taskFromPayload(id, record.payload)
  }

  async function merge(entityId: string, changes: SyncPayload) {
    const current = await sync.getRecord('long_task', entityId)
    if (!current || current.deleted) return false
    await sync.enqueueUpsert('long_task', entityId, { ...current.payload, ...changes })
    return true
  }

  return {
    async create(input) {
      const title = input.title.trim()
      if (!title) throw new Error('LONG_TASK_TITLE_REQUIRED')
      const entityId = createEntityId()
      const timestamp = now()
      const payload: SyncPayload = {
        id: entityId,
        title,
        notes: input.notes ?? '',
        quadrant: input.quadrantId,
        status: 'active',
        reminder: {
          kind: 'none', time: '09:00', weekdays: [], at: null,
          enabled: false, lastTriggeredAt: null,
        },
        order: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        plannedAt: input.plannedAt ?? null,
      }
      await sync.enqueueUpsert('long_task', entityId, payload)
      return taskFromPayload(entityId, payload)
    },
    save,
    get,
    async listByQuadrant(quadrantId) {
      const records = await sync.listRecords('long_task')
      return records
        .map((record) => taskFromPayload(record.entityId, record.payload))
        .filter((task) => task.quadrantId === quadrantId && task.status !== 'completed')
        .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt)
    },
    async listCompletedByQuadrant(quadrantId) {
      const records = await sync.listRecords('long_task')
      return records
        .map((record) => taskFromPayload(record.entityId, record.payload))
        .filter((task) => task.quadrantId === quadrantId && task.status === 'completed')
        .sort((left, right) => Number(right.completedAt ?? right.updatedAt)
          - Number(left.completedAt ?? left.updatedAt))
    },
    async update(entityId, changes) {
      return merge(entityId, { ...changes, updatedAt: now() })
    },
    async complete(id) {
      const current = await sync.getRecord('long_task', id)
      if (!current || current.deleted) return false
      const timestamp = now()
      const payload = {
        ...current.payload,
        status: 'completed',
        completedAt: timestamp,
        updatedAt: timestamp,
      }
      const reflection = await planCompletedTaskReflection(sync, {
        sourceType: 'long',
        sourceEntityId: id,
        text: String(current.payload.title ?? ''),
        completedAt: timestamp,
      }, { now, createEntityId: createReflectionId })
      await sync.enqueueBatch([
        { entityType: 'long_task', entityId: id, operation: 'upsert', payload },
        ...reflection.mutations,
      ])
      return true
    },
    async reopen(id) {
      return merge(id, { status: 'active', completedAt: null, updatedAt: now() })
    },
    async moveToQuadrant(id, quadrantId) {
      return merge(id, { quadrant: quadrantId, updatedAt: now() })
    },
    async remove(id) {
      const current = await sync.getRecord('long_task', id)
      if (!current || current.deleted) return false
      await sync.enqueueDelete('long_task', id)
      return true
    },
    async readLongTaskImageDataUrl(id) {
      const imageId = safeImageId(id)
      if (!imageId) return null
      const records = await sync.listRecords('long_task_image_chunk')
      const chunks = records
        .map((record) => record.payload)
        .filter((payload) => payload.imageId === imageId)
        .sort((left, right) => Number(left.index) - Number(right.index))
      const total = Number(chunks[0]?.total)
      if (!Number.isSafeInteger(total) || total <= 0 || chunks.length < total) return null
      const selected = chunks.slice(0, total)
      if (selected.some((chunk, index) => Number(chunk.index) !== index
        || Number(chunk.total) !== total
        || typeof chunk.data !== 'string')) return null
      const type = typeof selected[0].type === 'string' ? selected[0].type : imageTypeFromId(imageId)
      return `data:${type};base64,${selected.map((chunk) => chunk.data).join('')}`
    },
  }
}

export const longTaskDatabase = syncDatabase
export const longTaskRepository = createLongTaskRepository(longTaskDatabase, {
  scopeController: syncScopeController,
})
