import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountSyncScope, createSyncDatabase, createSyncRepository, type PendingMutation } from '../data/syncRepository'
import { enableAccountSyncWhenReady } from './accountSyncSetup'
import { createSyncService, type SyncService } from './syncService'
import { GatewayError } from './gatewayClient'

const databases: ReturnType<typeof createSyncDatabase>[] = []
const services: SyncService[] = []

function harness() {
  const database = createSyncDatabase(`sync-automation-${crypto.randomUUID()}`)
  databases.push(database)
  let sequence = 0
  const repository = createSyncRepository(database, { createMutationId: () => `mutation-${++sequence}` })
  let online = true
  let connectivityChanged: ((online: boolean) => void) | null = null
  const client = {
    registerDevice: vi.fn(async () => ({ ok: true as const })),
    push: vi.fn(async (_device: string, mutations: PendingMutation[]) => ({
      results: mutations.map((mutation) => ({
        status: 'applied' as const, mutationId: mutation.mutationId,
        revision: mutation.baseRevision + 1, serverUpdatedAt: Date.now(),
      })),
    })),
    pull: vi.fn(async () => ({ records: [], cursor: 0, hasMore: false })),
    conflicts: vi.fn(async () => ({ conflicts: [] })),
    resolveConflict: vi.fn(),
  }
  const service = createSyncService({
    repository, client, autoSyncDelayMs: 10, pollIntervalMs: 50,
    delay: async () => undefined,
    connectivity: {
      isOnline: () => online,
      subscribe(listener) { connectivityChanged = listener; return () => { connectivityChanged = null } },
    },
  })
  services.push(service)
  return { database, repository, service, client, setOnline(value: boolean) {
    online = value
    connectivityChanged?.(value)
  } }
}

afterEach(async () => {
  services.splice(0).forEach((service) => service.stop())
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close()
    await Dexie.delete(database.name)
  }))
})

describe('automatic mobile sync', () => {
  it('starts automatically on a fresh account device without requiring an empty import preview', async () => {
    const { repository, service, client } = harness()
    repository.setActiveScope(createAccountSyncScope('https://sync.example.test', 'alice'))
    expect(await enableAccountSyncWhenReady(repository, service)).toBe(true)
    expect(await repository.getMetadata('importStatus')).toBe('skipped')
    await vi.waitFor(() => expect(client.pull).toHaveBeenCalled())
  })

  it('keeps the merge choice when the device has local work from before login', async () => {
    const { repository, service, client } = harness()
    await repository.enqueueUpsert('daily_task', 'pre-login', { text: 'choose whether to merge' })
    repository.setActiveScope(createAccountSyncScope('https://sync.example.test', 'alice'))
    expect(await enableAccountSyncWhenReady(repository, service)).toBe(false)
    expect(await repository.getMetadata('importStatus')).toBeNull()
    expect(client.pull).not.toHaveBeenCalled()
  })

  it('uploads durable local edits automatically while online', async () => {
    const { repository, service, client } = harness()
    service.start()
    await repository.enqueueUpsert('daily_task', 'new', { text: 'saved locally' })
    await vi.waitFor(() => expect(client.push).toHaveBeenCalled())
    await vi.waitFor(() => expect(service.state.pending).toBe(0))
    expect((await repository.getRecord('daily_task', 'new'))?.revision).toBe(1)
  })

  it('pulls while active and on foreground, and stops scheduling after sign-out', async () => {
    const { service, client } = harness()
    service.start()
    await vi.waitFor(() => expect(client.pull.mock.calls.length).toBeGreaterThanOrEqual(2))
    const beforeForeground = client.pull.mock.calls.length
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(client.pull.mock.calls.length).toBeGreaterThan(beforeForeground))
    service.stop()
    const afterStop = client.pull.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(client.pull).toHaveBeenCalledTimes(afterStop)
  })

  it('keeps offline work queued until connectivity returns', async () => {
    const { repository, service, client, setOnline } = harness()
    setOnline(false)
    service.start()
    await repository.enqueueUpsert('daily_task', 'offline', { text: 'offline edit' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(client.push).not.toHaveBeenCalled()
    expect(await repository.pendingCount()).toBe(1)
    setOnline(true)
    await vi.waitFor(() => expect(client.push).toHaveBeenCalledTimes(1))
  })

  it('uploads edits made during a pull in a subsequent automatic pass', async () => {
    const { repository, service, client } = harness()
    let finishPull!: () => void
    client.pull.mockImplementationOnce(() => new Promise((resolve) => {
      finishPull = () => resolve({ records: [], cursor: 0, hasMore: false })
    }))
    service.start()
    await vi.waitFor(() => expect(finishPull).toBeDefined())
    await repository.enqueueUpsert('daily_task', 'during-pull', { text: 'newer edit' })
    finishPull()
    await vi.waitFor(() => expect(client.push).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(service.state.pending).toBe(0))
  })

  it('starts the new account after an in-flight sync from the old account is cancelled', async () => {
    const { repository, service, client } = harness()
    repository.setActiveScope(createAccountSyncScope('https://sync.example.test', 'old'))
    let finishPull!: () => void
    client.pull.mockImplementationOnce(() => new Promise((resolve) => {
      finishPull = () => resolve({ records: [], cursor: 22, hasMore: false })
    }))
    service.start()
    await vi.waitFor(() => expect(finishPull).toBeDefined())
    service.stop()
    repository.setActiveScope(createAccountSyncScope('https://sync.example.test', 'new'))
    service.start()
    const firstNewSync = service.syncNow()
    const secondNewSync = service.syncNow()
    finishPull()
    await Promise.all([firstNewSync, secondNewSync])
    expect(client.registerDevice).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(client.pull.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(await repository.getCursor()).toBe('0')
    expect(service.state.error).toBeNull()
  })

  it('batches at most five independent records and rebases later edits only after acknowledgement', async () => {
    const { repository, service, client } = harness()
    await repository.enqueueBatch(Array.from({ length: 12 }, (_, index) => ({
      entityType: 'daily_task' as const, entityId: `task-${index}`, operation: 'upsert' as const,
      payload: { text: `task ${index}` },
    })))
    await repository.enqueueUpsert('daily_task', 'task-0', { text: 'updated while offline' })
    await service.syncNow()
    const batches = client.push.mock.calls.map(([, mutations]) => mutations)
    expect(batches.map((batch) => batch.length)).toEqual([5, 5, 3])
    expect(batches.every((batch) => new Set(batch.map((item) => item.recordKey)).size === batch.length)).toBe(true)
    expect(batches.flat().find((item) => item.record.payload.text === 'updated while offline')?.baseRevision).toBe(1)
    expect((await repository.getRecord('daily_task', 'task-0'))?.payload.text).toBe('updated while offline')
    expect(await repository.pendingCount()).toBe(0)
  })

  it('repairs a legacy outbox whose old write would otherwise be uploaded after the latest local content', async () => {
    const { database, repository, service, client } = harness()
    const first = await repository.enqueueUpsert('daily_task', 'legacy-order', { text: 'old' })
    const latest = await repository.enqueueUpsert('daily_task', 'legacy-order', { text: 'latest' })
    await database.outbox.update(first.mutationId, { createdAt: 1_001 })
    await database.outbox.update(latest.mutationId, { createdAt: 1_000 })
    await service.syncNow()
    const uploaded = client.push.mock.calls.flatMap(([, batch]) => batch)
    expect(uploaded.at(-1)?.record.payload.text).toBe('latest')
    expect(uploaded.at(-1)?.mutationId).not.toBe(latest.mutationId)
    expect(uploaded.at(-1)?.baseRevision).toBe(2)
    expect((await repository.getRecord('daily_task', 'legacy-order'))?.payload.text).toBe('latest')
    expect(await repository.pendingCount()).toBe(0)
  })

  it('does not retry exhausted daily quota immediately or discard pending data', async () => {
    const { repository, service, client } = harness()
    await repository.enqueueUpsert('daily_task', 'quota', { text: 'keep me' })
    client.push.mockRejectedValue(new GatewayError(503, 'SYNC_DAILY_WRITE_LIMIT', { retryAfterSeconds: 3_600 }))
    const before = Date.now()
    await expect(service.syncNow()).rejects.toThrow('SYNC_DAILY_WRITE_LIMIT')
    expect(client.push).toHaveBeenCalledTimes(1)
    expect(await repository.pendingCount()).toBe(1)
    expect(service.state.nextRetryAt).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(service.state.nextRetryAt).toBeLessThanOrEqual(Date.now() + 3_600_000)
    service.start()
    await repository.enqueueUpsert('daily_task', 'quota-new', { text: 'another edit' })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(client.push).toHaveBeenCalledTimes(1)
  })

  it('resolves a pull-created conflict without sending its local ID to the gateway', async () => {
    const { repository, service, client } = harness()
    const mutation = await repository.enqueueUpsert('daily_task', 'pull-race', { text: 'local' })
    await repository.applyRemoteRecord({
      ...mutation.record, payload: { text: 'remote' }, revision: 2, serverUpdatedAt: Date.now(),
    })
    const [conflict] = await repository.listConflicts()
    await service.resolveConflict(conflict.id, 'keep_local')
    expect(client.resolveConflict).not.toHaveBeenCalled()
    expect(await repository.listPushableMutations()).toMatchObject([{
      baseRevision: 2, record: { payload: { text: 'local' } },
    }])
  })
})
