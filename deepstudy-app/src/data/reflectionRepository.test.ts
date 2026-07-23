import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReflectionRepository,
  type CompletedTaskReflectionInput,
} from './reflectionRepository'
import { createSyncDatabase, createSyncRepository } from './syncRepository'

const databaseNames: string[] = []

function createTestRepository(now = new Date(2026, 6, 23, 12).getTime()) {
  const databaseName = `deepstudy-reflection-test-${crypto.randomUUID()}`
  databaseNames.push(databaseName)
  const database = createSyncDatabase(databaseName)
  let entitySequence = 0
  let mutationSequence = 0
  const repository = createReflectionRepository(database, {
    now: () => now,
    createEntityId: () => `reflection-${++entitySequence}`,
    createDeviceId: () => 'reflection-test-device',
    createMutationId: () => `reflection-mutation-${++mutationSequence}`,
  })
  return { database, repository, sync: createSyncRepository(database) }
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)))
})

describe('reflection repository', () => {
  it('creates and edits one manual reflection for today while preserving multiline and unknown fields', async () => {
    const { database, repository, sync } = createTestRepository()
    const created = await repository.saveManual('第一行\n第二行')

    expect(created).toMatchObject({
      entityId: 'reflection-1',
      id: 'reflection-1',
      date: '2026-07-23',
      content: '第一行\n第二行',
      kind: 'manual',
    })

    const record = await sync.getRecord('reflection', created.entityId)
    const createdMutation = (await database.outbox.toArray())[0]
    await sync.acknowledgeMutation(createdMutation.mutationId, {
      revision: 1,
      serverUpdatedAt: 1_000,
    })
    await sync.applyRemoteRecord({
      ...record!,
      revision: 2,
      payload: { ...record!.payload, desktopExtension: { keep: true } },
    })

    await repository.saveManual('更新后\n仍然多行')
    await expect(repository.get(created.entityId)).resolves.toMatchObject({
      id: 'reflection-1',
      content: '更新后\n仍然多行',
      desktopExtension: { keep: true },
    })
    expect((await database.syncRecords.toArray())
      .filter((item) => item.entityType === 'reflection')).toHaveLength(1)
    database.close()
  })

  it('groups history by descending local date and deletes with a payload-preserving tombstone', async () => {
    const { database, repository, sync } = createTestRepository()
    await sync.enqueueUpsert('reflection', 'older', {
      id: 'legacy-older', date: '2026-07-21', content: '较早', kind: 'manual', updatedAt: 10,
      legacyOnly: 'keep',
    })
    await sync.enqueueUpsert('reflection', 'newer', {
      id: 'legacy-newer', date: '2026-07-23', content: '较新', kind: 'manual', updatedAt: 20,
    })

    await expect(repository.listGrouped()).resolves.toMatchObject([
      { date: '2026-07-23', entries: [{ entityId: 'newer', content: '较新' }] },
      { date: '2026-07-21', entries: [{ entityId: 'older', content: '较早' }] },
    ])
    await expect(repository.remove('older')).resolves.toBe(true)
    await expect(sync.getRecord('reflection', 'older')).resolves.toMatchObject({
      deleted: true,
      payload: { id: 'legacy-older', content: '较早', legacyOnly: 'keep' },
    })
    database.close()
  })

  it('clips audit records at today and seven-day local boundaries', async () => {
    const now = new Date(2026, 6, 23, 12).getTime()
    const todayStart = new Date(2026, 6, 23).getTime()
    const sevenDayStart = new Date(2026, 6, 17).getTime()
    const { database, repository, sync } = createTestRepository(now)
    const addAudit = async (id: string, category: string, start: number, end: number) => {
      await sync.enqueueUpsert('time_audit', id, {
        id, category, start, end, durationMs: end - start,
      })
    }
    await addAudit('core-today', 'core', todayStart, todayStart + 60 * 60_000)
    await addAudit('maintenance-cross-today', 'maintenance', todayStart - 30 * 60_000, todayStart + 30 * 60_000)
    await addAudit('rest-cross-seven', 'rest', sevenDayStart - 30 * 60_000, sevenDayStart + 30 * 60_000)
    await addAudit('distraction-old', 'distraction', sevenDayStart - 2 * 60 * 60_000, sevenDayStart - 60 * 60_000)
    await addAudit('unknown', 'other', todayStart, todayStart + 60 * 60_000)

    await expect(repository.getAuditSummary()).resolves.toEqual({
      today: {
        core: 60 * 60_000,
        maintenance: 30 * 60_000,
        rest: 0,
        distraction: 0,
      },
      sevenDays: {
        core: 60 * 60_000,
        maintenance: 60 * 60_000,
        rest: 30 * 60_000,
        distraction: 0,
      },
    })
    database.close()
  })

  it('updates one desktop-compatible completed-task summary without duplicating imported entries', async () => {
    const { database, repository, sync } = createTestRepository()
    await sync.applyRemoteRecord({
      key: 'reflection:legacy-summary-envelope',
      entityType: 'reflection',
      entityId: 'legacy-summary-envelope',
      payload: {
        id: 'legacy-summary-payload',
        date: '2026-07-23',
        content: '已完成：旧标题',
        kind: 'completed-task-summary',
        sourceTaskIds: ['daily:task-1'],
        updatedAt: 1,
        desktopExtension: 'keep',
      },
      deleted: false,
      revision: 4,
      clientUpdatedAt: 1,
      serverUpdatedAt: 1,
      deviceId: 'desktop-device',
    })

    const completion: CompletedTaskReflectionInput = {
      sourceType: 'daily',
      sourceEntityId: 'task-1',
      text: '新标题',
      completedAt: new Date(2026, 6, 23, 10).getTime(),
    }
    await repository.recordCompletedTask(completion)
    await repository.recordCompletedTask(completion)
    await repository.recordCompletedTask({
      sourceType: 'long',
      sourceEntityId: 'long-1',
      text: '新标题',
      completedAt: new Date(2026, 6, 23, 11).getTime(),
    })

    const completedEntries = (await repository.listGrouped())[0].entries
      .filter((entry) => entry.kind.startsWith('completed-task'))
    expect(completedEntries).toHaveLength(1)
    expect(completedEntries[0]).toMatchObject({
      entityId: 'legacy-summary-envelope',
      id: 'legacy-summary-payload',
      kind: 'completed-task-summary',
      content: '已完成：新标题',
      sourceTaskIds: ['daily:task-1', 'long:long-1'],
      desktopExtension: 'keep',
    })
    database.close()
  })
})
