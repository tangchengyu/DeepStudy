import { describe, expect, it, vi } from 'vitest'
import { GatewayError, type RemoteActiveTimer, type TimerClaimInput } from './gatewayClient'
import { createFocusTimerService } from './focusTimerService'

function harness(options: {
  now?: number
  online?: boolean
  metadata?: Map<string, string>
  remote?: RemoteActiveTimer | null
  scope?: string
} = {}) {
  let now = options.now ?? 1_000
  let online = options.online ?? false
  let scope = options.scope ?? 'timer-scope-a'
  let remote = options.remote ?? null
  let sequence = 0
  const metadata = options.metadata ?? new Map<string, string>()
  const records: Array<{ entityType: string; entityId: string; payload: Record<string, unknown> }> = []
  const writeScopes: string[] = []
  const listeners = new Set<(value: boolean) => void>()
  const repository = {
    getActiveScope: vi.fn(() => scope),
    assertActiveScope: vi.fn((expected: string) => {
      if (expected !== scope) throw new Error('SYNC_SCOPE_CHANGED')
    }),
    getMetadata: vi.fn(async (key: string) => metadata.get(key) ?? null),
    setMetadata: vi.fn(async (key: string, value: string) => {
      writeScopes.push(scope)
      metadata.set(key, value)
    }),
    removeMetadata: vi.fn(async (key: string) => { metadata.delete(key) }),
    getOrCreateDeviceId: vi.fn(async () => 'device-local'),
    enqueueUpsert: vi.fn(async (entityType: string, entityId: string, payload: Record<string, unknown>) => {
      writeScopes.push(scope)
      records.push({ entityType, entityId, payload })
      return {} as never
    }),
    enqueueBatchWithMetadata: vi.fn(async (
      inputs: Array<{ entityType: string; entityId: string; operation: string; payload?: Record<string, unknown> }>,
      writes: Array<{ key: string; value: string | null }>,
    ) => {
      writeScopes.push(scope)
      for (const input of inputs) {
        if (input.operation === 'upsert') {
          records.push({ entityType: input.entityType, entityId: input.entityId, payload: input.payload ?? {} })
        }
      }
      for (const write of writes) {
        if (write.value === null) metadata.delete(write.key)
        else metadata.set(write.key, write.value)
      }
      return []
    }),
  }
  const client = {
    getTimer: vi.fn(async () => ({ timer: remote })),
    claimTimer: vi.fn(async (_deviceId: string, input: TimerClaimInput) => {
      remote = {
        mode: input.mode as 'focus' | 'rest',
        ownerDeviceId: 'device-local',
        status: input.status as 'running' | 'paused',
        leaseVersion: Number(input.expectedLeaseVersion) + 1,
        targetEndAt: input.targetEndAt as number | null,
        remainingMs: Number(input.remainingMs),
        plannedMs: Number(input.plannedMs),
        sessionStartAt: input.sessionStartAt as number | null,
        segmentStartAt: input.segmentStartAt as number | null,
        accumulatedMs: Number(input.accumulatedMs),
        workType: input.workType as RemoteActiveTimer['workType'],
        updatedAt: now,
      }
      return { timer: remote }
    }),
    releaseTimer: vi.fn(async () => {
      remote = null
      return { timer: null as null }
    }),
  }
  const connectivity = {
    isOnline: () => online,
    subscribe(listener: (value: boolean) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const service = createFocusTimerService({
    repository,
    client,
    connectivity,
    now: () => now,
    createId: () => `record-${++sequence}`,
  })
  return {
    service,
    client,
    metadata,
    records,
    writeScopes,
    advance(milliseconds: number) { now += milliseconds },
    setScope(value: string) { scope = value },
    setRemote(value: RemoteActiveTimer | null) { remote = value },
    async setOnline(value: boolean) {
      online = value
      for (const listener of listeners) listener(value)
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

function recordsOf(
  records: Array<{ entityType: string; payload: Record<string, unknown> }>,
  entityType: string,
) {
  return records.filter((record) => record.entityType === entityType)
}

describe('focus timer service', () => {
  it('persists focus locally, recomputes from targetEndAt, and accounts pause/resume/completion once', async () => {
    const test = harness()
    await test.service.initialize()
    await test.service.setDuration(1)
    await test.service.start()

    test.advance(20_000)
    await test.service.tick()
    expect(test.service.state.local.remainingMs).toBe(40_000)
    await test.service.pause()

    test.advance(5_000)
    await test.service.resume()
    test.advance(50_000)
    await test.service.tick()
    await test.service.tick()

    expect(test.service.state.local.status).toBe('completed')
    const audits = recordsOf(test.records, 'time_audit')
    expect(audits.map((entry) => entry.payload.durationMs)).toEqual([20_000, 40_000])
    expect(recordsOf(test.records, 'focus_session')).toHaveLength(1)
    expect(recordsOf(test.records, 'focus_session')[0].payload).toMatchObject({
      plannedMs: 60_000,
      focusedMs: 60_000,
      completed: true,
      type: 'core',
    })
    expect(recordsOf(test.records, 'mode_event').map((entry) => entry.payload.action))
      .toEqual(['started', 'paused', 'resumed', 'completed'])
    expect(JSON.parse(test.metadata.get('activeTimer.v1') ?? '{}')).toMatchObject({
      status: 'completed',
      remainingMs: 0,
    })
  })

  it('rest reset records only elapsed rest once and returns to the configured duration', async () => {
    const test = harness()
    await test.service.initialize()
    await test.service.setMode('rest')
    await test.service.setDuration(2)
    await test.service.start()
    test.advance(30_000)

    await test.service.reset()
    await test.service.reset()

    expect(test.service.state.local).toMatchObject({
      mode: 'rest',
      status: 'idle',
      remainingMs: 120_000,
    })
    expect(recordsOf(test.records, 'time_audit').map((entry) => entry.payload))
      .toEqual([expect.objectContaining({ category: 'rest', durationMs: 30_000 })])
    expect(recordsOf(test.records, 'focus_session')).toHaveLength(0)
  })

  it('quick distraction pauses focus, records the distraction interval, and returns to focus', async () => {
    const test = harness()
    await test.service.initialize()
    await test.service.start()
    test.advance(10_000)

    await test.service.startDistraction()
    expect(test.service.state.local.status).toBe('paused')
    test.advance(3_000)
    await test.service.finishDistraction('想看手机', 'controllable', 'interesting', true)

    expect(test.service.state.local.status).toBe('running')
    expect(recordsOf(test.records, 'distraction')[0].payload).toMatchObject({
      text: '想看手机',
      durationMs: 3_000,
      quadrant: 'controllable-interesting',
    })
    expect(recordsOf(test.records, 'time_audit').map((entry) => entry.payload.category))
      .toEqual(['core', 'distraction'])
  })

  it('restores a suspended running timer and completes at the persisted target', async () => {
    const metadata = new Map<string, string>()
    const first = harness({ now: 0, metadata })
    await first.service.initialize()
    await first.service.setDuration(1)
    await first.service.start()

    const restored = harness({ now: 20_000, metadata })
    await restored.service.initialize()
    expect(restored.service.state.local).toMatchObject({ status: 'running', remainingMs: 40_000 })

    restored.advance(40_001)
    await restored.service.reconcileVisibility()
    expect(restored.service.state.local.status).toBe('completed')
    expect(recordsOf(restored.records, 'focus_session')).toHaveLength(1)
  })

  it('claims and releases with lease CAS and only adopts another device after explicit takeover', async () => {
    const remote: RemoteActiveTimer = {
      mode: 'focus',
      ownerDeviceId: 'device-remote',
      status: 'running',
      leaseVersion: 4,
      targetEndAt: 61_000,
      remainingMs: 60_000,
      plannedMs: 60_000,
      sessionStartAt: 1_000,
      segmentStartAt: 1_000,
      accumulatedMs: 0,
      workType: 'maintenance',
      updatedAt: 1_000,
    }
    const test = harness({ online: true, remote })
    await test.service.initialize()

    expect(test.service.state.ownershipConflict).toBe(true)
    expect(test.service.state.remote?.ownerDeviceId).toBe('device-remote')
    await test.service.start()
    expect(test.client.claimTimer).not.toHaveBeenCalled()

    await test.service.takeOverRemote()
    expect(test.client.claimTimer).toHaveBeenCalledWith(
      'device-local',
      expect.objectContaining({ expectedLeaseVersion: 4, takeover: true }),
    )
    expect(test.service.state).toMatchObject({ ownershipConflict: false })
    expect(test.service.state.local).toMatchObject({ mode: 'focus', status: 'running', workType: 'maintenance' })

    await test.service.reset()
    expect(test.client.releaseTimer).toHaveBeenCalledWith('device-local', 5)
  })

  it('refreshes a stale rejected takeover and pauses an old owner after a newer lease is observed', async () => {
    const test = harness({ online: true })
    await test.service.initialize()
    await test.service.start()
    expect(test.service.state.local.leaseVersion).toBe(1)
    test.advance(5_000)
    const newer: RemoteActiveTimer = {
      mode: 'rest',
      ownerDeviceId: 'device-new-owner',
      status: 'running',
      leaseVersion: 2,
      targetEndAt: 20_000,
      remainingMs: 14_000,
      plannedMs: 15_000,
      sessionStartAt: 6_000,
      segmentStartAt: 6_000,
      accumulatedMs: 0,
      workType: 'rest',
      updatedAt: 6_000,
    }
    test.setRemote(newer)

    await test.service.refreshRemote()
    expect(test.service.state.local.status).toBe('paused')
    expect(test.service.state.ownershipConflict).toBe(true)
    expect(test.service.state.remote).toEqual(newer)

    vi.mocked(test.client.claimTimer).mockRejectedValueOnce(
      new GatewayError(409, 'STALE_TIMER_LEASE', { error: 'STALE_TIMER_LEASE', timer: newer }),
    )
    await expect(test.service.takeOverRemote()).resolves.toBe(false)
    expect(test.service.state.remote).toEqual(newer)
    expect(test.service.state.ownershipConflict).toBe(true)
  })

  it('checks remote ownership first on reconnect and never auto-takes another device timer', async () => {
    const test = harness({ online: false })
    await test.service.initialize()
    await test.service.start()
    expect(test.client.claimTimer).not.toHaveBeenCalled()

    test.setRemote({
      mode: 'focus',
      ownerDeviceId: 'device-remote',
      status: 'paused',
      leaseVersion: 9,
      targetEndAt: null,
      remainingMs: 20_000,
      plannedMs: 60_000,
      sessionStartAt: 1_000,
      segmentStartAt: null,
      accumulatedMs: 40_000,
      workType: 'core',
      updatedAt: 2_000,
    })
    await test.setOnline(true)
    await test.service.waitForIdle()

    expect(test.client.getTimer).toHaveBeenCalled()
    expect(test.client.claimTimer).not.toHaveBeenCalled()
    expect(test.service.state.ownershipConflict).toBe(true)
    expect(test.service.state.local.status).toBe('paused')
  })

  it('durably releases its own lease after an offline reset reconnects', async () => {
    const test = harness({ online: true })
    await test.service.initialize()
    await test.service.start()
    expect(test.service.state.local.leaseVersion).toBe(1)

    await test.setOnline(false)
    await test.service.reset()
    expect(test.service.state.local.pendingRelease).toBe(true)
    expect(test.client.releaseTimer).not.toHaveBeenCalled()

    await test.setOnline(true)
    await test.service.waitForIdle()
    expect(test.client.releaseTimer).toHaveBeenCalledWith('device-local', 1)
    expect(test.service.state.local.pendingRelease).toBe(false)
  })

  it('does not duplicate a completed focus session when starting a new round', async () => {
    const test = harness()
    await test.service.initialize()
    await test.service.setDuration(1)
    await test.service.start()
    test.advance(60_000)
    await test.service.tick()
    await test.service.reset()

    expect(recordsOf(test.records, 'focus_session')).toHaveLength(1)
    expect(recordsOf(test.records, 'focus_session')[0].payload.completed).toBe(true)
  })

  it('reloads durable timer state after the account sync scope changes', async () => {
    const test = harness()
    await test.service.initialize()
    await test.service.start()

    test.metadata.set('activeTimer.v1', JSON.stringify({
      ...localTimerForTest('rest'),
      status: 'paused',
      plannedMs: 15 * 60_000,
      remainingMs: 5 * 60_000,
    }))
    await test.service.reloadScope()

    expect(test.service.state.local).toMatchObject({
      mode: 'rest',
      status: 'paused',
      remainingMs: 5 * 60_000,
    })
    expect(test.service.state.remote).toBeNull()
    expect(test.service.state.ownershipConflict).toBe(false)
  })

  it('rejects a timer write that resumes after the account scope changed', async () => {
    const test = harness({ online: true })
    await test.service.initialize()
    vi.mocked(test.client.claimTimer).mockImplementationOnce(async (_deviceId, input) => {
      test.setScope('timer-scope-b')
      return {
        timer: {
          mode: input.mode as 'focus' | 'rest',
          ownerDeviceId: 'device-local',
          status: input.status as 'running' | 'paused',
          leaseVersion: 1,
          targetEndAt: input.targetEndAt as number | null,
          remainingMs: Number(input.remainingMs),
          plannedMs: Number(input.plannedMs),
          sessionStartAt: input.sessionStartAt as number | null,
          segmentStartAt: input.segmentStartAt as number | null,
          accumulatedMs: Number(input.accumulatedMs),
          workType: input.workType as RemoteActiveTimer['workType'],
          updatedAt: 1_000,
        },
      }
    })

    await expect(test.service.start()).rejects.toThrow('SYNC_SCOPE_CHANGED')

    expect(test.writeScopes).not.toContain('timer-scope-b')
  })

  it('fails corrupted persisted timing fields closed instead of producing a stuck NaN timer', async () => {
    const metadata = new Map<string, string>([['activeTimer.v1', JSON.stringify({
      ...localTimerForTest('focus'),
      status: 'running',
      targetEndAt: 'not-a-timestamp',
      segmentStartAt: 1_000,
    })]])
    const test = harness({ metadata, now: 2_000 })

    await test.service.initialize()

    expect(test.service.state.local).toMatchObject({
      mode: 'focus',
      status: 'idle',
      remainingMs: 25 * 60_000,
      targetEndAt: null,
    })
  })
})

function localTimerForTest(mode: 'focus' | 'rest') {
  return {
    version: 1,
    mode,
    status: 'idle',
    plannedMs: (mode === 'focus' ? 25 : 15) * 60_000,
    remainingMs: (mode === 'focus' ? 25 : 15) * 60_000,
    targetEndAt: null,
    sessionStartAt: null,
    segmentStartAt: null,
    accumulatedMs: 0,
    workType: mode === 'focus' ? 'core' : 'rest',
    leaseVersion: 0,
    ownerDeviceId: null,
    needsOwnershipCheck: false,
    pendingRelease: false,
    distractionStartedAt: null,
    focusDurationMinutes: 25,
    restDurationMinutes: 15,
    updatedAt: 1,
  }
}
