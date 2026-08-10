import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConflictList from './ConflictList.vue'

describe('ConflictList', () => {
  it('shows both versions and exposes explicit keep-local and keep-remote actions', async () => {
    const wrapper = mount(ConflictList, {
      props: {
        busyId: null,
        conflicts: [{
          id: 'conflict-1',
          mutationId: 'mutation-1',
          recordKey: 'long_task:task-1',
          entityType: 'long_task',
          entityId: 'task-1',
          local: {
            key: 'long_task:task-1', entityType: 'long_task', entityId: 'task-1',
            payload: { title: '本地标题', notes: '本地备注' }, deleted: false, revision: 1,
            clientUpdatedAt: 1, serverUpdatedAt: 1, deviceId: 'phone',
          },
          remote: {
            key: 'long_task:task-1', entityType: 'long_task', entityId: 'task-1',
            payload: { title: '云端标题', notes: '云端备注' }, deleted: false, revision: 2,
            clientUpdatedAt: 2, serverUpdatedAt: 2, deviceId: 'desktop',
          },
          status: 'open',
          createdAt: 3,
        }],
      },
    })

    expect(wrapper.text()).toContain('本地标题')
    expect(wrapper.text()).toContain('云端标题')
    await wrapper.get('[data-testid="keep-local"]').trigger('click')
    await wrapper.get('[data-testid="keep-remote"]').trigger('click')
    expect(wrapper.emitted('resolve')).toEqual([
      ['conflict-1', 'keep_local'],
      ['conflict-1', 'keep_remote'],
    ])
  })

  it('renders recognizable fields for every entity type and safely formats unknown payloads', () => {
    const base = {
      deleted: false, revision: 1, clientUpdatedAt: 1, serverUpdatedAt: 1, deviceId: 'phone',
    }
    const payloads = [
      ['daily_task', { title: '今日论文', priority: 'high' }],
      ['long_task', { title: '长期写作', notes: '章节备注' }],
      ['focus_session', { workType: '论文', durationMs: 1_500_000 }],
      ['mode_event', { mode: 'rest', action: 'started' }],
      ['time_audit', { category: '学习', durationMinutes: 35 }],
      ['distraction', { content: '想刷手机', occurredAt: '10:30' }],
      ['reflection', { content: '今天保持专注', date: '2026-07-23' }],
      ['soul_quote', { text: '把注意力带回来', source: '灵魂按摩间' }],
    ] as const
    const conflicts = payloads.map(([entityType, payload], index) => ({
      id: `conflict-${index}`, mutationId: null, recordKey: `${entityType}:item-${index}`,
      entityType, entityId: `item-${index}`,
      local: { key: `${entityType}:item-${index}`, entityType, entityId: `item-${index}`, payload, ...base },
      remote: {
        key: `${entityType}:item-${index}`, entityType, entityId: `item-${index}`,
        payload: { unknownNested: { safe: true }, count: index }, ...base,
      },
      status: 'open' as const, createdAt: index,
    }))
    const wrapper = mount(ConflictList, { props: { conflicts, busyId: null } })

    for (const expected of [
      '今日论文', '长期写作', '章节备注', '论文', '25 分钟', '休息', '开始',
      '学习', '35 分钟', '想刷手机', '今天保持专注', '把注意力带回来', '灵魂按摩间', 'unknownNested', 'safe',
    ]) expect(wrapper.text()).toContain(expected)
  })
})
