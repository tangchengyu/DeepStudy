import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DailyTask, DailyTaskRepository } from '../data/dailyTaskRepository'
import { dailyTaskRepositoryKey } from '../data/dailyTaskRepositoryContext'
import TodayView from './TodayView.vue'

function task(overrides: Partial<DailyTask> = {}): DailyTask {
  return {
    entityId: 'daily-1',
    id: 'daily-1',
    text: '初始任务',
    priority: false,
    done: false,
    createdAt: 1,
    completedAt: null,
    order: 1,
    ...overrides,
  }
}

function repositoryWith(tasks: DailyTask[] = [], pending = 0): DailyTaskRepository {
  return {
    create: vi.fn(async (text) => task({ entityId: 'daily-created', id: 'daily-created', text })),
    get: vi.fn(async (entityId) => tasks.find((item) => item.entityId === entityId)),
    listForDate: vi.fn(async () => [...tasks]),
    rename: vi.fn(async () => true),
    togglePriority: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    reopen: vi.fn(async () => true),
    move: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    pendingCount: vi.fn(async () => pending),
  }
}

describe('Today task flow', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the empty and offline-pending states and creates a task from a labelled keyboard form', async () => {
    const repository = repositoryWith([], 2)
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('今天还没有任务')
    expect(wrapper.text()).toContain('2 项更改等待同步')
    expect(wrapper.get('label[for="today-new-task"]').text()).toContain('任务内容')

    await wrapper.get('#today-new-task').setValue('完成论文')
    await wrapper.get('form[aria-label="添加今日任务"]').trigger('submit')
    await flushPromises()

    expect(repository.create).toHaveBeenCalledWith('完成论文')
    expect(wrapper.text()).toContain('完成论文')
    expect(wrapper.text()).not.toContain('今天还没有任务')
  })

  it('renames a task from a labelled keyboard-accessible edit form', async () => {
    const repository = repositoryWith([task()])
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    await wrapper.get('button[aria-label="编辑 初始任务"]').trigger('click')
    const editForm = wrapper.get('form[aria-label="编辑 初始任务"]')
    expect(editForm.get('label').text()).toContain('任务内容')
    await editForm.get('input').setValue('修改后的任务')
    await editForm.trigger('submit')
    await flushPromises()

    expect(repository.rename).toHaveBeenCalledWith('daily-1', '修改后的任务')
    expect(wrapper.text()).toContain('修改后的任务')
  })

  it('prioritizes, completes, reopens, moves, and deletes tasks with labelled controls', async () => {
    const repository = repositoryWith([
      task(),
      task({ entityId: 'daily-2', id: 'daily-2', text: '第二任务', order: 2 }),
    ])
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    await wrapper.get('button[aria-label="设为优先 初始任务"]').trigger('click')
    await wrapper.get('button[aria-label="完成 初始任务"]').trigger('click')
    await flushPromises()
    await wrapper.get('button[aria-label="重新打开 初始任务"]').trigger('click')
    await wrapper.get('button[aria-label="下移 初始任务"]').trigger('click')
    await flushPromises()

    expect(repository.togglePriority).toHaveBeenCalledWith('daily-1')
    expect(repository.complete).toHaveBeenCalledWith('daily-1')
    expect(repository.reopen).toHaveBeenCalledWith('daily-1')
    expect(repository.move).toHaveBeenCalledWith('daily-1', 'down')
    expect(wrapper.findAll('[data-testid="daily-task-text"]').map((item) => item.text()))
      .toEqual(['第二任务', '初始任务'])

    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.get('button[aria-label="删除 初始任务"]').trigger('click')
    await flushPromises()
    expect(repository.remove).toHaveBeenCalledWith('daily-1')
    expect(wrapper.text()).not.toContain('初始任务')
  })

  it('does not delete when the confirmation is cancelled', async () => {
    const repository = repositoryWith([task()])
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    vi.stubGlobal('confirm', vi.fn(() => false))
    await wrapper.get('button[aria-label="删除 初始任务"]').trigger('click')
    await flushPromises()

    expect(repository.remove).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('初始任务')
  })

  it('reloads the visible task list after local midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 23, 59, 30))
    const repository = repositoryWith()
    vi.mocked(repository.listForDate)
      .mockResolvedValueOnce([task({ text: '旧日期任务' })])
      .mockResolvedValueOnce([task({ entityId: 'daily-next', id: 'daily-next', text: '新日期任务' })])
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('旧日期任务')

    vi.setSystemTime(new Date(2026, 6, 24, 0, 0, 31))
    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()

    expect(repository.listForDate).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('新日期任务')
  })

  it('shows a save error without discarding the local editor text', async () => {
    const repository = repositoryWith()
    vi.mocked(repository.create).mockRejectedValueOnce(new Error('disk full'))
    const wrapper = mount(TodayView, {
      global: { provide: { [dailyTaskRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    await wrapper.get('#today-new-task').setValue('仍需保存')
    await wrapper.get('form[aria-label="添加今日任务"]').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('保存失败')
    expect((wrapper.get('#today-new-task').element as HTMLInputElement).value).toBe('仍需保存')
  })
})
