import Dexie, { type EntityTable } from 'dexie'

export const supportedEntityTypes = [
  'daily_task',
  'long_task',
  'focus_session',
  'mode_event',
  'time_audit',
  'distraction',
  'reflection',
  'soul_quote',
] as const

export type SyncEntityType = (typeof supportedEntityTypes)[number]
export type SyncPayload = Record<string, unknown>
export const LOCAL_QUARANTINE_SCOPE = 'local-quarantine'
const GLOBAL_AUTH_SCOPE = 'global-auth'

export interface SyncScopeController {
  get(): string
  set(scopeKey: string): void
}

export function createSyncScopeController(initialScope = LOCAL_QUARANTINE_SCOPE): SyncScopeController {
  let activeScope = initialScope
  return {
    get: () => activeScope,
    set(scopeKey) {
      if (!scopeKey.trim()) throw new Error('INVALID_SYNC_SCOPE')
      activeScope = scopeKey
    },
  }
}

export function createAccountSyncScope(gatewayUrl: string, userId: string) {
  const origin = new URL(gatewayUrl).origin
  if (!userId.trim()) throw new Error('INVALID_ACCOUNT_IDENTITY')
  return `account:${encodeURIComponent(origin)}:${encodeURIComponent(userId)}`
}

function scopedStorageKey(scopeKey: string, logicalKey: string) {
  return scopeKey === LOCAL_QUARANTINE_SCOPE ? logicalKey : `${scopeKey}::${logicalKey}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameRecordContent(left: SyncRecordEnvelope, right: SyncRecordEnvelope) {
  return left.deleted === right.deleted && canonicalJson(left.payload) === canonicalJson(right.payload)
}

export interface SyncRecordEnvelope {
  key: string
  entityType: SyncEntityType
  entityId: string
  payload: SyncPayload
  deleted: boolean
  revision: number
  clientUpdatedAt: number
  serverUpdatedAt: number | null
  deviceId: string
  legacySourceId?: string
  scopeKey?: string
}

export interface PendingMutation {
  mutationId: string
  recordKey: string
  entityType: SyncEntityType
  entityId: string
  operation: 'upsert' | 'delete'
  baseRevision: number
  record: SyncRecordEnvelope
  createdAt: number
  state: 'pending' | 'conflict'
  scopeKey?: string
}

export interface SyncMutationInput {
  entityType: SyncEntityType
  entityId: string
  operation: PendingMutation['operation']
  payload?: SyncPayload
}

export interface MetadataWrite {
  key: string
  value: string | null
}

export interface LocalImportPreviewItem {
  entityType: SyncEntityType
  entityId: string
  payload: SyncPayload
}

export interface LocalImportPreview {
  total: number
  importable: LocalImportPreviewItem[]
  duplicates: LocalImportPreviewItem[]
  conflicts: LocalImportPreviewItem[]
}

interface SyncMetadata {
  key: string
  value: string
  scopeKey?: string
  logicalKey?: string
}

export interface SyncConflictRecord {
  id: string
  gatewayConflictId?: string
  mutationId: string | null
  recordKey: string
  entityType: SyncEntityType
  entityId: string
  local: SyncRecordEnvelope
  remote: SyncRecordEnvelope | null
  status: 'open' | 'resolving' | 'resolved_keep_local' | 'resolved_keep_remote'
  createdAt: number
  scopeKey?: string
  resolution?: 'keep_local' | 'keep_remote'
  resolutionOperationId?: string
  resolutionExpectedRevision?: number
  submittedLocal?: SyncRecordEnvelope
  reconciledGatewayStatus?: string
}

export interface SyncDatabase extends Dexie {
  syncRecords: EntityTable<SyncRecordEnvelope, 'key'>
  outbox: EntityTable<PendingMutation, 'mutationId'>
  metadata: EntityTable<SyncMetadata, 'key'>
  syncConflicts: EntityTable<SyncConflictRecord, 'id'>
}

export interface SyncRepositoryOptions {
  now: () => number
  createDeviceId: () => string
  createMutationId: () => string
  scopeController: SyncScopeController
}

export interface MutationAcknowledgement {
  revision: number
  serverUpdatedAt: number
  cursor?: string
}

export function syncRecordKey(
  entityType: SyncEntityType,
  entityId: string,
  scopeKey = LOCAL_QUARANTINE_SCOPE,
) {
  return scopedStorageKey(scopeKey, `${entityType}:${entityId}`)
}

export function createSyncDatabase(name = 'deepstudy-mobile'): SyncDatabase {
  const database = new Dexie(name) as SyncDatabase
  database.version(1).stores({
    syncRecords: 'key, entityType, entityId, [entityType+entityId], deleted, revision, serverUpdatedAt',
    outbox: 'mutationId, recordKey, entityType, entityId, operation, createdAt, state',
    metadata: 'key',
  })
  database.version(2).stores({
    syncRecords: 'key, entityType, entityId, [entityType+entityId], deleted, revision, serverUpdatedAt',
    outbox: 'mutationId, recordKey, entityType, entityId, operation, createdAt, state',
    metadata: 'key',
    syncConflicts: 'id, mutationId, recordKey, entityType, entityId, status, createdAt',
  })
  database.version(3).stores({
    syncRecords: 'key, scopeKey, [scopeKey+entityType], [scopeKey+entityType+entityId], deleted, revision, serverUpdatedAt',
    outbox: 'mutationId, scopeKey, [scopeKey+state], [scopeKey+recordKey], entityType, entityId, operation, createdAt',
    metadata: 'key, scopeKey, [scopeKey+logicalKey]',
    syncConflicts: 'id, scopeKey, [scopeKey+status], [scopeKey+recordKey], mutationId, entityType, entityId, createdAt',
  }).upgrade(async (transaction) => {
    await transaction.table('syncRecords').toCollection().modify((record) => {
      record.scopeKey = record.scopeKey || LOCAL_QUARANTINE_SCOPE
    })
    await transaction.table('outbox').toCollection().modify((mutation) => {
      mutation.scopeKey = mutation.scopeKey || LOCAL_QUARANTINE_SCOPE
    })
    await transaction.table('metadata').toCollection().modify((metadata) => {
      metadata.scopeKey = metadata.scopeKey || LOCAL_QUARANTINE_SCOPE
      metadata.logicalKey = metadata.logicalKey || metadata.key
    })
    await transaction.table('syncConflicts').toCollection().modify((conflict) => {
      conflict.scopeKey = conflict.scopeKey || LOCAL_QUARANTINE_SCOPE
      conflict.gatewayConflictId = conflict.gatewayConflictId || conflict.id
    })
  })
  return database
}

export function createSyncRepository(
  database: SyncDatabase,
  options: Partial<SyncRepositoryOptions> = {},
) {
  const resolvedOptions: SyncRepositoryOptions = {
    now: options.now ?? (() => Date.now()),
    createDeviceId: options.createDeviceId ?? (() => crypto.randomUUID()),
    createMutationId: options.createMutationId ?? (() => crypto.randomUUID()),
    scopeController: options.scopeController ?? createSyncScopeController(),
  }

  const activeScope = () => resolvedOptions.scopeController.get()

  async function getMetadataForScope(scopeKey: string, logicalKey: string) {
    return (await database.metadata.get(scopedStorageKey(scopeKey, logicalKey)))?.value ?? null
  }

  async function setMetadataForScope(scopeKey: string, logicalKey: string, value: string) {
    await database.metadata.put({
      key: scopedStorageKey(scopeKey, logicalKey),
      scopeKey,
      logicalKey,
      value,
    })
  }

  async function removeMetadataForScope(scopeKey: string, logicalKey: string) {
    await database.metadata.delete(scopedStorageKey(scopeKey, logicalKey))
  }

  async function getOrCreateDeviceIdForScope(scopeKey: string) {
    return database.transaction('rw', database.metadata, async () => {
      const current = await getMetadataForScope(scopeKey, 'deviceId')
      if (current) return current
      const deviceId = resolvedOptions.createDeviceId()
      await setMetadataForScope(scopeKey, 'deviceId', deviceId)
      return deviceId
    })
  }

  async function getOrCreateDeviceId() {
    return getOrCreateDeviceIdForScope(activeScope())
  }

  async function writeBatch(
    inputs: SyncMutationInput[],
    metadataWrites: MetadataWrite[] = [],
  ) {
    const scopeKey = activeScope()
    const timestamp = resolvedOptions.now()

    return database.transaction(
      'rw',
      database.metadata,
      database.syncRecords,
      database.outbox,
      async () => {
        const currentDevice = await getMetadataForScope(scopeKey, 'deviceId')
        const deviceId = currentDevice ?? resolvedOptions.createDeviceId()
        if (!currentDevice) await setMetadataForScope(scopeKey, 'deviceId', deviceId)

        const mutations: PendingMutation[] = []
        for (const input of inputs) {
          const mutationId = resolvedOptions.createMutationId()
          const key = syncRecordKey(input.entityType, input.entityId, scopeKey)
          const current = await database.syncRecords.get(key)
          const record: SyncRecordEnvelope = {
            key,
            entityType: input.entityType,
            entityId: input.entityId,
            payload: input.payload ?? current?.payload ?? {},
            deleted: input.operation === 'delete',
            revision: current?.revision ?? 0,
            clientUpdatedAt: timestamp,
            serverUpdatedAt: current?.serverUpdatedAt ?? null,
            deviceId,
            scopeKey,
          }
          const mutation: PendingMutation = {
            mutationId,
            recordKey: key,
            entityType: input.entityType,
            entityId: input.entityId,
            operation: input.operation,
            baseRevision: record.revision,
            record,
            createdAt: timestamp,
            state: 'pending',
            scopeKey,
          }
          await database.syncRecords.put(record)
          await database.outbox.add(mutation)
          mutations.push(mutation)
        }
        for (const write of metadataWrites) {
          if (write.value === null) await removeMetadataForScope(scopeKey, write.key)
          else await setMetadataForScope(scopeKey, write.key, write.value)
        }
        return mutations
      }
    )
  }

  async function enqueue(
    entityType: SyncEntityType,
    entityId: string,
    operation: PendingMutation['operation'],
    payload?: SyncPayload,
  ) {
    const [mutation] = await writeBatch([{ entityType, entityId, operation, payload }])
    return mutation
  }

  async function previewLocalQuarantineImport(): Promise<LocalImportPreview> {
    const scopeKey = activeScope()
    const empty: LocalImportPreview = { total: 0, importable: [], duplicates: [], conflicts: [] }
    if (scopeKey === LOCAL_QUARANTINE_SCOPE) return empty
    const records = (await database.syncRecords
      .where('scopeKey')
      .equals(LOCAL_QUARANTINE_SCOPE)
      .toArray())
      .filter((record) => !record.deleted)
    const preview: LocalImportPreview = {
      total: records.length,
      importable: [],
      duplicates: [],
      conflicts: [],
    }
    for (const record of records) {
      const item: LocalImportPreviewItem = {
        entityType: record.entityType,
        entityId: record.entityId,
        payload: record.payload,
      }
      const target = await database.syncRecords.get(syncRecordKey(record.entityType, record.entityId, scopeKey))
      if (!target || target.deleted) preview.importable.push(item)
      else if (sameRecordContent(target, { ...record, key: target.key, scopeKey })) preview.duplicates.push(item)
      else preview.conflicts.push(item)
    }
    return preview
  }

  return {
    getActiveScope: activeScope,
    assertActiveScope(scopeKey: string) {
      if (activeScope() !== scopeKey) throw new Error('SYNC_SCOPE_CHANGED')
    },
    setActiveScope(scopeKey: string) {
      resolvedOptions.scopeController.set(scopeKey)
    },
    getOrCreateDeviceId,
    getRecord(entityType: SyncEntityType, entityId: string) {
      return database.syncRecords.get(syncRecordKey(entityType, entityId, activeScope()))
    },
    async listRecords(entityType: SyncEntityType, includeDeleted = false) {
      const records = await database.syncRecords
        .where('[scopeKey+entityType]')
        .equals([activeScope(), entityType])
        .toArray()
      return includeDeleted ? records : records.filter((record) => !record.deleted)
    },
    enqueueUpsert(entityType: SyncEntityType, entityId: string, payload: SyncPayload) {
      return enqueue(entityType, entityId, 'upsert', payload)
    },
    enqueueDelete(entityType: SyncEntityType, entityId: string) {
      return enqueue(entityType, entityId, 'delete')
    },
    enqueueBatch(inputs: SyncMutationInput[]) {
      return writeBatch(inputs)
    },
    enqueueBatchWithMetadata(inputs: SyncMutationInput[], metadataWrites: MetadataWrite[]) {
      return writeBatch(inputs, metadataWrites)
    },
    async listPendingMutations() {
      const pending = await database.outbox
        .where('[scopeKey+state]')
        .equals([activeScope(), 'pending'])
        .toArray()
      return pending.sort(
        (left, right) => left.createdAt - right.createdAt || left.mutationId.localeCompare(right.mutationId),
      )
    },
    async listPushableMutations() {
      const scopeKey = activeScope()
      const [pending, openConflicts, resolvingConflicts] = await Promise.all([
        database.outbox.where('[scopeKey+state]').equals([scopeKey, 'pending']).toArray(),
        database.syncConflicts.where('[scopeKey+status]').equals([scopeKey, 'open']).toArray(),
        database.syncConflicts.where('[scopeKey+status]').equals([scopeKey, 'resolving']).toArray(),
      ])
      const conflicts = [...openConflicts, ...resolvingConflicts]
      const blockedKeys = new Set(conflicts.map((conflict) => conflict.recordKey))
      return pending
        .filter((mutation) => !blockedKeys.has(mutation.recordKey))
        .sort((left, right) => (
          left.createdAt - right.createdAt || left.mutationId.localeCompare(right.mutationId)
        ))
    },
    async applyRemoteRecord(record: SyncRecordEnvelope, cursor?: string) {
      const scopeKey = activeScope()
      if (record.scopeKey && record.scopeKey !== scopeKey) throw new Error('SYNC_SCOPE_CHANGED')
      return database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.metadata,
        database.syncConflicts,
        async () => {
          const key = syncRecordKey(record.entityType, record.entityId, scopeKey)
          const normalized = {
          ...record,
          scopeKey,
          key,
        }
          const current = await database.syncRecords.get(key)
          const pending = await database.outbox
            .where('[scopeKey+recordKey]')
            .equals([scopeKey, key])
            .and((mutation) => mutation.state === 'pending' || mutation.state === 'conflict')
            .first()
          if (current && pending && !sameRecordContent(current, normalized)) {
            const conflictId = scopedStorageKey(
              scopeKey,
              `pull-conflict:${record.entityType}:${record.entityId}:${record.revision}`,
            )
            if (!await database.syncConflicts.get(conflictId)) {
              await database.syncConflicts.put({
                id: conflictId,
                gatewayConflictId: conflictId,
                mutationId: pending.mutationId,
                recordKey: key,
                entityType: record.entityType,
                entityId: record.entityId,
                local: current,
                remote: normalized,
                status: 'open',
                createdAt: resolvedOptions.now(),
                scopeKey,
                submittedLocal: pending.record,
              })
            }
            await database.outbox.put({ ...pending, state: 'conflict', scopeKey })
            if (cursor !== undefined) await setMetadataForScope(scopeKey, 'cursor', cursor)
            return { status: 'conflict' as const }
          }
          await database.syncRecords.put(normalized)
          if (cursor !== undefined) {
            await setMetadataForScope(scopeKey, 'cursor', cursor)
          }
          return { status: 'applied' as const }
        }
      )
    },
    async acknowledgeMutation(mutationId: string, acknowledgement: MutationAcknowledgement) {
      const scopeKey = activeScope()
      await database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.metadata,
        async () => {
          const mutation = await database.outbox.get(mutationId)
          if (!mutation || mutation.scopeKey !== scopeKey) return
          const record = await database.syncRecords.get(mutation.recordKey)
          if (record) {
            await database.syncRecords.put({
              ...record,
              revision: acknowledgement.revision,
              serverUpdatedAt: acknowledgement.serverUpdatedAt,
            })
          }
          await database.outbox.delete(mutationId)
          const laterMutations = await database.outbox
            .where('[scopeKey+recordKey]')
            .equals([scopeKey, mutation.recordKey])
            .toArray()
          for (const laterMutation of laterMutations) {
            await database.outbox.put({
              ...laterMutation,
              baseRevision: acknowledgement.revision,
              record: {
                ...laterMutation.record,
                revision: acknowledgement.revision,
                serverUpdatedAt: acknowledgement.serverUpdatedAt,
              },
            })
          }
          if (acknowledgement.cursor !== undefined) {
            await setMetadataForScope(scopeKey, 'cursor', acknowledgement.cursor)
          }
        },
      )
    },
    async getCursor() {
      return getMetadataForScope(activeScope(), 'cursor')
    },
    async setCursor(cursor: string) {
      await setMetadataForScope(activeScope(), 'cursor', cursor)
    },
    async getMetadata(key: string) {
      return getMetadataForScope(activeScope(), key)
    },
    async setMetadata(key: string, value: string) {
      await setMetadataForScope(activeScope(), key, value)
    },
    async removeMetadata(key: string) {
      await removeMetadataForScope(activeScope(), key)
    },
    getGlobalMetadata(key: string) {
      return getMetadataForScope(GLOBAL_AUTH_SCOPE, key)
    },
    setGlobalMetadata(key: string, value: string) {
      return setMetadataForScope(GLOBAL_AUTH_SCOPE, key, value)
    },
    removeGlobalMetadata(key: string) {
      return removeMetadataForScope(GLOBAL_AUTH_SCOPE, key)
    },
    previewLocalQuarantineImport,
    async importLocalQuarantineRecords() {
      const preview = await previewLocalQuarantineImport()
      const mutations = await writeBatch(preview.importable.map((item) => ({
        entityType: item.entityType,
        entityId: item.entityId,
        operation: 'upsert' as const,
        payload: item.payload,
      })), [{ key: 'importStatus', value: 'committed' }])
      return {
        ...preview,
        imported: mutations.length,
      }
    },
    async pendingCount() {
      return database.outbox.where('[scopeKey+state]').equals([activeScope(), 'pending']).count()
    },
    async conflictCount() {
      const scopeKey = activeScope()
      const [open, resolving] = await Promise.all([
        database.syncConflicts.where('[scopeKey+status]').equals([scopeKey, 'open']).count(),
        database.syncConflicts.where('[scopeKey+status]').equals([scopeKey, 'resolving']).count(),
      ])
      return open + resolving
    },
    async listConflicts() {
      const scopeKey = activeScope()
      const conflicts = await database.syncConflicts.where('scopeKey').equals(scopeKey).toArray()
      return conflicts
        .filter((conflict) => conflict.status === 'open' || conflict.status === 'resolving')
        .sort((left, right) => right.createdAt - left.createdAt)
    },
    async recordConflict(
      mutation: PendingMutation,
      conflict: { id: string; remote: SyncRecordEnvelope | null; createdAt?: number },
    ) {
      const scopeKey = activeScope()
      if (mutation.scopeKey !== scopeKey) throw new Error('SYNC_SCOPE_CHANGED')
      await database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.syncConflicts,
        async () => {
          const latestLocal = await database.syncRecords.get(mutation.recordKey)
          const conflictKey = scopedStorageKey(scopeKey, conflict.id)
          await database.syncConflicts.put({
            id: conflictKey,
            gatewayConflictId: conflict.id,
            mutationId: mutation.mutationId,
            recordKey: mutation.recordKey,
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            local: latestLocal ?? mutation.record,
            remote: conflict.remote ? {
              ...conflict.remote,
              key: mutation.recordKey,
              scopeKey,
            } : null,
            status: 'open',
            createdAt: conflict.createdAt ?? resolvedOptions.now(),
            scopeKey,
            submittedLocal: mutation.record,
          })
          await database.outbox.put({ ...mutation, state: 'conflict', scopeKey })
        },
      )
    },
    async rememberRemoteConflict(conflict: SyncConflictRecord) {
      const scopeKey = activeScope()
      if (conflict.scopeKey && conflict.scopeKey !== scopeKey) throw new Error('SYNC_SCOPE_CHANGED')
      if (conflict.local.scopeKey && conflict.local.scopeKey !== scopeKey) {
        throw new Error('SYNC_SCOPE_CHANGED')
      }
      const conflictKey = scopedStorageKey(scopeKey, conflict.gatewayConflictId ?? conflict.id)
      if (!await database.syncConflicts.get(conflictKey)) {
        const recordKey = syncRecordKey(conflict.entityType, conflict.entityId, scopeKey)
        await database.syncConflicts.put({
          ...conflict,
          id: conflictKey,
          gatewayConflictId: conflict.gatewayConflictId ?? conflict.id,
          scopeKey,
          recordKey,
          local: { ...conflict.local, scopeKey, key: recordKey },
          remote: conflict.remote ? { ...conflict.remote, scopeKey, key: recordKey } : null,
        })
      }
    },
    getConflict(id: string) {
      return database.syncConflicts.get(id).then((conflict) => (
        conflict?.scopeKey === activeScope() ? conflict : undefined
      ))
    },
    async hasOpenConflict(recordKey: string) {
      const scopeKey = activeScope()
      return Boolean(await database.syncConflicts
        .where('[scopeKey+recordKey]')
        .equals([scopeKey, recordKey])
        .and((conflict) => conflict.status === 'open' || conflict.status === 'resolving')
        .first())
    },
    async beginConflictResolution(
      id: string,
      resolution: 'keep_local' | 'keep_remote',
      operationId: string,
    ) {
      const scopeKey = activeScope()
      return database.transaction('rw', database.syncConflicts, async () => {
        const conflict = await database.syncConflicts.get(id)
        if (!conflict || conflict.scopeKey !== scopeKey
          || !new Set(['open', 'resolving']).has(conflict.status)) {
          throw new Error('CONFLICT_NOT_FOUND')
        }
        if (conflict.status === 'resolving') {
          if (conflict.resolution !== resolution || !conflict.resolutionOperationId) {
            throw new Error('CONFLICT_RESOLUTION_ALREADY_PENDING')
          }
          return conflict
        }
        const pending: SyncConflictRecord = {
          ...conflict,
          status: 'resolving',
          resolution,
          resolutionOperationId: operationId,
          resolutionExpectedRevision: conflict.remote?.revision ?? 0,
          submittedLocal: conflict.submittedLocal ?? conflict.local,
        }
        await database.syncConflicts.put(pending)
        return pending
      })
    },
    async reopenConflict(
      id: string,
      latestRemote?: SyncRecordEnvelope | null,
      reconciledGatewayStatus = 'unknown',
    ) {
      const scopeKey = activeScope()
      return database.transaction('rw', database.syncConflicts, async () => {
        const conflict = await database.syncConflicts.get(id)
        if (!conflict || conflict.scopeKey !== scopeKey
          || !new Set(['open', 'resolving']).has(conflict.status)) {
          throw new Error('CONFLICT_NOT_FOUND')
        }
        if (latestRemote?.scopeKey && latestRemote.scopeKey !== scopeKey) {
          throw new Error('SYNC_SCOPE_CHANGED')
        }
        const {
          resolution: _resolution,
          resolutionOperationId: _operationId,
          resolutionExpectedRevision: _expectedRevision,
          ...rest
        } = conflict
        const reopened: SyncConflictRecord = {
          ...rest,
          status: 'open',
          reconciledGatewayStatus,
          remote: latestRemote === undefined
            ? conflict.remote
            : latestRemote && {
                ...latestRemote,
                key: conflict.recordKey,
                scopeKey,
              },
        }
        await database.syncConflicts.put(reopened)
        return reopened
      })
    },
    async retryReconciledConflictKeepLocal(id: string) {
      const scopeKey = activeScope()
      const deviceId = await getOrCreateDeviceId()
      const timestamp = resolvedOptions.now()
      return database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.syncConflicts,
        async () => {
          const conflict = await database.syncConflicts.get(id)
          if (!conflict || conflict.scopeKey !== scopeKey || conflict.status !== 'open'
            || !conflict.reconciledGatewayStatus) throw new Error('CONFLICT_NOT_FOUND')
          const current = await database.syncRecords.get(conflict.recordKey) ?? conflict.local
          let mutationId = resolvedOptions.createMutationId()
          if (await database.outbox.get(mutationId)) {
            mutationId = `${mutationId}:retry:${timestamp}`.slice(0, 160)
          }
          const revision = conflict.remote?.revision ?? 0
          const record: SyncRecordEnvelope = {
            ...current,
            revision,
            serverUpdatedAt: conflict.remote?.serverUpdatedAt ?? null,
            clientUpdatedAt: timestamp,
            deviceId,
            scopeKey,
            key: conflict.recordKey,
          }
          const mutation: PendingMutation = {
            mutationId,
            recordKey: conflict.recordKey,
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            operation: record.deleted ? 'delete' : 'upsert',
            baseRevision: revision,
            record,
            createdAt: timestamp,
            state: 'pending',
            scopeKey,
          }
          await database.outbox.where('[scopeKey+recordKey]').equals([scopeKey, conflict.recordKey]).delete()
          await database.syncRecords.put(record)
          await database.outbox.add(mutation)
          await database.syncConflicts.put({ ...conflict, status: 'resolved_keep_local' })
          return mutation
        },
      )
    },
    async resolveConflictKeepRemote(id: string) {
      const scopeKey = activeScope()
      await database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.syncConflicts,
        async () => {
          const conflict = await database.syncConflicts.get(id)
          if (!conflict || conflict.scopeKey !== scopeKey
            || !new Set(['open', 'resolving']).has(conflict.status)) throw new Error('CONFLICT_NOT_FOUND')
          await database.outbox.where('[scopeKey+recordKey]').equals([scopeKey, conflict.recordKey]).delete()
          if (conflict.remote) await database.syncRecords.put({
            ...conflict.remote,
            key: conflict.recordKey,
            scopeKey,
          })
          else await database.syncRecords.delete(conflict.recordKey)
          await database.syncConflicts.put({ ...conflict, status: 'resolved_keep_remote' })
        },
      )
    },
    async resolveConflictKeepLocal(
      id: string,
      acknowledgement: MutationAcknowledgement,
    ) {
      const scopeKey = activeScope()
      await database.transaction(
        'rw',
        database.syncRecords,
        database.outbox,
        database.syncConflicts,
        async () => {
          const conflict = await database.syncConflicts.get(id)
          if (!conflict || conflict.scopeKey !== scopeKey
            || !new Set(['open', 'resolving']).has(conflict.status)) throw new Error('CONFLICT_NOT_FOUND')
          const current = await database.syncRecords.get(conflict.recordKey) ?? conflict.local
          await database.syncRecords.put({
            ...current,
            revision: acknowledgement.revision,
            serverUpdatedAt: acknowledgement.serverUpdatedAt,
          })
          if (conflict.mutationId) await database.outbox.delete(conflict.mutationId)
          const laterMutations = await database.outbox
            .where('[scopeKey+recordKey]')
            .equals([scopeKey, conflict.recordKey])
            .toArray()
          for (const mutation of laterMutations) {
            await database.outbox.put({
              ...mutation,
              state: 'pending',
              baseRevision: acknowledgement.revision,
              record: {
                ...mutation.record,
                revision: acknowledgement.revision,
                serverUpdatedAt: acknowledgement.serverUpdatedAt,
              },
            })
          }
          await database.syncConflicts.put({ ...conflict, status: 'resolved_keep_local' })
        },
      )
    },
  }
}

export type SyncRepository = ReturnType<typeof createSyncRepository>

export const syncDatabase = createSyncDatabase()
export const syncScopeController = createSyncScopeController()
export const syncRepository = createSyncRepository(syncDatabase, { scopeController: syncScopeController })
