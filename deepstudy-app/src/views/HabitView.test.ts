import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reflectionRepositoryKey,
  type ReflectionRepository,
  type ReflectionEntry,
} from '../data/reflectionRepository'
import HabitView from './HabitView.vue'

function entry(overrides: Partial<ReflectionEntry> = {}): ReflectionEntry {
  return {
    entityId: 'manual-today',
    id: 'manual-today',
    date: '2026-07-23',
    content: '第一行\n第二行',
    kind: 'manual',
    updatedAt: 1,
    ...overrides,
  }
}

function repositoryWith(): ReflectionRepository {
  const today = entry()
  return {
    get: vi.fn(async () => today),
    saveManual: vi.fn(async (content) => ({ ...today, content })),
    update: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    listGrouped: vi.fn(async () => [
      { date: '2026-07-23', entries: [today] },
      { date: '2026-07-22', entries: [entry({ entityId: 'old', id: 'old', date: '2026-07-22', content: '昨天' })] },
    ]),
    getAuditSummary: vi.fn(async () => ({
      today: { core: 60 * 60_000, maintenance: 30 * 60_000, rest: 15 * 60_000, distraction: 5 * 60_000 },
      sevenDays: { core: 7 * 60 * 60_000, maintenance: 2 * 60 * 60_000, rest: 60 * 60_000, distraction: 30 * 60_000 },
    })),
    recordCompletedTask: vi.fn(async () => today),
  }
}

describe('Habit reflection and audit view', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads multiline today reflection and saves through a labelled editor', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 9, 0, 0))
    const repository = repositoryWith()
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    const editor = wrapper.get('#today-reflection')
    expect((editor.element as HTMLTextAreaElement).value).toBe('第一行\n第二行')
    await editor.setValue('更新后\n还是多行')
    await wrapper.get('form[aria-label="编辑今日反思"]').trigger('submit')
    await flushPromises()

    expect(repository.saveManual).toHaveBeenCalledWith('更新后\n还是多行', '2026-07-23')
    expect(wrapper.text()).toContain('已保存到本机，等待同步')
  })

  it('shows today and seven-day category totals plus history grouped by date', async () => {
    const repository = repositoryWith()
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    expect(wrapper.get('[aria-label="今日时间审计"]').text()).toContain('1 小时')
    expect(wrapper.get('[aria-label="今日时间审计"]').text()).toContain('30 分钟')
    expect(wrapper.get('[aria-label="近 7 天时间审计"]').text()).toContain('7 小时')
    const groups = wrapper.findAll('[data-testid="reflection-date-group"]')
    expect(groups.map((group) => group.attributes('data-date'))).toEqual(['2026-07-23', '2026-07-22'])
    expect(groups[0].get('[data-testid="reflection-content"]').text()).toContain('第一行\n第二行')
  })

  it('edits and deletes history entries with keyboard-accessible controls', async () => {
    const repository = repositoryWith()
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    await wrapper.get('button[aria-label="编辑 2026-07-22 的反思"]').trigger('click')
    const editForm = wrapper.get('form[aria-label="编辑 2026-07-22 的反思"]')
    await editForm.get('textarea').setValue('修改昨天')
    await editForm.trigger('submit')
    await flushPromises()
    expect(repository.update).toHaveBeenCalledWith('old', '修改昨天')

    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.get('button[aria-label="删除 2026-07-22 的反思"]').trigger('click')
    await flushPromises()
    expect(repository.remove).toHaveBeenCalledWith('old')
  })

  it('clears the today editor when its manual reflection is deleted from history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 9, 0, 0))
    const repository = repositoryWith()
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()

    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.get('button[aria-label="删除 2026-07-23 的反思"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('#today-reflection').element as HTMLTextAreaElement).value).toBe('')
  })

  it('reloads today reflection and audit totals after local midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 23, 59, 30))
    const repository = repositoryWith()
    vi.mocked(repository.listGrouped)
      .mockResolvedValueOnce([{ date: '2026-07-23', entries: [entry({ content: '旧日期' })] }])
      .mockResolvedValueOnce([{ date: '2026-07-24', entries: [entry({
        entityId: 'manual-next',
        id: 'manual-next',
        date: '2026-07-24',
        content: '新日期',
      })] }])
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()
    expect((wrapper.get('#today-reflection').element as HTMLTextAreaElement).value).toBe('旧日期')

    vi.setSystemTime(new Date(2026, 6, 24, 0, 0, 31))
    await vi.advanceTimersByTimeAsync(60_000)
    await flushPromises()

    expect(repository.listGrouped).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('2026-07-24')
    expect((wrapper.get('#today-reflection').element as HTMLTextAreaElement).value).toBe('新日期')
  })

  it('reloads reflection history when sync writes remote records into local storage', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 23, 9, 0, 0))
    const repository = repositoryWith()
    vi.mocked(repository.listGrouped)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ date: '2026-07-23', entries: [entry({ content: '1234' })] }])
    const wrapper = mount(HabitView, {
      global: { provide: { [reflectionRepositoryKey as symbol]: repository } },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('1234')

    window.dispatchEvent(new CustomEvent('deepstudy:sync-data-changed'))
    await flushPromises()

    expect(repository.listGrouped).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('1234')
    expect((wrapper.get('#today-reflection').element as HTMLTextAreaElement).value).toBe('1234')
  })
})
