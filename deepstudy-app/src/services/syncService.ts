import { Capacitor } from '@capacitor/core'
import { reactive } from 'vue'
import type {
  PendingMutation,
  SyncConflictRecord,
  SyncRecordEnvelope,
  SyncRepository,
} from '../data/syncRepository'
import { syncRecordKey } from '../data/syncRepository'
import type {
  GatewayClient,
  PushConflictResult,
  RemoteSyncRecord,
  RemoteConflict,
} from './gatewayClient'
import { GatewayError } from './gatewayClient'
import type { ConnectivityMonitor } from './connectivity'

type SyncClient = Pick<
  GatewayClient,
  'conflicts' | 'pull' | 'push' | 'registerDevice' | 'resolveConflict'
>

interface SyncServiceOptions {
  repository: SyncRepository
  client: SyncClient
  connectivity: ConnectivityMonitor
  delay?: (milliseconds: number) => Promise<void>
  now?: () => number
  deviceName?: () => string
  platform?: () => string
  createMutationId?: () => string
  autoSyncDelayMs?: number
  pollIntervalMs?: number
}

export interface SyncState {
  phase: 'idle' | 'offline' | 'syncing' | 'error'
  online: boolean
  lastSyncAt: number | null
  pending: number
  conflicts: number
  error: string | null
  nextRetryAt: number | null
}

export interface SyncRunStats {
  status: 'offline' | 'synced'
  pushed: number
  pushConflicts: number
  pulled: number
  applied: number
  pullConflicts: number
  pending: number
  conflicts: number
}

export interface RemoteImpactPreview {
  total: number
  active: number
  deleted: number
  create: number
  update: number
  delete: number
  unchanged: number
}

function defaultDelay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function retryable(error: unknown) {
  if (error instanceof GatewayError && /^SYNC_(DAILY_|STORAGE_LIMIT)/.test(error.code)) return false
  return error instanceof TypeError
    || (error instanceof GatewayError && (error.code === 'NETWORK_TIMEOUT' || error.status === 429 || error.status >= 500))
}

function pushBatch(pending: PendingMutation[]) {
  const batch: PendingMutation[] = []
  const keys = new Set<string>()
  let bytes = 32
  for (const mutation of pending) {
    if (keys.has(mutation.recordKey)) continue
    const { key: _key, scopeKey: _scopeKey, ...record } = mutation.record
    const size = new TextEncoder().encode(JSON.stringify({
      mutationId: mutation.mutationId, baseRevision: mutation.baseRevision, record,
    })).length + 1
    if (batch.length && bytes + size > 900_000) break
    batch.push(mutation)
    keys.add(mutation.recordKey)
    bytes += size
    if (batch.length === 5) break
  }
  return batch
}

function normalizeRecord(record: RemoteSyncRecord, scopeKey: string): SyncRecordEnvelope {
  return {
    ...record,
    key: syncRecordKey(record.entityType, record.entityId, scopeKey),
    scopeKey,
  }
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

function emptyRunStats(status: SyncRunStats['status']): SyncRunStats {
  return {
    status,
    pushed: 0,
    pushConflicts: 0,
    pulled: 0,
    applied: 0,
    pullConflicts: 0,
    pending: 0,
    conflicts: 0,
  }
}

function notifySyncDataChanged(detail: Record<string, unknown>) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent('deepstudy:sync-data-changed', { detail }))
}

export function createSyncService(options: SyncServiceOptions) {
  const delay = options.delay ?? defaultDelay
  const now = options.now ?? (() => Date.now())
  const createMutationId = options.createMutationId ?? (() => `resolution-${crypto.randomUUID()}`)
  const state = reactive<SyncState>({
    phase: 'idle',
    online: options.connectivity.isOnline(),
    lastSyncAt: null,
    pending: 0,
    conflicts: 0,
    error: null,
    nextRetryAt: null,
  })
  let currentSync: {
    scopeKey: string
    generation: number
    promise: Promise<SyncRunStats>
  } | null = null
  let unsubscribe: (() => void) | null = null
  let unsubscribeOutbox: (() => void) | null = null
  let generation = 0
  let started = false
  let autoTimer: ReturnType<typeof setTimeout> | null = null
  let automaticRequested = false
  let automaticBlocked = false
  let failures = 0
  let unsubscribeForeground: (() => void) | null = null

  function isVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  function clearAutoTimer() {
    if (autoTimer !== null) clearTimeout(autoTimer)
    autoTimer = null
  }

  function scheduleAutomaticSync(milliseconds = options.autoSyncDelayMs ?? 750) {
    if (!started || automaticBlocked || !options.connectivity.isOnline() || !isVisible()) return
    if (currentSync) {
      automaticRequested = true
    }
    clearAutoTimer()
    const wait = Math.max(milliseconds, (state.nextRetryAt ?? 0) - now())
    autoTimer = setTimeout(() => {
      autoTimer = null
      if (started && isVisible() && options.connectivity.isOnline()) {
        void service.syncNow().catch(() => undefined)
      }
    }, wait)
  }

  async function refreshState() {
    const scopeKey = options.repository.getActiveScope()
    const refreshGeneration = generation
    const [lastSyncAt, pending, conflicts] = await Promise.all([
      options.repository.getMetadata('lastSyncAt'),
      options.repository.pendingCount(),
      options.repository.conflictCount(),
    ])
    if (scopeKey !== options.repository.getActiveScope() || refreshGeneration !== generation) return
    state.lastSyncAt = lastSyncAt ? Number(lastSyncAt) : null
    state.pending = pending
    state.conflicts = conflicts
  }

  async function withRetry<T>(operation: () => Promise<T>) {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (!retryable(error) || attempt === 2 || !options.connectivity.isOnline()) throw error
        if (error instanceof GatewayError && error.retryAfterSeconds) throw error
        await delay(250 * (2 ** attempt))
      }
    }
    throw lastError
  }

  function subscribeOutboxChanges() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return () => undefined
    }
    const listener = (event: Event) => {
      const scopeKey = (event as CustomEvent<{ scopeKey?: string }>).detail?.scopeKey
      if (scopeKey && scopeKey !== options.repository.getActiveScope()) return
      void refreshState().catch(() => undefined)
      scheduleAutomaticSync()
    }
    window.addEventListener('deepstudy:sync-outbox-changed', listener)
    return () => window.removeEventListener('deepstudy:sync-outbox-changed', listener)
  }

  async function storeConflict(mutation: PendingMutation, result: PushConflictResult) {
    const scopeKey = mutation.scopeKey ?? options.repository.getActiveScope()
    await options.repository.recordConflict(mutation, {
      id: result.conflictId,
      remote: result.remote ? normalizeRecord(result.remote, scopeKey) : null,
      createdAt: now(),
    })
  }

  async function rememberGatewayConflict(conflict: RemoteConflict, scopeKey: string) {
    const remote = conflict.remote ? normalizeRecord(conflict.remote, scopeKey) : null
    await options.repository.rememberRemoteConflict({
      id: conflict.id,
      gatewayConflictId: conflict.id,
      mutationId: null,
      recordKey: normalizeRecord(conflict.local, scopeKey).key,
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      local: normalizeRecord(conflict.local, scopeKey),
      remote,
      status: 'open',
      createdAt: conflict.createdAt,
      scopeKey,
    })
  }

  async function performSync(scopeKey: string, runGeneration: number) {
    const assertCurrentRun = () => {
      options.repository.assertActiveScope(scopeKey)
      if (generation !== runGeneration) throw new Error('SYNC_CANCELLED')
    }
    assertCurrentRun()
    state.online = options.connectivity.isOnline()
    if (!state.online) {
      state.phase = 'offline'
      await refreshState()
      return { ...emptyRunStats('offline'), pending: state.pending, conflicts: state.conflicts }
    }

    state.phase = 'syncing'
    state.error = null
    const stats = emptyRunStats('synced')
    const deviceId = await options.repository.getOrCreateDeviceId()
    assertCurrentRun()
    await withRetry(() => options.client.registerDevice(
      deviceId,
      options.deviceName?.() ?? 'Android phone',
      options.platform?.() ?? Capacitor.getPlatform(),
    ))
    assertCurrentRun()

    while (true) {
      assertCurrentRun()
      const batch = pushBatch(await options.repository.listPushableMutations())
      if (!batch.length) break
      const response = await withRetry(() => options.client.push(deviceId, batch))
      assertCurrentRun()
      for (const mutation of batch) {
        assertCurrentRun()
        const result = response.results.find((item) => item.mutationId === mutation.mutationId)
        if (!result) throw new Error(`Gateway did not acknowledge ${mutation.mutationId}`)
        if (result.status === 'applied') {
          await options.repository.acknowledgeMutation(mutation.mutationId, {
            revision: result.revision,
            serverUpdatedAt: result.serverUpdatedAt,
          })
          stats.pushed += 1
        } else {
          await storeConflict(mutation, result)
          stats.pushConflicts += 1
        }
      }
      await refreshState()
    }

    let cursor = await options.repository.getCursor()
    let hasMore = true
    while (hasMore) {
      assertCurrentRun()
      const pulled = await withRetry(() => options.client.pull(deviceId, cursor))
      assertCurrentRun()
      stats.pulled += pulled.records.length
      for (const record of pulled.records) {
        const normalized = normalizeRecord(record, scopeKey)
        if (!await options.repository.hasOpenConflict(normalized.key)) {
          const result = await options.repository.applyRemoteRecord(normalized)
          if (result.status === 'applied') stats.applied += 1
          else if (result.status === 'conflict') stats.pullConflicts += 1
        }
      }
      const nextCursor = String(pulled.cursor)
      if (pulled.hasMore && nextCursor === (cursor ?? '0')) throw new Error('SYNC_CURSOR_STALLED')
      cursor = nextCursor
      assertCurrentRun()
      await options.repository.setCursor(cursor)
      hasMore = pulled.hasMore
    }

    assertCurrentRun()
    const gatewayConflicts = await withRetry(() => options.client.conflicts(deviceId))
    assertCurrentRun()
    for (const conflict of gatewayConflicts.conflicts) {
      assertCurrentRun()
      await rememberGatewayConflict(conflict, scopeKey)
    }

    const completedAt = now()
    assertCurrentRun()
    await options.repository.setMetadata('lastSyncAt', String(completedAt))
    state.phase = 'idle'
    state.nextRetryAt = null
    failures = 0
    automaticBlocked = false
    await refreshState()
    stats.pending = state.pending
    stats.conflicts = state.conflicts
    if (stats.applied || stats.pullConflicts) {
      notifySyncDataChanged({
        source: 'sync-now',
        pulled: stats.pulled,
        applied: stats.applied,
        conflicts: stats.conflicts,
      })
    }
    return stats
  }

  async function pullRemoteRecordsForPreview(scopeKey: string) {
    state.online = options.connectivity.isOnline()
    if (!state.online) throw new Error('OFFLINE')
    const deviceId = await options.repository.getOrCreateDeviceId()
    options.repository.assertActiveScope(scopeKey)
    await withRetry(() => options.client.registerDevice(
      deviceId,
      options.deviceName?.() ?? 'Android phone',
      options.platform?.() ?? Capacitor.getPlatform(),
    ))
    options.repository.assertActiveScope(scopeKey)
    let cursor: string | null = null
    const records: SyncRecordEnvelope[] = []
    for (let page = 0; page < 10000; page += 1) {
      const pulled = await withRetry(() => options.client.pull(deviceId, cursor, 500))
      options.repository.assertActiveScope(scopeKey)
      records.push(...pulled.records.map((record) => normalizeRecord(record, scopeKey)))
      const nextCursor = String(pulled.cursor)
      if (!pulled.hasMore) return records
      if (nextCursor === (cursor ?? '0')) throw new Error('REMOTE_PREVIEW_CURSOR_STALLED')
      cursor = nextCursor
    }
    throw new Error('REMOTE_PREVIEW_TOO_MANY_PAGES')
  }

  async function recoverAlreadyResolved(
    pending: SyncConflictRecord,
    deviceId: string,
    scopeKey: string,
    authoritativeStatus: string | null,
  ) {
    options.repository.assertActiveScope(scopeKey)
    const gatewayConflictId = pending.gatewayConflictId ?? pending.id
    const listed = await withRetry(() => options.client.conflicts(deviceId))
    options.repository.assertActiveScope(scopeKey)
    if (listed.conflicts.some((conflict) => conflict.id === gatewayConflictId)) {
      throw new Error('CONFLICT_RESOLUTION_RECOVERY_PENDING')
    }

    let latestTarget: SyncRecordEnvelope | null = null
    const currentCursor = await options.repository.getCursor()
    async function inspectFrom(cursor: string | null, applySafeRecords: boolean) {
      let nextCursor = cursor
      let hasMore = true
      while (hasMore) {
        const pulled = await withRetry(() => options.client.pull(deviceId, nextCursor))
        options.repository.assertActiveScope(scopeKey)
        for (const wireRecord of pulled.records) {
          const record = normalizeRecord(wireRecord, scopeKey)
          if (record.entityType === pending.entityType && record.entityId === pending.entityId) {
            if (!latestTarget || record.revision >= latestTarget.revision) latestTarget = record
          } else if (applySafeRecords && !await options.repository.hasOpenConflict(record.key)) {
            await options.repository.applyRemoteRecord(record)
          }
        }
        nextCursor = String(pulled.cursor)
        if (applySafeRecords) await options.repository.setCursor(nextCursor)
        hasMore = pulled.hasMore
      }
    }

    await inspectFrom(currentCursor, true)
    if (!latestTarget && currentCursor !== null) {
      await inspectFrom(null, false)
    }

    const finalTarget = latestTarget as SyncRecordEnvelope | null
    if (pending.resolution === 'keep_remote') {
      if (authoritativeStatus !== 'resolved_keep_remote') {
        await options.repository.reopenConflict(
          pending.id,
          finalTarget ?? undefined,
          authoritativeStatus ?? 'unknown',
        )
        throw new Error(authoritativeStatus === 'resolved_keep_local'
          ? 'CONFLICT_RESOLVED_DIFFERENTLY'
          : 'CONFLICT_RESOLUTION_DIRECTION_UNKNOWN')
      }
      const expectedRemote = pending.remote
      if (!expectedRemote
        || !finalTarget
        || finalTarget.revision !== expectedRemote.revision
        || finalTarget.deleted !== expectedRemote.deleted
        || canonicalJson(finalTarget.payload) !== canonicalJson(expectedRemote.payload)) {
        await options.repository.reopenConflict(
          pending.id,
          finalTarget ?? undefined,
          authoritativeStatus,
        )
        throw new Error('CONFLICT_REMOTE_STATE_MISMATCH')
      }
      await options.repository.resolveConflictKeepRemote(pending.id)
      return
    }

    const submitted = pending.submittedLocal ?? pending.local
    if (authoritativeStatus && authoritativeStatus !== 'resolved_keep_local') {
      await options.repository.reopenConflict(
        pending.id,
        finalTarget ?? undefined,
        authoritativeStatus,
      )
      throw new Error('CONFLICT_RESOLVED_DIFFERENTLY')
    }
    if (!finalTarget
      || finalTarget.revision <= (pending.resolutionExpectedRevision ?? 0)
      || finalTarget.deleted !== submitted.deleted
      || canonicalJson(finalTarget.payload) !== canonicalJson(submitted.payload)) {
      throw new Error('CONFLICT_RESOLUTION_RECOVERY_PENDING')
    }
    await options.repository.applyRemoteRecord(finalTarget)
    await options.repository.resolveConflictKeepLocal(pending.id, {
      revision: finalTarget.revision,
      serverUpdatedAt: finalTarget.serverUpdatedAt ?? now(),
    })
  }

  const service = {
    state,
    refreshState,
    async previewRemoteImpact(): Promise<RemoteImpactPreview> {
      const scopeKey = options.repository.getActiveScope()
      const records = await pullRemoteRecordsForPreview(scopeKey)
      const preview: RemoteImpactPreview = {
        total: records.length,
        active: 0,
        deleted: 0,
        create: 0,
        update: 0,
        delete: 0,
        unchanged: 0,
      }
      for (const record of records) {
        const local = await options.repository.getRecord(record.entityType, record.entityId)
        if (record.deleted) {
          preview.deleted += 1
          if (local && !local.deleted) preview.delete += 1
          continue
        }
        preview.active += 1
        if (!local || local.deleted) {
          preview.create += 1
        } else if (
          local.revision !== record.revision
          || local.deleted !== record.deleted
          || canonicalJson(local.payload) !== canonicalJson(record.payload)
        ) {
          preview.update += 1
        } else {
          preview.unchanged += 1
        }
      }
      return preview
    },
    async syncNow(): Promise<SyncRunStats> {
      const scopeKey = options.repository.getActiveScope()
      const requestedGeneration = generation
      if (currentSync?.scopeKey === scopeKey && currentSync.generation === generation) {
        return currentSync.promise
      }
      if (currentSync) await currentSync.promise.catch(() => undefined)
      options.repository.assertActiveScope(scopeKey)
      if (requestedGeneration !== generation) throw new Error('SYNC_CANCELLED')
      if (currentSync?.scopeKey === scopeKey && currentSync.generation === generation) {
        return currentSync.promise
      }
      const runGeneration = generation
      clearAutoTimer()
      automaticRequested = false
      let promise!: Promise<SyncRunStats>
      promise = performSync(scopeKey, runGeneration).catch(async (error) => {
        if (generation !== runGeneration || options.repository.getActiveScope() !== scopeKey) throw error
        state.phase = options.connectivity.isOnline() ? 'error' : 'offline'
        state.online = options.connectivity.isOnline()
        state.error = error instanceof Error ? error.message : String(error)
        failures += 1
        automaticBlocked = !retryable(error)
        if (error instanceof GatewayError && /^SYNC_DAILY_/.test(error.code)) {
          automaticBlocked = false
          const tomorrow = new Date(now())
          tomorrow.setUTCHours(24, 1, 0, 0)
          state.nextRetryAt = error.retryAfterSeconds
            ? now() + error.retryAfterSeconds * 1_000 : tomorrow.getTime()
        } else {
          const retryDelay = error instanceof GatewayError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1_000 : Math.min(300_000, 30_000 * 2 ** (failures - 1))
          state.nextRetryAt = automaticBlocked ? null : now() + retryDelay
        }
        await refreshState()
        throw error
      }).finally(() => {
        if (currentSync?.promise === promise) currentSync = null
        if (generation === runGeneration) {
          scheduleAutomaticSync(automaticRequested ? (options.autoSyncDelayMs ?? 750) : (options.pollIntervalMs ?? 60_000))
        }
      })
      currentSync = { scopeKey, generation: runGeneration, promise }
      return promise
    },
    async resolveConflict(conflictId: string, resolution: 'keep_local' | 'keep_remote') {
      if (!options.connectivity.isOnline()) throw new Error('OFFLINE')
      const conflict = await options.repository.getConflict(conflictId)
      if (!conflict || !new Set(['open', 'resolving']).has(conflict.status)) {
        throw new Error('CONFLICT_NOT_FOUND')
      }
      const scopeKey = options.repository.getActiveScope()
      if (conflict.status === 'open' && conflict.reconciledGatewayStatus) {
        if (resolution === 'keep_remote') {
          await options.repository.resolveConflictKeepRemote(conflictId)
        } else {
          await options.repository.retryReconciledConflictKeepLocal(conflictId)
        }
        await refreshState()
        return { ok: true, resolution }
      }
      const operationId = conflict.resolutionOperationId ?? createMutationId()
      const pending = await options.repository.beginConflictResolution(
        conflictId,
        resolution,
        operationId,
      )
      options.repository.assertActiveScope(scopeKey)
      const deviceId = await options.repository.getOrCreateDeviceId()
      options.repository.assertActiveScope(scopeKey)
      const gatewayConflictId = pending.gatewayConflictId ?? pending.id
      try {
        const response = await withRetry(() => options.client.resolveConflict(
          deviceId,
          gatewayConflictId,
          resolution === 'keep_remote'
            ? { resolution: 'keep_remote', operationId: pending.resolutionOperationId! }
            : {
                resolution: 'keep_local',
                operationId: pending.resolutionOperationId!,
                mutationId: pending.resolutionOperationId!,
                expectedRemoteRevision: pending.resolutionExpectedRevision ?? 0,
              },
        ))
        options.repository.assertActiveScope(scopeKey)
        if (resolution === 'keep_remote') {
          await options.repository.resolveConflictKeepRemote(conflictId)
        } else {
          if (!response.result || response.result.status !== 'applied') {
            throw new Error('INVALID_CONFLICT_RESOLUTION_RESPONSE')
          }
          await options.repository.resolveConflictKeepLocal(conflictId, {
            revision: response.result.revision,
            serverUpdatedAt: response.result.serverUpdatedAt,
          })
        }
      } catch (error) {
        options.repository.assertActiveScope(scopeKey)
        if (error instanceof GatewayError
          && error.status === 409
          && error.code === 'CONFLICT_ALREADY_RESOLVED') {
          const details = error.details && typeof error.details === 'object'
            ? error.details as { status?: unknown }
            : null
          const authoritativeStatus = typeof details?.status === 'string' ? details.status : null
          await recoverAlreadyResolved(pending, deviceId, scopeKey, authoritativeStatus)
        } else {
          throw error
        }
      }
      await refreshState()
      notifySyncDataChanged({ source: 'conflict-resolution', resolution })
      return { ok: true, resolution }
    },
    start() {
      if (started) return
      started = true
      automaticBlocked = false
      if (!unsubscribeOutbox) unsubscribeOutbox = subscribeOutboxChanges()
      if (unsubscribe) return
      void refreshState().catch(() => undefined)
      unsubscribe = options.connectivity.subscribe((online) => {
        state.online = online
        if (online) scheduleAutomaticSync(0)
        else {
          clearAutoTimer()
          state.phase = 'offline'
        }
      })
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const foreground = () => {
          if (isVisible()) scheduleAutomaticSync(0)
          else clearAutoTimer()
        }
        document.addEventListener('visibilitychange', foreground)
        window.addEventListener('focus', foreground)
        unsubscribeForeground = () => {
          document.removeEventListener('visibilitychange', foreground)
          window.removeEventListener('focus', foreground)
        }
      }
      state.online = options.connectivity.isOnline()
      if (!state.online) state.phase = 'offline'
      scheduleAutomaticSync()
    },
    stop() {
      started = false
      generation += 1
      clearAutoTimer()
      unsubscribeForeground?.()
      unsubscribeForeground = null
      unsubscribe?.()
      unsubscribe = null
      unsubscribeOutbox?.()
      unsubscribeOutbox = null
      failures = 0
      automaticBlocked = false
      state.nextRetryAt = null
      state.error = null
      state.phase = options.connectivity.isOnline() ? 'idle' : 'offline'
    },
  }
  return service
}

export type SyncService = ReturnType<typeof createSyncService>
