import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createDailyTaskRepository } from './dailyTaskRepository'
import { createSyncDatabase, createSyncRepository } from './syncRepository'

const databaseNames: string[] = []

function createTestRepository() {
  const databaseName = `deepstudy-daily-test-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  const database = createSyncDatabase(databaseName)
  let idSequence = 0
  let mutationSequence = 0
  const repository = createDailyTaskRepository(database, {
    now: () => new Date(2026, 6, 23, 10, 30).getTime(),
    createEntityId: () => `daily-${++idSequence}`,
    createDeviceId: () => 'daily-test-device',
    createMutationId: () => `daily-mutation-${++mutationSequence}`,
  })
  return { database, repository }
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('daily task repository', () => {
  it('creates desktop-compatible tasks for the local date and orders them by order then createdAt', async () => {
    const { database, repository } = createTestRepository()

    await repository.create('第二件事', 20)
    await repository.create('第一件事', 10)

    await expect(repository.listForDate(new Date(2026, 6, 23))).resolves.toMatchObject([
      { entityId: 'daily-2', id: 'daily-2', text: '第一件事', order: 10 },
      { entityId: 'daily-1', id: 'daily-1', text: '第二件事', order: 20 },
    ])
    await expect(database.syncRecords.get('daily_task:daily-1')).resolves.toMatchObject({
      entityId: 'daily-1',
      payload: {
        id: 'daily-1', text: '第二件事', priority: false, done: false,
        createdAt: new Date(2026, 6, 23, 10, 30).getTime(), completedAt: null, order: 20,
      },
    })
    await expect(database.outbox.count()).resolves.toBe(2)
    await expect(repository.pendingCount()).resolves.toBe(2)
    database.close()
  })

  it('renames, prioritizes, completes and reopens through the envelope id without losing legacy fields', async () => {
    const { database, repository } = createTestRepository()
    const sync = createSyncRepository(database)
    const createdAt = new Date(2026, 6, 23, 8, 15).getTime()
    await sync.applyRemoteRecord({
      key: 'daily_task:envelope-daily',
      entityType: 'daily_task',
      entityId: 'envelope-daily',
      payload: {
        id: 'legacy-payload-id',
        text: '旧标题',
        priority: false,
        done: false,
        createdAt,
        completedAt: null,
        order: 4,
        unknownDesktopField: { keep: ['yes'] },
      },
      deleted: false,
      revision: 7,
      clientUpdatedAt: createdAt,
      serverUpdatedAt: createdAt,
      deviceId: 'desktop-device',
    })

    await repository.rename('envelope-daily', '新标题')
    await repository.togglePriority('envelope-daily')
    await repository.complete('envelope-daily')
    await repository.reopen('envelope-daily')

    await expect(sync.getRecord('daily_task', 'envelope-daily')).resolves.toMatchObject({
      entityId: 'envelope-daily',
      payload: {
        id: 'legacy-payload-id',
        text: '新标题',
        priority: true,
        done: false,
        completedAt: null,
        unknownDesktopField: { keep: ['yes'] },
      },
    })
    expect((await repository.listForDate(new Date(2026, 6, 23)))[0].entityId).toBe('envelope-daily')
    expect(await database.outbox.count()).toBe(5)
    expect((await database.outbox.toArray()).some((mutation) => (
      mutation.entityType === 'reflection'
      && mutation.record.payload.kind === 'completed-task-summary'
    ))).toBe(true)
    database.close()
  })

  it('moves tasks, keeps their order durable offline, and deletes with a payload-preserving tombstone', async () => {
    const { database, repository } = createTestRepository()
    await repository.create('第一项', 10)
    await repository.create('第二项', 20)

    await expect(repository.move('daily-2', 'up', new Date(2026, 6, 23))).resolves.toBe(true)
    await expect(repository.listForDate(new Date(2026, 6, 23))).resolves.toMatchObject([
      { entityId: 'daily-2', order: 10 },
      { entityId: 'daily-1', order: 20 },
    ])

    await expect(repository.remove('daily-1')).resolves.toBe(true)
    await expect(repository.listForDate(new Date(2026, 6, 23))).resolves.toMatchObject([
      { entityId: 'daily-2' },
    ])
    await expect(database.syncRecords.get('daily_task:daily-1')).resolves.toMatchObject({
      deleted: true,
      payload: { id: 'daily-1', text: '第一项' },
    })
    expect(await database.outbox.count()).toBe(5)
    database.close()
  })
})
