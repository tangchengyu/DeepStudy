import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createLongTaskDatabase, createLongTaskRepository } from './longTaskRepository'
import { createSyncRepository } from './syncRepository'

const databaseNames: string[] = []

function createTestRepository() {
  const databaseName = `deepstudy-test-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  const database = createLongTaskDatabase(databaseName)
  return { database, repository: createLongTaskRepository(database) }
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('long task repository', () => {
  it('creates a desktop-compatible payload and lists it in its quadrant', async () => {
    const databaseName = `deepstudy-test-${crypto.randomUUID()}`
    databaseNames.push(databaseName)
    const database = createLongTaskDatabase(databaseName)
    const repository = createLongTaskRepository(database, {
      now: () => 1_726_800_000_000,
      createEntityId: () => 'long-created-1',
    })

    await expect(repository.create({
      title: '准备答辩',
      notes: '第一行\n第二行',
      quadrantId: 'important-urgent',
      plannedAt: '2026-08-01T08:30:00.000Z',
    })).resolves.toMatchObject({ entityId: 'long-created-1', id: 'long-created-1' })

    await expect(repository.listByQuadrant('important-urgent')).resolves.toMatchObject([{
      entityId: 'long-created-1',
      title: '准备答辩',
      notes: '第一行\n第二行',
      quadrantId: 'important-urgent',
      plannedAt: '2026-08-01T08:30:00.000Z',
    }])
    await expect(database.syncRecords.get('long_task:long-created-1')).resolves.toMatchObject({
      payload: {
        id: 'long-created-1',
        title: '准备答辩',
        notes: '第一行\n第二行',
        quadrant: 'important-urgent',
        status: 'active',
        order: 1_726_800_000_000,
        createdAt: 1_726_800_000_000,
        updatedAt: 1_726_800_000_000,
        completedAt: null,
        plannedAt: '2026-08-01T08:30:00.000Z',
      },
    })
    database.close()
  })

  it('routes edits by envelope entityId while preserving a different legacy payload id and unknown fields', async () => {
    const { database, repository } = createTestRepository()
    const sync = createSyncRepository(database)
    await sync.applyRemoteRecord({
      key: 'long_task:envelope-long-id',
      entityType: 'long_task',
      entityId: 'envelope-long-id',
      payload: {
        id: 'legacy-payload-id',
        title: '旧标题',
        notes: '第一行\n第二行',
        quadrant: 'important-urgent',
        status: 'active',
        order: 3,
        createdAt: 1,
        updatedAt: 2,
        plannedAt: '2026-08-01T08:30:00.000Z',
        unknownDesktopField: { nested: ['保留'] },
      },
      deleted: false,
      revision: 4,
      clientUpdatedAt: 2,
      serverUpdatedAt: 2,
      deviceId: 'desktop-device',
    })

    await expect(repository.get('envelope-long-id')).resolves.toMatchObject({
      entityId: 'envelope-long-id',
      id: 'legacy-payload-id',
    })
    await repository.update('envelope-long-id', {
      title: '新标题',
      notes: '新第一行\n新第二行',
      plannedAt: null,
    })

    await expect(sync.getRecord('long_task', 'envelope-long-id')).resolves.toMatchObject({
      entityId: 'envelope-long-id',
      payload: {
        id: 'legacy-payload-id',
        title: '新标题',
        notes: '新第一行\n新第二行',
        plannedAt: null,
        unknownDesktopField: { nested: ['保留'] },
      },
    })
    await expect(sync.getRecord('long_task', 'legacy-payload-id')).resolves.toBeUndefined()
    database.close()
  })

  it('moves, completes, reopens, and tombstones by envelope identity while retaining the original payload', async () => {
    const databaseName = `deepstudy-test-${crypto.randomUUID()}`
    databaseNames.push(databaseName)
    const database = createLongTaskDatabase(databaseName)
    const repository = createLongTaskRepository(database, { now: () => 55_000 })
    const sync = createSyncRepository(database)
    await sync.applyRemoteRecord({
      key: 'long_task:routing-id', entityType: 'long_task', entityId: 'routing-id',
      payload: {
        id: 'legacy-id', title: '保留我', notes: '一\n二', quadrant: 'important-urgent',
        status: 'active', order: 1, createdAt: 1, updatedAt: 1,
        plannedAt: 88_000, unknown: { keep: true },
      },
      deleted: false, revision: 3, clientUpdatedAt: 1, serverUpdatedAt: 1,
      deviceId: 'desktop-device',
    })

    await expect(repository.moveToQuadrant('routing-id', 'urgent-not-important')).resolves.toBe(true)
    await expect(repository.get('routing-id')).resolves.toMatchObject({
      entityId: 'routing-id', id: 'legacy-id', quadrantId: 'urgent-not-important',
    })
    await expect(repository.complete('routing-id')).resolves.toBe(true)
    await expect(repository.get('routing-id')).resolves.toMatchObject({
      status: 'completed', completedAt: 55_000,
    })
    await expect(repository.reopen('routing-id')).resolves.toBe(true)
    await expect(repository.get('routing-id')).resolves.toMatchObject({
      status: 'active', completedAt: null,
    })
    await expect(repository.remove('routing-id')).resolves.toBe(true)

    await expect(repository.get('routing-id')).resolves.toBeUndefined()
    await expect(sync.getRecord('long_task', 'routing-id')).resolves.toMatchObject({
      deleted: true,
      payload: {
        id: 'legacy-id', notes: '一\n二', plannedAt: 88_000, unknown: { keep: true },
      },
    })
    expect(await database.outbox.count()).toBe(5)
    database.close()
  })

  it('stores and lists tasks for one quadrant in stable order', async () => {
    const { database, repository } = createTestRepository()
    await repository.save({
      id: 'later',
      title: '第二件事',
      notes: '',
      quadrantId: 'important-urgent',
      status: 'active',
      order: 20,
      createdAt: 2,
      updatedAt: 2,
    })
    await repository.save({
      id: 'first',
      title: '第一件事',
      notes: '',
      quadrantId: 'important-urgent',
      status: 'active',
      order: 10,
      createdAt: 1,
      updatedAt: 1,
    })
    await repository.save({
      id: 'other',
      title: '其他象限',
      notes: '',
      quadrantId: 'important-not-urgent',
      status: 'active',
      order: 1,
      createdAt: 3,
      updatedAt: 3,
    })

    await expect(repository.listByQuadrant('important-urgent')).resolves.toMatchObject([
      { id: 'first' },
      { id: 'later' },
    ])
    database.close()
  })

  it('round-trips multiline notes and markup-looking text without normalization', async () => {
    const { database, repository } = createTestRepository()
    const notes = '第一行\n<script>alert("never")</script>\n第三行'
    await repository.save({
      id: 'notes-task',
      title: '需要保留的备注',
      notes,
      quadrantId: 'not-important-not-urgent',
      status: 'active',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
      plannedAt: '2026-08-01T08:30:00.000Z',
      legacyReminderMode: 'weekly',
      nestedLegacy: { source: 'desktop', untouched: true },
    })

    await expect(repository.get('notes-task')).resolves.toMatchObject({
      notes,
      plannedAt: '2026-08-01T08:30:00.000Z',
      legacyReminderMode: 'weekly',
      nestedLegacy: { source: 'desktop', untouched: true },
    })
    database.close()
  })

  it('completes a task locally and records the change in the durable outbox', async () => {
    const { database, repository } = createTestRepository()
    await repository.save({
      id: 'complete-me',
      title: '完成我',
      notes: '',
      quadrantId: 'urgent-not-important',
      status: 'active',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(repository.complete('complete-me')).resolves.toBe(true)
    await expect(repository.listByQuadrant('urgent-not-important')).resolves.toEqual([])
    await expect(repository.get('complete-me')).resolves.toMatchObject({ status: 'completed' })
    const mutations = await database.outbox.toArray()
    expect(mutations).toHaveLength(3)
    expect(mutations.find((mutation) => mutation.record.payload.status === 'completed')).toMatchObject({
      operation: 'upsert',
      entityType: 'long_task',
      entityId: 'complete-me',
      record: { payload: { status: 'completed' } },
    })
    expect(mutations.find((mutation) => mutation.entityType === 'reflection')).toMatchObject({
      operation: 'upsert',
      record: { payload: { kind: 'completed-task-summary', content: '已完成：完成我' } },
    })
    database.close()
  })

  it('lists completed tasks separately so they can be reopened from their quadrant', async () => {
    const { database, repository } = createTestRepository()
    await repository.save({
      id: 'completed-task',
      title: '已完成任务',
      notes: '保留备注',
      quadrantId: 'important-not-urgent',
      status: 'completed',
      order: 1,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
      plannedAt: '2026-08-01T08:30:00.000Z',
    })

    await expect(repository.listByQuadrant('important-not-urgent')).resolves.toEqual([])
    await expect(repository.listCompletedByQuadrant('important-not-urgent')).resolves.toMatchObject([{
      entityId: 'completed-task',
      id: 'completed-task',
      notes: '保留备注',
      status: 'completed',
      plannedAt: '2026-08-01T08:30:00.000Z',
    }])
    database.close()
  })
})
