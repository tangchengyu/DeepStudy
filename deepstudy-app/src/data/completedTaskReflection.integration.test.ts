import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createDailyTaskRepository } from './dailyTaskRepository'
import { createLongTaskRepository } from './longTaskRepository'
import { createReflectionRepository } from './reflectionRepository'
import { createSyncDatabase, createSyncRepository } from './syncRepository'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('completed task reflection integration', () => {
  it('deduplicates repeated Today and Long completions into one desktop-compatible daily summary', async () => {
    const databaseName = `deepstudy-completion-reflection-${crypto.randomUUID()}`
    databaseNames.push(databaseName)
    const database = createSyncDatabase(databaseName)
    let timestamp = new Date(2026, 6, 23, 9).getTime()
    let mutationSequence = 0
    let reflectionSequence = 0
    const sharedOptions = {
      now: () => timestamp,
      createDeviceId: () => 'completion-reflection-device',
      createMutationId: () => `completion-mutation-${++mutationSequence}`,
      createReflectionId: () => `auto-reflection-${++reflectionSequence}`,
    }
    const daily = createDailyTaskRepository(database, sharedOptions)
    const long = createLongTaskRepository(database, sharedOptions)
    const reflections = createReflectionRepository(database, {
      ...sharedOptions,
      createEntityId: sharedOptions.createReflectionId,
    })
    const sync = createSyncRepository(database)

    await sync.applyRemoteRecord({
      key: 'daily_task:daily-envelope',
      entityType: 'daily_task',
      entityId: 'daily-envelope',
      payload: {
        id: 'legacy-daily-id', text: '写周报', priority: false, done: false,
        createdAt: timestamp - 1_000, completedAt: null, order: 1, unknownDaily: true,
      },
      deleted: false,
      revision: 1,
      clientUpdatedAt: timestamp,
      serverUpdatedAt: timestamp,
      deviceId: 'desktop-device',
    })
    await long.save({
      id: 'long-envelope',
      title: '整理方案',
      notes: '',
      quadrantId: 'important-not-urgent',
      status: 'active',
      order: 1,
      createdAt: timestamp - 2_000,
      updatedAt: timestamp - 2_000,
    })

    await daily.complete('daily-envelope')
    timestamp += 60_000
    await daily.reopen('daily-envelope')
    await daily.rename('daily-envelope', '写完周报')
    await daily.complete('daily-envelope')
    timestamp += 60_000
    await long.complete('long-envelope')

    const entries = (await reflections.listGrouped())[0].entries
      .filter((entry) => entry.kind === 'completed-task-summary')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      date: '2026-07-23',
      kind: 'completed-task-summary',
      content: '已完成：写完周报\n已完成：整理方案',
      sourceTaskIds: ['daily:daily-envelope', 'long:long-envelope'],
    })
    await expect(sync.getRecord('daily_task', 'daily-envelope')).resolves.toMatchObject({
      payload: { id: 'legacy-daily-id', done: true, unknownDaily: true },
    })
    database.close()
  })
})
