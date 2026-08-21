import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSyncDatabase,
  createSyncRepository,
  createAccountSyncScope,
  LOCAL_QUARANTINE_SCOPE,
  supportedEntityTypes,
  type SyncRecordEnvelope,
} from './syncRepository'

const databaseNames: string[] = []

function testDatabaseName() {
  const name = `deepstudy-sync-test-${crypto.randomUUID()}`
  databaseNames.push(name)
  return name
}

function deterministicRepository(database: ReturnType<typeof createSyncDatabase>) {
  let mutationSequence = 0
  return createSyncRepository(database, {
    now: () => 1_000 + mutationSequence,
    createDeviceId: () => 'device-stable',
    createMutationId: () => `mutation-${++mutationSequence}`,
  })
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('offline-first sync repository', () => {
  it('isolates device, cursor, records, outbox and conflicts by gateway origin plus account identity', async () => {
    const database = createSyncDatabase(testDatabaseName())
    let deviceSequence = 0
    let mutationSequence = 0
    const repository = createSyncRepository(database, {
      createDeviceId: () => `device-${++deviceSequence}`,
      createMutationId: () => `mutation-scope-${++mutationSequence}`,
    })
    const scopeA = createAccountSyncScope('https://gateway-a.example/path', 'user-a')
    const scopeB = createAccountSyncScope('https://gateway-b.example', 'user-b')

    expect(repository.getActiveScope()).toBe(LOCAL_QUARANTINE_SCOPE)
    repository.setActiveScope(scopeA)
    const deviceA = await repository.getOrCreateDeviceId()
    await repository.enqueueUpsert('long_task', 'same-id', { title: '账号 A', notes: 'A 的备注' })
    await repository.setCursor('41')
    const mutationA = (await repository.listPendingMutations())[0]
    await repository.recordConflict(mutationA, { id: 'conflict-a', remote: null })

    repository.setActiveScope(scopeB)
    expect(await repository.getCursor()).toBeNull()
    expect(await repository.listRecords('long_task')).toEqual([])
    expect(await repository.listPendingMutations()).toEqual([])
    expect(await repository.listConflicts()).toEqual([])
    const deviceB = await repository.getOrCreateDeviceId()
    await repository.enqueueUpsert('long_task', 'same-id', { title: '账号 B' })

    expect(deviceB).not.toBe(deviceA)
    expect((await repository.getRecord('long_task', 'same-id'))?.payload.title).toBe('账号 B')

    repository.setActiveScope(scopeA)
    expect(await repository.getCursor()).toBe('41')
    expect(await repository.getOrCreateDeviceId()).toBe(deviceA)
    expect((await repository.getRecord('long_task', 'same-id'))?.payload).toMatchObject({
      title: '账号 A', notes: 'A 的备注',
    })
    expect(await repository.listConflicts()).toHaveLength(1)
    expect(await database.outbox.where('scopeKey').equals(scopeA).count()).toBe(1)
    database.close()
  })

  it('upgrades a real v1 database to v3 quarantine without losing records, outbox or legacy payload fields', async () => {
    const databaseName = testDatabaseName()
    const legacy = new Dexie(databaseName)
    legacy.version(1).stores({
      syncRecords: 'key, entityType, entityId, [entityType+entityId], deleted, revision, serverUpdatedAt',
      outbox: 'mutationId, recordKey, entityType, entityId, operation, createdAt, state',
      metadata: 'key',
    })
    await legacy.open()
    const record = {
      key: 'long_task:legacy-preserved',
      entityType: 'long_task',
      entityId: 'legacy-preserved',
      payload: {
        title: '旧长期任务',
        notes: '第一行\n第二行',
        plannedAt: '2026-08-01T08:30:00.000Z',
        unknownLegacyField: { nested: ['必须保留', 7] },
      },
      deleted: false,
      revision: 4,
      clientUpdatedAt: 900,
      serverUpdatedAt: 950,
      deviceId: 'legacy-device',
    }
    await legacy.table('syncRecords').put(record)
    await legacy.table('outbox').put({
      mutationId: 'legacy-mutation-0001',
      recordKey: record.key,
      entityType: record.entityType,
      entityId: record.entityId,
      operation: 'upsert',
      baseRevision: 4,
      record,
      createdAt: 1_000,
      state: 'pending',
    })
    await legacy.table('metadata').put({ key: 'cursor', value: '41' })
    legacy.close()

    const upgraded = createSyncDatabase(databaseName)
    const repository = createSyncRepository(upgraded)
    await upgraded.open()

    await expect(repository.getRecord('long_task', 'legacy-preserved')).resolves.toMatchObject(record)
    await expect(repository.listPendingMutations()).resolves.toMatchObject([{
      mutationId: 'legacy-mutation-0001',
      record: { payload: record.payload },
    }])
    await expect(repository.getCursor()).resolves.toBe('41')
    await expect(upgraded.syncRecords.get(record.key)).resolves.toMatchObject({
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      payload: record.payload,
    })
    await expect(upgraded.outbox.get('legacy-mutation-0001')).resolves.toMatchObject({
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      record: { payload: record.payload },
    })
    expect(upgraded.tables.map((table) => table.name)).toContain('syncConflicts')
    upgraded.close()
  })

  it('upgrades a real v2 open conflict to v3 quarantine without losing either version or metadata', async () => {
    const databaseName = testDatabaseName()
    const legacy = new Dexie(databaseName)
    legacy.version(2).stores({
      syncRecords: 'key, entityType, entityId, [entityType+entityId], deleted, revision, serverUpdatedAt',
      outbox: 'mutationId, recordKey, entityType, entityId, operation, createdAt, state',
      metadata: 'key',
      syncConflicts: 'id, mutationId, recordKey, entityType, entityId, status, createdAt',
    })
    await legacy.open()
    const local = {
      key: 'long_task:v2-conflicted', entityType: 'long_task', entityId: 'v2-conflicted',
      payload: {
        title: 'v2 本机长期任务', notes: '换行一\n换行二',
        unknownLocal: { nested: ['保留', 17] },
      },
      deleted: false, revision: 4, clientUpdatedAt: 1_000,
      serverUpdatedAt: 1_100, deviceId: 'v2-phone',
    }
    const remote = {
      ...local,
      payload: { title: 'v2 云端任务', unknownRemote: { flag: true } },
      revision: 5,
      serverUpdatedAt: 1_200,
      deviceId: 'v2-desktop',
    }
    await legacy.table('syncRecords').put(local)
    await legacy.table('outbox').put({
      mutationId: 'v2-conflict-mutation', recordKey: local.key,
      entityType: local.entityType, entityId: local.entityId,
      operation: 'upsert', baseRevision: 4, record: local,
      createdAt: 1_150, state: 'conflict', unknownOutbox: { keep: 'yes' },
    })
    await legacy.table('metadata').bulkPut([
      { key: 'cursor', value: 'v2-cursor-77' },
      { key: 'deviceId', value: 'v2-device-stable', unknownMetadata: 'preserve-me' },
    ])
    await legacy.table('syncConflicts').put({
      id: 'v2-open-conflict', mutationId: 'v2-conflict-mutation', recordKey: local.key,
      entityType: local.entityType, entityId: local.entityId,
      local, remote, status: 'open', createdAt: 1_200,
      unknownConflict: { source: 'v2', keep: true },
    })
    legacy.close()

    const upgraded = createSyncDatabase(databaseName)
    const repository = createSyncRepository(upgraded)
    await upgraded.open()

    await expect(repository.getRecord('long_task', 'v2-conflicted')).resolves.toMatchObject({
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      payload: local.payload,
    })
    await expect(upgraded.outbox.get('v2-conflict-mutation')).resolves.toMatchObject({
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      state: 'conflict',
      unknownOutbox: { keep: 'yes' },
      record: { payload: local.payload },
    })
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      id: 'v2-open-conflict',
      gatewayConflictId: 'v2-open-conflict',
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      status: 'open',
      local: { payload: local.payload },
      remote: { payload: remote.payload, revision: 5 },
      unknownConflict: { source: 'v2', keep: true },
    }])
    await expect(repository.getCursor()).resolves.toBe('v2-cursor-77')
    await expect(repository.getOrCreateDeviceId()).resolves.toBe('v2-device-stable')
    await expect(upgraded.metadata.get('deviceId')).resolves.toMatchObject({
      scopeKey: LOCAL_QUARANTINE_SCOPE,
      logicalKey: 'deviceId',
      unknownMetadata: 'preserve-me',
    })
    expect(await repository.conflictCount()).toBe(1)
    upgraded.close()
  })

  it('stores all nine sync entity types and enqueues durable mutations', async () => {
    const database = createSyncDatabase(testDatabaseName())
    const repository = deterministicRepository(database)

    for (const entityType of supportedEntityTypes) {
      await repository.enqueueUpsert(entityType, `${entityType}-1`, { marker: entityType })
    }

    const pending = await repository.listPendingMutations()
    expect(supportedEntityTypes).toEqual([
      'daily_task',
      'long_task',
      'long_task_image_chunk',
      'focus_session',
      'mode_event',
      'time_audit',
      'distraction',
      'reflection',
      'soul_quote',
    ])
    expect(pending).toHaveLength(9)
    expect(pending.every((mutation) => mutation.state === 'pending')).toBe(true)
    expect(pending.every((mutation) => mutation.baseRevision === 0)).toBe(true)

    for (const entityType of supportedEntityTypes) {
      await expect(repository.getRecord(entityType, `${entityType}-1`)).resolves.toMatchObject({
        entityType,
        entityId: `${entityType}-1`,
        deleted: false,
        revision: 0,
        deviceId: 'device-stable',
      })
    }
    database.close()
  })

  it('persists a tombstone, its base revision, cursor and device identity across reopen', async () => {
    const databaseName = testDatabaseName()
    const firstDatabase = createSyncDatabase(databaseName)
    const firstRepository = deterministicRepository(firstDatabase)
    const remoteRecord: SyncRecordEnvelope = {
      key: 'long_task:legacy-1',
      entityType: 'long_task',
      entityId: 'legacy-1',
      payload: { title: '旧任务', unknownLegacyFlag: true },
      deleted: false,
      revision: 4,
      clientUpdatedAt: 900,
      serverUpdatedAt: 950,
      deviceId: 'desktop-device',
    }
    await firstRepository.applyRemoteRecord(remoteRecord, 'cursor-41')
    await firstRepository.enqueueDelete('long_task', 'legacy-1')
    const firstDeviceId = await firstRepository.getOrCreateDeviceId()
    firstDatabase.close()

    const reopenedDatabase = createSyncDatabase(databaseName)
    const reopenedRepository = deterministicRepository(reopenedDatabase)

    await expect(reopenedRepository.getRecord('long_task', 'legacy-1')).resolves.toMatchObject({
      deleted: true,
      revision: 4,
      payload: { title: '旧任务', unknownLegacyFlag: true },
    })
    await expect(reopenedRepository.listPendingMutations()).resolves.toMatchObject([
      {
        operation: 'delete',
        baseRevision: 4,
        recordKey: 'long_task:legacy-1',
      },
    ])
    await expect(reopenedRepository.getCursor()).resolves.toBe('cursor-41')
    await expect(reopenedRepository.getOrCreateDeviceId()).resolves.toBe(firstDeviceId)
    reopenedDatabase.close()
  })

  it('acknowledges a pending mutation and advances the durable pull cursor', async () => {
    const database = createSyncDatabase(testDatabaseName())
    const repository = deterministicRepository(database)
    const mutation = await repository.enqueueUpsert('reflection', '2026-07-22', {
      content: '今天的反思',
    })

    await repository.acknowledgeMutation(mutation.mutationId, {
      revision: 8,
      serverUpdatedAt: 2_000,
      cursor: 'cursor-88',
    })

    await expect(repository.listPendingMutations()).resolves.toEqual([])
    await expect(repository.getRecord('reflection', '2026-07-22')).resolves.toMatchObject({
      revision: 8,
      serverUpdatedAt: 2_000,
    })
    await expect(repository.getCursor()).resolves.toBe('cursor-88')
    database.close()
  })

  it('turns a pulled remote update into a conflict instead of overwriting a pending local edit', async () => {
    const database = createSyncDatabase(testDatabaseName())
    const repository = deterministicRepository(database)
    await repository.applyRemoteRecord({
      key: 'long_task:race-task',
      entityType: 'long_task',
      entityId: 'race-task',
      payload: { title: '旧云端' },
      deleted: false,
      revision: 2,
      clientUpdatedAt: 1_000,
      serverUpdatedAt: 1_000,
      deviceId: 'desktop',
    })
    await repository.enqueueUpsert('long_task', 'race-task', { title: '本机刚编辑' })

    await repository.applyRemoteRecord({
      key: 'long_task:race-task',
      entityType: 'long_task',
      entityId: 'race-task',
      payload: { title: '另一端新版本' },
      deleted: false,
      revision: 3,
      clientUpdatedAt: 1_500,
      serverUpdatedAt: 1_500,
      deviceId: 'other-device',
    }, 'cursor-after-race')

    await expect(repository.getRecord('long_task', 'race-task')).resolves.toMatchObject({
      payload: { title: '本机刚编辑' },
      revision: 2,
    })
    await expect(repository.listPendingMutations()).resolves.toEqual([])
    const raceMutation = (await database.outbox.toArray())
      .find((mutation) => mutation.recordKey === 'long_task:race-task')
    expect(raceMutation).toMatchObject({
      state: 'conflict',
      record: { payload: { title: '本机刚编辑' } },
    })
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      local: { payload: { title: '本机刚编辑' } },
      remote: { payload: { title: '另一端新版本' }, revision: 3 },
    }])
    await expect(repository.getCursor()).resolves.toBe('cursor-after-race')
    database.close()
  })

  it('previews and imports local quarantine records into the signed-in account scope idempotently', async () => {
    const database = createSyncDatabase(testDatabaseName())
    let mutationSequence = 0
    const repository = createSyncRepository(database, {
      createDeviceId: () => 'import-device',
      createMutationId: () => `import-mutation-${++mutationSequence}`,
    })
    await repository.enqueueUpsert('long_task', 'local-only', { title: '旧本机长期任务', notes: '保留' })
    await repository.enqueueUpsert('reflection', 'same-content', { content: '重复反思' })
    const accountScope = createAccountSyncScope('https://sync.example.test', 'alice')
    repository.setActiveScope(accountScope)
    await repository.enqueueUpsert('reflection', 'same-content', { content: '重复反思' })

    const preview = await repository.previewLocalQuarantineImport()
    expect(preview.total).toBe(2)
    expect(preview.importable).toMatchObject([{ entityType: 'long_task', entityId: 'local-only' }])
    expect(preview.duplicates).toMatchObject([{ entityType: 'reflection', entityId: 'same-content' }])
    expect(preview.conflicts).toEqual([])

    await expect(repository.importLocalQuarantineRecords()).resolves.toMatchObject({ imported: 1 })
    await expect(repository.getRecord('long_task', 'local-only')).resolves.toMatchObject({
      payload: { title: '旧本机长期任务', notes: '保留' },
    })
    await expect(repository.previewLocalQuarantineImport()).resolves.toMatchObject({
      importable: [],
      duplicates: [
        { entityType: 'long_task', entityId: 'local-only' },
        { entityType: 'reflection', entityId: 'same-content' },
      ],
    })
    await expect(repository.getMetadata('importStatus')).resolves.toBe('committed')
    database.close()
  })
})
