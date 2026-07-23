import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncDatabase, createSyncRepository } from '../data/syncRepository'
import { createSyncService } from './syncService'
import { GatewayError } from './gatewayClient'

const databases: string[] = []

function databaseForTest() {
  const name = `deepstudy-service-${crypto.randomUUID()}`
  databases.push(name)
  return createSyncDatabase(name)
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => Dexie.delete(name)))
})

describe('connectivity-aware sync service', () => {
  it('does not lose a durable outbox item while offline', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-device-offline',
      createMutationId: () => 'mutation-offline-0001',
    })
    await repository.enqueueUpsert('long_task', 'task-1', { title: '离线任务' })
    const client = {
      registerDevice: vi.fn(),
      push: vi.fn(),
      pull: vi.fn(),
      conflicts: vi.fn(),
      resolveConflict: vi.fn(),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => false, subscribe: () => () => undefined },
      delay: async () => undefined,
    })

    await expect(service.syncNow()).resolves.toMatchObject({ status: 'offline' })
    await expect(repository.listPendingMutations()).resolves.toHaveLength(1)
    expect(client.push).not.toHaveBeenCalled()
    database.close()
  })

  it('pushes, acknowledges, pulls and records a conflict without retrying it forever', async () => {
    const database = databaseForTest()
    let sequence = 0
    const repository = createSyncRepository(database, {
      now: () => 1_000 + sequence,
      createDeviceId: () => 'android-device-sync',
      createMutationId: () => `mutation-sync-${++sequence}`,
    })
    await repository.enqueueUpsert('long_task', 'local-applied', { title: '上传成功' })
    await repository.enqueueUpsert('long_task', 'local-conflict', { title: '保留我的版本' })
    const client = {
      registerDevice: vi.fn(async () => ({ ok: true as const })),
      push: vi
        .fn()
        .mockResolvedValueOnce({ results: [{
          mutationId: 'mutation-sync-1', status: 'applied', revision: 1, serverUpdatedAt: 2_000,
        }] })
        .mockResolvedValueOnce({ results: [{
          mutationId: 'mutation-sync-2',
          status: 'conflict',
          conflictId: 'conflict-1',
          remote: {
            entityType: 'long_task', entityId: 'local-conflict', payload: { title: '云端版本' },
            deleted: false, revision: 3, clientUpdatedAt: 1_500, serverUpdatedAt: 1_800,
            deviceId: 'desktop-device-1',
          },
        }] }),
      pull: vi.fn(async () => ({
        records: [{
          entityType: 'reflection' as const, entityId: '2026-07-23', payload: { content: '云端反思' },
          deleted: false, revision: 2, clientUpdatedAt: 1_700, serverUpdatedAt: 1_900,
          deviceId: 'desktop-device-1',
        }],
        cursor: 8,
        hasMore: false,
      })),
      conflicts: vi.fn(async () => ({ conflicts: [] })),
      resolveConflict: vi.fn(),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      delay: async () => undefined,
      now: () => 3_000,
      platform: () => 'android',
    })

    await expect(service.syncNow()).resolves.toMatchObject({ status: 'synced', conflicts: 1 })
    expect(client.registerDevice).toHaveBeenCalledWith('android-device-sync', expect.any(String), 'android')
    expect(client.push).toHaveBeenCalledTimes(2)
    await expect(repository.listPendingMutations()).resolves.toEqual([])
    await expect(repository.getRecord('long_task', 'local-applied')).resolves.toMatchObject({ revision: 1 })
    await expect(database.outbox.get('mutation-sync-2')).resolves.toMatchObject({
      state: 'conflict',
      record: { payload: { title: '保留我的版本' } },
    })
    await expect(repository.getRecord('long_task', 'local-conflict')).resolves.toMatchObject({
      revision: 0,
      payload: { title: '保留我的版本' },
    })
    await expect(repository.getRecord('reflection', '2026-07-23')).resolves.toMatchObject({
      revision: 2,
      payload: { content: '云端反思' },
    })
    await expect(repository.getCursor()).resolves.toBe('8')
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      id: 'conflict-1',
      status: 'open',
      local: { payload: { title: '保留我的版本' } },
      remote: { payload: { title: '云端版本' } },
    }])
    database.close()
  })

  it('retries a transient request and keeps outbox data until acknowledgement', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-device-retry',
      createMutationId: () => 'mutation-retry-0001',
    })
    await repository.enqueueUpsert('daily_task', 'daily-1', { title: '重试任务' })
    const client = {
      registerDevice: vi.fn(async () => ({ ok: true as const })),
      push: vi.fn()
        .mockRejectedValueOnce(new TypeError('network down'))
        .mockResolvedValueOnce({ results: [{
          mutationId: 'mutation-retry-0001', status: 'applied', revision: 1, serverUpdatedAt: 4_000,
        }] }),
      pull: vi.fn(async () => ({ records: [], cursor: 0, hasMore: false })),
      conflicts: vi.fn(async () => ({ conflicts: [] })),
      resolveConflict: vi.fn(),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      delay: async () => {
        await expect(repository.listPendingMutations()).resolves.toHaveLength(1)
      },
    })

    await service.syncNow()

    expect(client.push).toHaveBeenCalledTimes(2)
    await expect(repository.listPendingMutations()).resolves.toEqual([])
    database.close()
  })

  it('resolves keep-local with a new mutation and converges without discarding the local copy', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-device-resolve',
      createMutationId: () => 'original-mutation-0001',
    })
    await repository.applyRemoteRecord({
      key: 'long_task:conflicted-task',
      entityType: 'long_task',
      entityId: 'conflicted-task',
      payload: { title: '旧云端版本' },
      deleted: false,
      revision: 3,
      clientUpdatedAt: 1_000,
      serverUpdatedAt: 1_100,
      deviceId: 'desktop-device',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'conflicted-task', {
      title: '我要保留的本地版本', notes: '第一行\n第二行',
    })
    const remote = {
      entityType: 'long_task' as const,
      entityId: 'conflicted-task',
      payload: { title: '更新后的云端版本' },
      deleted: false,
      revision: 4,
      clientUpdatedAt: 1_200,
      serverUpdatedAt: 1_300,
      deviceId: 'desktop-device',
    }
    await repository.recordConflict(mutation, {
      id: 'conflict-keep-local',
      remote: { ...remote, key: 'long_task:conflicted-task' },
    })
    const client = {
      registerDevice: vi.fn(), push: vi.fn(), pull: vi.fn(), conflicts: vi.fn(),
      resolveConflict: vi.fn(async () => ({
        ok: true as const,
        conflictId: 'conflict-keep-local',
        resolution: 'keep_local' as const,
        result: {
          mutationId: 'resolution-mutation-0001', status: 'applied' as const,
          revision: 5, serverUpdatedAt: 2_000,
        },
      })),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      createMutationId: () => 'resolution-mutation-0001',
      delay: async () => undefined,
    })

    await service.resolveConflict('conflict-keep-local', 'keep_local')

    expect(client.resolveConflict).toHaveBeenCalledWith(
      'android-device-resolve',
      'conflict-keep-local',
      {
        resolution: 'keep_local',
        operationId: 'resolution-mutation-0001',
        mutationId: 'resolution-mutation-0001',
        expectedRemoteRevision: 4,
      },
    )
    await expect(repository.getRecord('long_task', 'conflicted-task')).resolves.toMatchObject({
      payload: { title: '我要保留的本地版本', notes: '第一行\n第二行' },
      revision: 5,
    })
    await expect(database.outbox.get('original-mutation-0001')).resolves.toBeUndefined()
    await expect(repository.conflictCount()).resolves.toBe(0)
    database.close()
  })

  it('keeps every conflicted outbox item while offline and removes it only after keep-remote succeeds', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-device-remote',
      createMutationId: () => 'remote-choice-mutation',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'remote-choice', { title: '本地' })
    const remote = {
      key: 'long_task:remote-choice',
      entityType: 'long_task' as const,
      entityId: 'remote-choice',
      payload: { title: '云端' },
      deleted: false,
      revision: 2,
      clientUpdatedAt: 1_200,
      serverUpdatedAt: 1_300,
      deviceId: 'desktop-device',
    }
    await repository.recordConflict(mutation, { id: 'conflict-keep-remote', remote })
    let online = false
    const client = {
      registerDevice: vi.fn(), push: vi.fn(), pull: vi.fn(), conflicts: vi.fn(),
      resolveConflict: vi.fn(async () => ({
        ok: true as const,
        conflictId: 'conflict-keep-remote',
        resolution: 'keep_remote' as const,
      })),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => online, subscribe: () => () => undefined },
      delay: async () => undefined,
    })

    await expect(service.resolveConflict('conflict-keep-remote', 'keep_remote')).rejects.toThrow('OFFLINE')
    await expect(database.outbox.get('remote-choice-mutation')).resolves.toMatchObject({ state: 'conflict' })
    await expect(repository.getRecord('long_task', 'remote-choice')).resolves.toMatchObject({ payload: { title: '本地' } })

    online = true
    await service.resolveConflict('conflict-keep-remote', 'keep_remote')
    await expect(database.outbox.get('remote-choice-mutation')).resolves.toBeUndefined()
    await expect(repository.getRecord('long_task', 'remote-choice')).resolves.toMatchObject({
      payload: { title: '云端' }, revision: 2,
    })
    database.close()
  })

  it('recovers a keep-local resolution after the server committed but the acknowledgement was lost', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-lost-ack',
      createMutationId: () => 'original-lost-ack',
    })
    await repository.applyRemoteRecord({
      key: 'long_task:lost-ack', entityType: 'long_task', entityId: 'lost-ack',
      payload: { title: '旧云端' }, deleted: false, revision: 4,
      clientUpdatedAt: 1_000, serverUpdatedAt: 1_000, deviceId: 'desktop',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'lost-ack', {
      title: '保留本机', notes: '不能丢失',
    })
    await repository.recordConflict(mutation, {
      id: 'conflict-lost-ack',
      remote: {
        key: 'long_task:lost-ack', entityType: 'long_task', entityId: 'lost-ack',
        payload: { title: '新云端' }, deleted: false, revision: 5,
        clientUpdatedAt: 1_100, serverUpdatedAt: 1_100, deviceId: 'desktop',
      },
    })
    const operationIds: string[] = []
    let generatedOperationCount = 0
    let phase: 'network-failure' | 'already-resolved' = 'network-failure'
    const client = {
      registerDevice: vi.fn(), push: vi.fn(),
      resolveConflict: vi.fn(async (_device: string, _id: string, body: { operationId?: string }) => {
        operationIds.push(String(body.operationId))
        if (phase === 'network-failure') throw new TypeError('lost response')
        throw new GatewayError(409, 'CONFLICT_ALREADY_RESOLVED', {})
      }),
      conflicts: vi.fn(async () => ({ conflicts: [] })),
      pull: vi.fn(async () => ({
        records: [{
          entityType: 'long_task' as const, entityId: 'lost-ack',
          payload: { title: '保留本机', notes: '不能丢失' }, deleted: false, revision: 6,
          clientUpdatedAt: 1_200, serverUpdatedAt: 2_000, deviceId: 'android-lost-ack',
        }],
        cursor: 91,
        hasMore: false,
      })),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      createMutationId: () => `stable-resolution-operation-${++generatedOperationCount}`,
      delay: async () => undefined,
    })

    await expect(service.resolveConflict('conflict-lost-ack', 'keep_local')).rejects.toThrow('lost response')
    const pendingResolution = await repository.getConflict('conflict-lost-ack')
    expect(pendingResolution).toMatchObject({
      status: 'resolving',
      resolution: 'keep_local',
      resolutionOperationId: 'stable-resolution-operation-1',
    })
    expect(await database.outbox.get('original-lost-ack')).toBeDefined()

    phase = 'already-resolved'
    await service.resolveConflict('conflict-lost-ack', 'keep_local')

    expect(generatedOperationCount).toBe(1)
    expect(new Set(operationIds)).toEqual(new Set(['stable-resolution-operation-1']))
    expect(await repository.conflictCount()).toBe(0)
    expect(await database.outbox.get('original-lost-ack')).toBeUndefined()
    await expect(repository.getRecord('long_task', 'lost-ack')).resolves.toMatchObject({
      payload: { title: '保留本机', notes: '不能丢失' }, revision: 6,
    })
    expect(await repository.getCursor()).toBe('91')
    database.close()
  })

  it('retries a lost acknowledgement with one persisted operation id and accepts the idempotent receipt', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-idempotent-receipt',
      createMutationId: () => 'original-idempotent-mutation',
    })
    await repository.applyRemoteRecord({
      key: 'long_task:idempotent-task', entityType: 'long_task', entityId: 'idempotent-task',
      payload: { title: '旧云端' }, deleted: false, revision: 7,
      clientUpdatedAt: 1_000, serverUpdatedAt: 1_000, deviceId: 'desktop',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'idempotent-task', {
      title: '最终本机版本', notes: '响应丢失也不能重复生成操作',
    })
    await repository.recordConflict(mutation, {
      id: 'conflict-idempotent-receipt',
      remote: {
        key: 'long_task:idempotent-task', entityType: 'long_task', entityId: 'idempotent-task',
        payload: { title: '冲突云端' }, deleted: false, revision: 8,
        clientUpdatedAt: 1_100, serverUpdatedAt: 1_100, deviceId: 'desktop',
      },
    })
    let generatorCalls = 0
    let responseAvailable = false
    const sentOperationIds: string[] = []
    const client = {
      registerDevice: vi.fn(), push: vi.fn(), pull: vi.fn(), conflicts: vi.fn(),
      resolveConflict: vi.fn(async (
        _device: string,
        _id: string,
        body: { operationId: string; mutationId?: string },
      ) => {
        sentOperationIds.push(body.operationId)
        expect(body.mutationId).toBe(body.operationId)
        if (!responseAvailable) throw new TypeError('server committed; response was lost')
        return {
          ok: true as const,
          conflictId: 'conflict-idempotent-receipt',
          resolution: 'keep_local' as const,
          idempotent: true,
          result: {
            mutationId: body.operationId,
            status: 'applied' as const,
            revision: 9,
            serverUpdatedAt: 2_500,
          },
        }
      }),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      createMutationId: () => `random-operation-${++generatorCalls}-${crypto.randomUUID()}`,
      delay: async () => undefined,
    })

    await expect(service.resolveConflict('conflict-idempotent-receipt', 'keep_local'))
      .rejects.toThrow('server committed; response was lost')
    const stored = await repository.getConflict('conflict-idempotent-receipt')
    expect(stored).toMatchObject({
      status: 'resolving',
      resolution: 'keep_local',
      resolutionExpectedRevision: 8,
      submittedLocal: { payload: { title: '最终本机版本', notes: '响应丢失也不能重复生成操作' } },
    })
    const persistedOperationId = stored?.resolutionOperationId

    responseAvailable = true
    await service.resolveConflict('conflict-idempotent-receipt', 'keep_local')

    expect(generatorCalls).toBe(1)
    expect(new Set(sentOperationIds)).toEqual(new Set([persistedOperationId]))
    expect(client.resolveConflict).toHaveBeenCalledTimes(4)
    expect(client.conflicts).not.toHaveBeenCalled()
    expect(client.pull).not.toHaveBeenCalled()
    await expect(repository.getRecord('long_task', 'idempotent-task')).resolves.toMatchObject({
      payload: { title: '最终本机版本', notes: '响应丢失也不能重复生成操作' },
      revision: 9,
    })
    expect(await repository.conflictCount()).toBe(0)
    expect(await database.outbox.get('original-idempotent-mutation')).toBeUndefined()
    database.close()
  })

  it('keeps local data and outbox when a pending keep-remote was actually resolved keep-local elsewhere', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-remote-opposite',
      createMutationId: () => 'original-remote-opposite',
    })
    await repository.applyRemoteRecord({
      key: 'long_task:remote-opposite', entityType: 'long_task', entityId: 'remote-opposite',
      payload: { title: '冲突前云端' }, deleted: false, revision: 1,
      clientUpdatedAt: 1_000, serverUpdatedAt: 1_000, deviceId: 'desktop',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'remote-opposite', {
      title: '本机不能丢', notes: '保留 outbox',
    })
    await repository.recordConflict(mutation, {
      id: 'conflict-remote-opposite',
      remote: {
        key: 'long_task:remote-opposite', entityType: 'long_task', entityId: 'remote-opposite',
        payload: { title: '原冲突云端' }, deleted: false, revision: 2,
        clientUpdatedAt: 1_100, serverUpdatedAt: 1_100, deviceId: 'desktop',
      },
    })
    let lost = true
    const client = {
      registerDevice: vi.fn(), push: vi.fn(),
      resolveConflict: vi.fn(async () => {
        if (lost) throw new TypeError('keep-remote acknowledgement lost')
        throw new GatewayError(409, 'CONFLICT_ALREADY_RESOLVED', {
          error: 'CONFLICT_ALREADY_RESOLVED', status: 'resolved_keep_local',
        })
      }),
      conflicts: vi.fn(async () => ({ conflicts: [] })),
      pull: vi.fn(async () => ({
        records: [{
          entityType: 'long_task' as const, entityId: 'remote-opposite',
          payload: { title: '另一设备保留的本机版本' }, deleted: false, revision: 3,
          clientUpdatedAt: 1_200, serverUpdatedAt: 2_000, deviceId: 'other-phone',
        }],
        cursor: 101,
        hasMore: false,
      })),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      createMutationId: () => 'remote-opposite-operation',
      delay: async () => undefined,
    })

    await expect(service.resolveConflict('conflict-remote-opposite', 'keep_remote'))
      .rejects.toThrow('keep-remote acknowledgement lost')
    lost = false
    await expect(service.resolveConflict('conflict-remote-opposite', 'keep_remote'))
      .rejects.toThrow('CONFLICT_RESOLVED_DIFFERENTLY')

    await expect(repository.getRecord('long_task', 'remote-opposite')).resolves.toMatchObject({
      payload: { title: '本机不能丢', notes: '保留 outbox' },
      revision: 1,
    })
    await expect(database.outbox.get('original-remote-opposite')).resolves.toMatchObject({
      state: 'conflict',
      record: { payload: { title: '本机不能丢', notes: '保留 outbox' } },
    })
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      status: 'open',
      reconciledGatewayStatus: 'resolved_keep_local',
      remote: { payload: { title: '另一设备保留的本机版本' }, revision: 3 },
    }])
    expect(await repository.getCursor()).toBe('101')

    const resolveCallsBeforeConfirmedChoice = client.resolveConflict.mock.calls.length
    await expect(service.resolveConflict('conflict-remote-opposite', 'keep_remote'))
      .resolves.toEqual({ ok: true, resolution: 'keep_remote' })
    expect(client.resolveConflict).toHaveBeenCalledTimes(resolveCallsBeforeConfirmedChoice)
    expect(await database.outbox.get('original-remote-opposite')).toBeUndefined()
    await expect(repository.getRecord('long_task', 'remote-opposite')).resolves.toMatchObject({
      payload: { title: '另一设备保留的本机版本' }, revision: 3,
    })
    database.close()
  })

  it('finalizes pending keep-remote on old 409 only when status and pulled remote both match', async () => {
    const database = databaseForTest()
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'android-remote-same',
      createMutationId: () => 'original-remote-same',
    })
    await repository.applyRemoteRecord({
      key: 'long_task:remote-same', entityType: 'long_task', entityId: 'remote-same',
      payload: { title: '冲突前云端' }, deleted: false, revision: 4,
      clientUpdatedAt: 1_000, serverUpdatedAt: 1_000, deviceId: 'desktop',
    })
    const mutation = await repository.enqueueUpsert('long_task', 'remote-same', {
      title: '准备放弃的本机版本',
    })
    const expectedRemote = {
      key: 'long_task:remote-same', entityType: 'long_task' as const, entityId: 'remote-same',
      payload: { title: '确认采用的云端版本', unknown: { preserved: true } },
      deleted: false, revision: 5, clientUpdatedAt: 1_100, serverUpdatedAt: 1_200,
      deviceId: 'desktop',
    }
    await repository.recordConflict(mutation, { id: 'conflict-remote-same', remote: expectedRemote })
    let lost = true
    const client = {
      registerDevice: vi.fn(), push: vi.fn(),
      resolveConflict: vi.fn(async () => {
        if (lost) throw new TypeError('keep-remote acknowledgement lost')
        throw new GatewayError(409, 'CONFLICT_ALREADY_RESOLVED', {
          error: 'CONFLICT_ALREADY_RESOLVED', status: 'resolved_keep_remote',
        })
      }),
      conflicts: vi.fn(async () => ({ conflicts: [] })),
      pull: vi.fn(async () => ({
        records: [{
          entityType: expectedRemote.entityType,
          entityId: expectedRemote.entityId,
          payload: expectedRemote.payload,
          deleted: expectedRemote.deleted,
          revision: expectedRemote.revision,
          clientUpdatedAt: expectedRemote.clientUpdatedAt,
          serverUpdatedAt: expectedRemote.serverUpdatedAt,
          deviceId: expectedRemote.deviceId,
        }],
        cursor: 102,
        hasMore: false,
      })),
    }
    const service = createSyncService({
      repository,
      client,
      connectivity: { isOnline: () => true, subscribe: () => () => undefined },
      createMutationId: () => 'remote-same-operation',
      delay: async () => undefined,
    })

    await expect(service.resolveConflict('conflict-remote-same', 'keep_remote'))
      .rejects.toThrow('keep-remote acknowledgement lost')
    lost = false
    await expect(service.resolveConflict('conflict-remote-same', 'keep_remote'))
      .resolves.toEqual({ ok: true, resolution: 'keep_remote' })

    expect(await database.outbox.get('original-remote-same')).toBeUndefined()
    expect(await repository.conflictCount()).toBe(0)
    await expect(repository.getRecord('long_task', 'remote-same')).resolves.toMatchObject({
      payload: expectedRemote.payload,
      revision: 5,
    })
    expect(await repository.getCursor()).toBe('102')
    database.close()
  })
})
