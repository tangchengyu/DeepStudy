import { reactive } from 'vue'
import type { MetadataWrite, SyncEntityType, SyncMutationInput, SyncPayload } from '../data/syncRepository'
import type { ConnectivityMonitor } from './connectivity'
import {
  GatewayError,
  type GatewayClient,
  type RemoteActiveTimer,
  type TimerClaimInput,
} from './gatewayClient'

const ACTIVE_TIMER_METADATA_KEY = 'activeTimer.v1'
const MINUTE_MS = 60_000

export type TimerMode = 'focus' | 'rest'
export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed'
export type FocusWorkType = 'core' | 'maintenance'

export interface LocalTimerState {
  version: 1
  mode: TimerMode
  status: TimerStatus
  plannedMs: number
  remainingMs: number
  targetEndAt: number | null
  sessionStartAt: number | null
  segmentStartAt: number | null
  accumulatedMs: number
  workType: FocusWorkType | 'rest'
  leaseVersion: number
  ownerDeviceId: string | null
  needsOwnershipCheck: boolean
  pendingRelease: boolean
  distractionStartedAt: number | null
  focusDurationMinutes: number
  restDurationMinutes: number
  updatedAt: number
}

export interface FocusTimerState {
  local: LocalTimerState
  remote: RemoteActiveTimer | null
  ownershipConflict: boolean
  busy: boolean
  message: string
}

interface TimerRepository {
  getActiveScope?: () => string
  assertActiveScope?: (scopeKey: string) => void
  getMetadata(key: string): Promise<string | null>
  setMetadata(key: string, value: string): Promise<void>
  removeMetadata(key: string): Promise<void>
  getOrCreateDeviceId(): Promise<string>
  enqueueUpsert(entityType: SyncEntityType, entityId: string, payload: SyncPayload): Promise<unknown>
  enqueueBatchWithMetadata?: (
    inputs: SyncMutationInput[],
    metadataWrites: MetadataWrite[],
  ) => Promise<unknown>
}

type TimerGatewayClient = Pick<GatewayClient, 'claimTimer' | 'getTimer' | 'releaseTimer'>

export interface FocusTimerServiceOptions {
  repository: TimerRepository
  client: TimerGatewayClient
  connectivity: ConnectivityMonitor
  now?: () => number
  createId?: () => string
}

function boundedMinutes(value: number) {
  return Math.max(1, Math.min(240, Math.round(Number(value) || 1)))
}

function validNullableTimestamp(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

function defaultLocal(now: number): LocalTimerState {
  return {
    version: 1,
    mode: 'focus',
    status: 'idle',
    plannedMs: 25 * MINUTE_MS,
    remainingMs: 25 * MINUTE_MS,
    targetEndAt: null,
    sessionStartAt: null,
    segmentStartAt: null,
    accumulatedMs: 0,
    workType: 'core',
    leaseVersion: 0,
    ownerDeviceId: null,
    needsOwnershipCheck: false,
    pendingRelease: false,
    distractionStartedAt: null,
    focusDurationMinutes: 25,
    restDurationMinutes: 15,
    updatedAt: now,
  }
}

function parseLocalTimer(raw: string | null, now: number) {
  if (!raw) return defaultLocal(now)
  try {
    const parsed = JSON.parse(raw) as Partial<LocalTimerState>
    if (parsed.version !== 1
      || !new Set(['focus', 'rest']).has(String(parsed.mode))
      || !new Set(['idle', 'running', 'paused', 'completed']).has(String(parsed.status))
      || !Number.isFinite(parsed.plannedMs)
      || Number(parsed.plannedMs) <= 0
      || Number(parsed.plannedMs) > 240 * MINUTE_MS
      || !Number.isFinite(parsed.remainingMs)
      || Number(parsed.remainingMs) < 0
      || !validNullableTimestamp(parsed.targetEndAt)
      || !validNullableTimestamp(parsed.sessionStartAt)
      || !validNullableTimestamp(parsed.segmentStartAt)
      || !validNullableTimestamp(parsed.distractionStartedAt)
      || (parsed.status === 'running' && (parsed.targetEndAt === null || parsed.segmentStartAt === null))
      || !Number.isFinite(parsed.accumulatedMs)
      || Number(parsed.accumulatedMs) < 0
      || !Number.isFinite(parsed.leaseVersion)
      || Number(parsed.leaseVersion) < 0
      || !new Set(['core', 'maintenance', 'rest']).has(String(parsed.workType))) {
      return defaultLocal(now)
    }
    const base = defaultLocal(now)
    return {
      ...base,
      ...parsed,
      plannedMs: Math.max(1, Number(parsed.plannedMs)),
      remainingMs: Math.max(0, Number(parsed.remainingMs)),
      focusDurationMinutes: boundedMinutes(Number(parsed.focusDurationMinutes ?? 25)),
      restDurationMinutes: boundedMinutes(Number(parsed.restDurationMinutes ?? 15)),
      leaseVersion: Math.max(0, Math.round(Number(parsed.leaseVersion) || 0)),
      accumulatedMs: Math.max(0, Number(parsed.accumulatedMs) || 0),
      pendingRelease: parsed.pendingRelease === true,
    } as LocalTimerState
  } catch {
    return defaultLocal(now)
  }
}

function remoteFromError(error: unknown): RemoteActiveTimer | null | undefined {
  if (!(error instanceof GatewayError) || error.status !== 409) return undefined
  if (!error.details || typeof error.details !== 'object' || !('timer' in error.details)) return undefined
  return (error.details as { timer: RemoteActiveTimer | null }).timer
}

export function createFocusTimerService(options: FocusTimerServiceOptions) {
  const now = options.now ?? (() => Date.now())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const state = reactive<FocusTimerState>({
    local: defaultLocal(now()),
    remote: null,
    ownershipConflict: false,
    busy: false,
    message: '',
  })
  let deviceId = ''
  let initialized = false
  let unsubscribeConnectivity: (() => void) | null = null
  let operation = Promise.resolve<unknown>(undefined)
  let operationScope: string | null = null
  let pendingRecords: SyncMutationInput[] | null = null

  function enqueue<T>(task: () => Promise<T>) {
    const scopeKey = options.repository.getActiveScope?.() ?? null
    const run = async () => {
      const previousScope = operationScope
      const previousRecords = pendingRecords
      operationScope = scopeKey
      pendingRecords = []
      try {
        assertOperationScope()
        const result = await task()
        assertOperationScope()
        return result
      } finally {
        operationScope = previousScope
        pendingRecords = previousRecords
      }
    }
    const result = operation.then(run, run)
    operation = result.then(() => undefined, () => undefined)
    return result
  }

  function assertOperationScope() {
    if (operationScope) options.repository.assertActiveScope?.(operationScope)
  }

  async function persist() {
    assertOperationScope()
    state.local.updatedAt = now()
    const metadata = { key: ACTIVE_TIMER_METADATA_KEY, value: JSON.stringify(state.local) }
    const records = pendingRecords ?? []
    if (records.length && options.repository.enqueueBatchWithMetadata) {
      await options.repository.enqueueBatchWithMetadata(records, [metadata])
      pendingRecords = []
      return
    }
    for (const record of records) {
      if (record.operation === 'delete') continue
      await options.repository.enqueueUpsert(record.entityType, record.entityId, record.payload ?? {})
    }
    pendingRecords = []
    await options.repository.setMetadata(ACTIVE_TIMER_METADATA_KEY, metadata.value)
  }

  async function addRecord(entityType: SyncEntityType, payload: SyncPayload) {
    const entityId = createId()
    assertOperationScope()
    const mutation = {
      entityType,
      entityId,
      operation: 'upsert' as const,
      payload: { id: entityId, ...payload },
    }
    if (pendingRecords) pendingRecords.push(mutation)
    else await options.repository.enqueueUpsert(entityType, entityId, mutation.payload)
    return entityId
  }

  async function modeEvent(action: string, details: SyncPayload = {}) {
    const timestamp = now()
    await addRecord('mode_event', {
      state: `${state.local.mode}-${action}`,
      action,
      mode: state.local.mode,
      timestamp,
      ...details,
    })
  }

  function currentRemaining(at = now()) {
    return state.local.status === 'running' && state.local.targetEndAt !== null
      ? Math.max(0, state.local.targetEndAt - at)
      : Math.max(0, state.local.remainingMs)
  }

  async function writeAudit(category: FocusWorkType | 'rest' | 'distraction', start: number, end: number, details: SyncPayload = {}) {
    const durationMs = Math.max(0, Math.round(end - start))
    if (durationMs < 1_000) return 0
    await addRecord('time_audit', { category, durationMs, start, end: start + durationMs, ...details })
    return durationMs
  }

  async function finalizeSegment(endAt: number) {
    const start = state.local.segmentStartAt
    if (start === null) return 0
    const safeEnd = Math.max(start, endAt)
    const durationMs = Math.max(0, safeEnd - start)
    state.local.segmentStartAt = null
    state.local.accumulatedMs += durationMs
    await writeAudit(
      state.local.mode === 'focus' ? state.local.workType as FocusWorkType : 'rest',
      start,
      safeEnd,
    )
    return durationMs
  }

  function claimInput(expectedLeaseVersion: number, takeover = false): TimerClaimInput {
    return {
      mode: state.local.mode,
      status: state.local.status === 'running' ? 'running' : 'paused',
      expectedLeaseVersion,
      targetEndAt: state.local.status === 'running' ? state.local.targetEndAt : null,
      remainingMs: Math.round(currentRemaining()),
      plannedMs: Math.max(1, Math.round(state.local.plannedMs)),
      sessionStartAt: state.local.sessionStartAt,
      segmentStartAt: state.local.status === 'running' ? state.local.segmentStartAt : null,
      accumulatedMs: Math.max(0, Math.round(state.local.accumulatedMs)),
      workType: state.local.mode === 'focus' ? state.local.workType as FocusWorkType : 'rest',
      takeover,
    }
  }

  function applyLease(timer: RemoteActiveTimer) {
    state.remote = timer
    state.local.leaseVersion = timer.leaseVersion
    state.local.ownerDeviceId = timer.ownerDeviceId
    state.local.needsOwnershipCheck = false
    state.local.pendingRelease = false
    state.ownershipConflict = timer.ownerDeviceId !== deviceId
  }

  function applyGatewayFailure(error: unknown) {
    const remote = remoteFromError(error)
    if (remote !== undefined) {
      state.remote = remote
      state.ownershipConflict = Boolean(remote && remote.ownerDeviceId !== deviceId)
      if (remote?.ownerDeviceId === deviceId) {
        state.local.leaseVersion = remote.leaseVersion
        state.local.ownerDeviceId = deviceId
      }
      state.message = state.ownershipConflict ? '另一台设备正在计时，请确认后接管。' : '计时租约已更新，请重试。'
      return true
    }
    state.local.needsOwnershipCheck = true
    state.message = '当前为本地计时；联网后会先检查其他设备。'
    return false
  }

  async function claimLease(takeover = false, expectedOverride?: number) {
    if (!options.connectivity.isOnline()) {
      state.local.needsOwnershipCheck = true
      await persist()
      return true
    }
    const expected = expectedOverride
      ?? (state.local.ownerDeviceId === deviceId ? state.local.leaseVersion : state.remote?.leaseVersion ?? 0)
    try {
      const result = await options.client.claimTimer(deviceId, claimInput(expected, takeover))
      applyLease(result.timer)
      state.ownershipConflict = false
      state.message = ''
      await persist()
      return true
    } catch (error) {
      applyGatewayFailure(error)
      await persist()
      return !(error instanceof GatewayError && error.status === 409)
    }
  }

  async function releaseLease() {
    const lease = state.local.leaseVersion
    if (!lease || state.local.ownerDeviceId !== deviceId) return true
    if (!options.connectivity.isOnline()) {
      state.local.needsOwnershipCheck = true
      state.local.pendingRelease = true
      return true
    }
    try {
      await options.client.releaseTimer(deviceId, lease)
      state.remote = null
      state.local.leaseVersion = 0
      state.local.ownerDeviceId = null
      state.local.needsOwnershipCheck = false
      state.local.pendingRelease = false
      state.ownershipConflict = false
      return true
    } catch (error) {
      applyGatewayFailure(error)
      state.local.pendingRelease = true
      return false
    }
  }

  async function saveFocusSession(completed: boolean, end: number) {
    if (state.local.mode !== 'focus' || state.local.sessionStartAt === null) return
    const workType = state.local.workType as FocusWorkType
    await addRecord('focus_session', {
      start: state.local.sessionStartAt,
      end,
      plannedMs: state.local.plannedMs,
      focusedMs: Math.round(state.local.accumulatedMs),
      type: workType,
      types: [workType],
      completed,
    })
  }

  async function completeInternal(endAt: number) {
    if (state.local.status === 'completed') return false
    await finalizeSegment(endAt)
    state.local.remainingMs = 0
    state.local.targetEndAt = null
    state.local.status = 'completed'
    await saveFocusSession(true, endAt)
    state.local.sessionStartAt = null
    await modeEvent('completed')
    await releaseLease()
    await persist()
    return true
  }

  async function pauseInternal(reason: string, updateLease = true) {
    if (state.local.status !== 'running') return false
    const at = now()
    const remaining = currentRemaining(at)
    await finalizeSegment(at)
    state.local.remainingMs = remaining
    state.local.targetEndAt = null
    state.local.status = 'paused'
    await modeEvent('paused', { reason, remainingMs: Math.round(remaining) })
    await persist()
    if (updateLease) await claimLease(false)
    return true
  }

  async function resumeInternal() {
    if (state.local.status !== 'paused' || state.ownershipConflict) return false
    const at = now()
    state.local.status = 'running'
    state.local.targetEndAt = at + state.local.remainingMs
    state.local.segmentStartAt = at
    state.local.needsOwnershipCheck ||= !options.connectivity.isOnline()
    await modeEvent('resumed')
    await persist()
    const claimed = await claimLease(false)
    if (!claimed && state.ownershipConflict) await pauseInternal('ownership-conflict', false)
    return claimed
  }

  async function refreshRemoteInternal() {
    if (!options.connectivity.isOnline()) return null
    try {
      const result = await options.client.getTimer(deviceId)
      state.remote = result.timer
      const anotherOwner = Boolean(result.timer && result.timer.ownerDeviceId !== deviceId)
      state.ownershipConflict = anotherOwner
      if (anotherOwner) {
        state.local.pendingRelease = false
        if (state.local.status === 'running') await pauseInternal('newer-remote-lease', false)
        state.message = '另一台设备正在计时。本机保持只读，接管前不会继续。'
        await persist()
        return result.timer
      }
      if (result.timer?.ownerDeviceId === deviceId) {
        state.local.leaseVersion = result.timer.leaseVersion
        state.local.ownerDeviceId = deviceId
      }
      if (!result.timer && state.local.pendingRelease) {
        state.local.pendingRelease = false
        state.local.leaseVersion = 0
        state.local.ownerDeviceId = null
      }
      if (result.timer?.ownerDeviceId === deviceId && state.local.pendingRelease) {
        await releaseLease()
        await persist()
        return null
      }
      state.message = ''
      if (state.local.status === 'running'
        && (state.local.needsOwnershipCheck || !result.timer)) {
        await claimLease(false, result.timer?.leaseVersion ?? 0)
      }
      await persist()
      return result.timer
    } catch (error) {
      applyGatewayFailure(error)
      await persist()
      return null
    }
  }

  const service = {
    state,
    async initialize() {
      if (initialized) return
      state.local = parseLocalTimer(await options.repository.getMetadata(ACTIVE_TIMER_METADATA_KEY), now())
      deviceId = await options.repository.getOrCreateDeviceId()
      initialized = true
      unsubscribeConnectivity = options.connectivity.subscribe((online) => {
        if (online) void enqueue(refreshRemoteInternal)
      })
      await enqueue(async () => {
        if (state.local.status === 'running') {
          const remaining = currentRemaining()
          state.local.remainingMs = remaining
          if (remaining <= 0) await completeInternal(state.local.targetEndAt ?? now())
          else await persist()
        }
        if (options.connectivity.isOnline()) await refreshRemoteInternal()
      })
    },
    destroy() {
      unsubscribeConnectivity?.()
      unsubscribeConnectivity = null
    },
    waitForIdle() {
      return operation.then(() => undefined)
    },
    reloadScope(refreshGateway = true) {
      return enqueue(async () => {
        state.remote = null
        state.ownershipConflict = false
        state.message = ''
        state.local = parseLocalTimer(
          await options.repository.getMetadata(ACTIVE_TIMER_METADATA_KEY),
          now(),
        )
        deviceId = await options.repository.getOrCreateDeviceId()
        if (state.local.status === 'running') {
          const remaining = currentRemaining()
          state.local.remainingMs = remaining
          if (remaining <= 0) await completeInternal(state.local.targetEndAt ?? now())
          else await persist()
        }
        if (refreshGateway && options.connectivity.isOnline()) await refreshRemoteInternal()
      })
    },
    remainingMs() {
      return currentRemaining()
    },
    setMode(mode: TimerMode) {
      return enqueue(async () => {
        if (state.local.status === 'running' || state.local.status === 'paused') return false
        state.local.mode = mode
        const minutes = mode === 'focus'
          ? state.local.focusDurationMinutes
          : state.local.restDurationMinutes
        state.local.plannedMs = minutes * MINUTE_MS
        state.local.remainingMs = state.local.plannedMs
        state.local.status = 'idle'
        state.local.workType = mode === 'focus' ? 'core' : 'rest'
        await persist()
        return true
      })
    },
    setDuration(minutes: number) {
      return enqueue(async () => {
        if (state.local.status === 'running' || state.local.status === 'paused') return false
        const bounded = boundedMinutes(minutes)
        if (state.local.mode === 'focus') state.local.focusDurationMinutes = bounded
        else state.local.restDurationMinutes = bounded
        state.local.plannedMs = bounded * MINUTE_MS
        state.local.remainingMs = state.local.plannedMs
        state.local.status = 'idle'
        await persist()
        return true
      })
    },
    setWorkType(workType: FocusWorkType) {
      return enqueue(async () => {
        if (state.local.mode !== 'focus' || state.local.status === 'running') return false
        state.local.workType = workType
        await persist()
        return true
      })
    },
    start() {
      return enqueue(async () => {
        if (state.local.status !== 'idle' || state.ownershipConflict) return false
        const at = now()
        state.local.status = 'running'
        state.local.sessionStartAt = at
        state.local.segmentStartAt = at
        state.local.targetEndAt = at + state.local.remainingMs
        state.local.accumulatedMs = 0
        state.local.distractionStartedAt = null
        state.local.needsOwnershipCheck = !options.connectivity.isOnline()
        await modeEvent('started', {
          plannedMinutes: state.local.plannedMs / MINUTE_MS,
          workType: state.local.workType,
        })
        await persist()
        const claimed = await claimLease(false)
        if (!claimed && state.ownershipConflict) await pauseInternal('ownership-conflict', false)
        return claimed
      })
    },
    pause(reason = 'manual') {
      return enqueue(() => pauseInternal(reason))
    },
    resume() {
      return enqueue(resumeInternal)
    },
    tick() {
      return enqueue(async () => {
        if (state.local.status !== 'running') return false
        const remaining = currentRemaining()
        state.local.remainingMs = remaining
        if (remaining <= 0) return completeInternal(state.local.targetEndAt ?? now())
        return false
      })
    },
    reconcileVisibility() {
      return service.tick()
    },
    reset() {
      return enqueue(async () => {
        const hadSession = state.local.sessionStartAt !== null
        if (!hadSession && state.local.status === 'idle') return false
        const at = now()
        if (state.local.status === 'running') await finalizeSegment(at)
        if (hadSession) await saveFocusSession(false, at)
        await modeEvent('reset')
        await releaseLease()
        state.local.status = 'idle'
        state.local.remainingMs = state.local.plannedMs
        state.local.targetEndAt = null
        state.local.sessionStartAt = null
        state.local.segmentStartAt = null
        state.local.accumulatedMs = 0
        state.local.distractionStartedAt = null
        if (!state.local.pendingRelease) {
          state.local.leaseVersion = 0
          state.local.ownerDeviceId = null
        }
        await persist()
        return true
      })
    },
    startDistraction() {
      return enqueue(async () => {
        if (state.local.mode !== 'focus' || state.local.status !== 'running') return false
        await pauseInternal('distraction', true)
        state.local.distractionStartedAt = now()
        await modeEvent('distraction-started')
        await persist()
        return true
      })
    },
    finishDistraction(
      rawText: string,
      control: 'controllable' | 'uncontrollable',
      interest: 'interesting' | 'boring',
      returnToFocus: boolean,
    ) {
      return enqueue(async () => {
        const startedAt = state.local.distractionStartedAt
        if (startedAt === null) return false
        const endedAt = now()
        const durationMs = Math.max(0, endedAt - startedAt)
        const text = rawText.trim() || '未命名干扰'
        const distractionId = await addRecord('distraction', {
          text,
          content: text,
          control,
          interest,
          quadrant: `${control}-${interest}`,
          durationMs,
          resolved: true,
          timestamp: endedAt,
        })
        await writeAudit('distraction', startedAt, endedAt, { distractionId })
        state.local.distractionStartedAt = null
        await modeEvent('distraction-ended', { durationMs, returnedToFocus: returnToFocus })
        await persist()
        if (returnToFocus) return resumeInternal()
        return true
      })
    },
    refreshRemote() {
      return enqueue(refreshRemoteInternal)
    },
    takeOverRemote() {
      return enqueue(async () => {
        const remote = state.remote
        if (!remote || remote.ownerDeviceId === deviceId || !options.connectivity.isOnline()) return false
        const previous = { ...state.local }
        const at = now()
        const remaining = remote.status === 'running' && remote.targetEndAt !== null
          ? Math.max(0, remote.targetEndAt - at)
          : remote.remainingMs
        state.local = {
          ...state.local,
          mode: remote.mode,
          status: remaining > 0 ? 'running' : 'completed',
          plannedMs: remote.plannedMs,
          remainingMs: remaining,
          targetEndAt: remaining > 0 ? at + remaining : null,
          sessionStartAt: remote.sessionStartAt ?? at,
          segmentStartAt: remaining > 0 ? at : null,
          accumulatedMs: remote.accumulatedMs,
          workType: remote.mode === 'focus' && remote.workType !== 'rest'
            ? remote.workType ?? 'core'
            : 'rest',
          leaseVersion: remote.leaseVersion,
          ownerDeviceId: remote.ownerDeviceId,
          needsOwnershipCheck: false,
          distractionStartedAt: null,
        }
        await persist()
        const claimed = await claimLease(true, remote.leaseVersion)
        if (!claimed) {
          state.local = previous
          state.ownershipConflict = true
          await persist()
          return false
        }
        await modeEvent('taken-over', { previousOwnerDeviceId: remote.ownerDeviceId })
        await persist()
        return true
      })
    },
  }

  return service
}

export type FocusTimerService = ReturnType<typeof createFocusTimerService>
