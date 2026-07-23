import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAccountSyncScope,
  createSyncDatabase,
  createSyncRepository,
} from '../data/syncRepository'
import { createGatewayClient } from './gatewayClient'
import { createSyncService } from './syncService'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('scoped repository and real gateway client integration', () => {
  it('never pushes old-scope outbox and starts a new-scope cursor at zero', async () => {
    const databaseName = `deepstudy-scoped-integration-${crypto.randomUUID()}`
    databaseNames.push(databaseName)
    const database = createSyncDatabase(databaseName)
    let deviceSequence = 0
    const repository = createSyncRepository(database, {
      createDeviceId: () => `device-scope-${++deviceSequence}`,
      createMutationId: () => 'old-scope-mutation',
    })
    const oldScope = createAccountSyncScope('https://old.example.test', 'old-user')
    const newScope = createAccountSyncScope('https://new.example.test', 'new-user')
    repository.setActiveScope(oldScope)
    await repository.enqueueUpsert('long_task', 'private-old-task', { title: '不得外发' })
    await repository.setCursor('88')

    repository.setActiveScope(newScope)
    const requests: Array<{ url: string; method: string; body: string }> = []
    const client = createGatewayClient({
      getBaseUrl: () => 'https://new.example.test',
      tokenStorage: {
        read: async (scope) => scope === 'https://new.example.test' ? 'new-scope-token' : null,
        save: async () => undefined,
        clear: async () => undefined,
      },
      fetchFn: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push({ url, method: String(init?.method), body: String(init?.body ?? '') })
        if (url.endsWith('/v1/devices')) return Response.json({ ok: true })
        if (url.includes('/v1/sync/pull')) return Response.json({ records: [], cursor: 0, hasMore: false })
        if (url.endsWith('/v1/sync/conflicts')) return Response.json({ conflicts: [] })
        throw new Error(`Unexpected request: ${url}`)
      }),
    })
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      delay: async () => undefined,
    })

    await service.syncNow()

    expect(requests.some((request) => request.url.endsWith('/v1/sync/push'))).toBe(false)
    expect(requests.find((request) => request.url.includes('/v1/sync/pull'))?.url).toContain('cursor=0')
    expect(requests.some((request) => request.body.includes('private-old-task'))).toBe(false)
    repository.setActiveScope(oldScope)
    expect(await repository.getCursor()).toBe('88')
    expect(await repository.listPendingMutations()).toHaveLength(1)
    database.close()
  })
})
