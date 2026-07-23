import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateLongTaskInput,
  LongTask,
  LongTaskRepository,
  QuadrantId,
} from '../data/longTaskRepository'
import { longTaskRepositoryKey } from '../data/longTaskRepositoryContext'
import LongBoardView from './LongBoardView.vue'
import LongQuadrantView from './LongQuadrantView.vue'
import LongTaskDetailView from './LongTaskDetailView.vue'

const task: LongTask = {
  entityId: 'task-with-notes',
  id: 'task-with-notes',
  title: '我要培养自己的',
  notes: '第一行\n<img src=x onerror=alert(1)>\n第三行',
  quadrantId: 'not-important-not-urgent',
  status: 'active',
  order: 1,
  createdAt: 1,
  updatedAt: 1,
}

function repositoryWith(tasks: LongTask[]): LongTaskRepository {
  return {
    create: vi.fn(async (input: CreateLongTaskInput): Promise<LongTask> => ({
      entityId: 'created-envelope-id',
      id: 'created-envelope-id',
      title: input.title,
      notes: input.notes ?? '',
      quadrantId: input.quadrantId,
      status: 'active',
      order: 10,
      createdAt: 10,
      updatedAt: 10,
      plannedAt: input.plannedAt ?? null,
    })),
    save: vi.fn(async (saved) => saved.id),
    get: vi.fn(async (id) => tasks.find((candidate) => candidate.entityId === id)),
    listByQuadrant: vi.fn(async (quadrantId: QuadrantId) =>
      tasks.filter((candidate) => candidate.quadrantId === quadrantId && candidate.status !== 'completed'),
    ),
    listCompletedByQuadrant: vi.fn(async (quadrantId: QuadrantId) =>
      tasks.filter((candidate) => candidate.quadrantId === quadrantId && candidate.status === 'completed'),
    ),
    update: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    reopen: vi.fn(async () => true),
    moveToQuadrant: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  }
}

const global = (repository: LongTaskRepository) => ({
  provide: { [longTaskRepositoryKey as symbol]: repository },
  stubs: { RouterLink: RouterLinkStub },
})

describe('long task drill-down', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders four quadrant cards that open their full lists', async () => {
    const wrapper = mount(LongBoardView, { global: global(repositoryWith([task])) })
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="quadrant-card"]')
    expect(cards).toHaveLength(4)
    expect(cards.map((card) => card.attributes('data-quadrant'))).toEqual([
      'important-urgent',
      'important-not-urgent',
      'urgent-not-important',
      'not-important-not-urgent',
    ])
    expect(cards[3].findComponent(RouterLinkStub).props('to')).toBe('/long/not-important-not-urgent')
    expect(cards[3].text()).toContain('我要培养自己的')
  })

  it('opens a task title from the quadrant list as a detail route', async () => {
    const wrapper = mount(LongQuadrantView, {
      props: { quadrantId: 'not-important-not-urgent' },
      global: global(repositoryWith([task])),
    })
    await flushPromises()

    const taskLink = wrapper.findAllComponents(RouterLinkStub)[1]
    expect(taskLink.text()).toBe('我要培养自己的')
    expect(taskLink.props('to')).toBe('/long/not-important-not-urgent/task-with-notes')
    expect(wrapper.find('[data-testid="quadrant-list"]').exists()).toBe(true)
  })

  it('routes imported tasks by envelope entityId instead of their legacy payload id', async () => {
    const imported = { ...task, entityId: 'envelope-id', id: 'legacy-payload-id' }
    const repository = repositoryWith([imported])
    const wrapper = mount(LongQuadrantView, {
      props: { quadrantId: 'not-important-not-urgent' },
      global: global(repository),
    })
    await flushPromises()

    const taskLink = wrapper.findAllComponents(RouterLinkStub)[1]
    expect(taskLink.props('to')).toBe('/long/not-important-not-urgent/envelope-id')
    await wrapper.get('[data-testid="complete-long-task"]').trigger('click')
    await flushPromises()
    expect(repository.complete).toHaveBeenCalledWith('envelope-id')
  })

  it('creates a task with notes and plannedAt from a labelled quadrant form', async () => {
    const repository = repositoryWith([])
    const wrapper = mount(LongQuadrantView, {
      props: { quadrantId: 'important-urgent' },
      global: global(repository),
    })
    await flushPromises()

    await wrapper.get('#long-new-title').setValue('准备答辩')
    await wrapper.get('#long-new-notes').setValue('第一行\n第二行')
    await wrapper.get('#long-new-planned-at').setValue('2026-08-01T08:30:00.000Z')
    await wrapper.get('form[aria-label="添加长期任务"]').trigger('submit')
    await flushPromises()

    expect(repository.create).toHaveBeenCalledWith({
      title: '准备答辩',
      notes: '第一行\n第二行',
      quadrantId: 'important-urgent',
      plannedAt: '2026-08-01T08:30:00.000Z',
    })
    expect(wrapper.text()).toContain('准备答辩')
  })

  it('completes a task through the repository and removes it from the visible list', async () => {
    const repository = repositoryWith([task])
    const wrapper = mount(LongQuadrantView, {
      props: { quadrantId: 'not-important-not-urgent' },
      global: global(repository),
    })
    await flushPromises()

    await wrapper.get('[data-testid="complete-long-task"]').trigger('click')
    await flushPromises()

    expect(repository.complete).toHaveBeenCalledWith('task-with-notes')
    expect(wrapper.find('[data-testid="long-task-link"]').exists()).toBe(false)
  })

  it('renders multiline notes as text instead of executable markup', async () => {
    const wrapper = mount(LongTaskDetailView, {
      props: {
        quadrantId: 'not-important-not-urgent',
        taskId: 'task-with-notes',
      },
      global: global(repositoryWith([task])),
    })
    await flushPromises()

    const notes = wrapper.get('[data-testid="task-notes"]')
    expect(notes.element.textContent).toBe(task.notes)
    expect(notes.find('img').exists()).toBe(false)
    expect(notes.classes()).toContain('task-notes')
  })

  it('edits title notes plannedAt and moves a task without replacing its identity', async () => {
    const imported = {
      ...task,
      entityId: 'envelope-id',
      id: 'legacy-id',
      plannedAt: '2026-08-01T08:30:00.000Z',
    }
    const repository = repositoryWith([imported])
    const wrapper = mount(LongTaskDetailView, {
      props: { quadrantId: imported.quadrantId, taskId: imported.entityId },
      global: global(repository),
    })
    await flushPromises()

    await wrapper.get('button[aria-label="编辑长期任务"]').trigger('click')
    await wrapper.get('#long-edit-title').setValue('新标题')
    await wrapper.get('#long-edit-notes').setValue('新第一行\n新第二行')
    await wrapper.get('#long-edit-planned-at').setValue('2026-09-03 09:00')
    await wrapper.get('#long-edit-quadrant').setValue('urgent-not-important')
    await wrapper.get('form[aria-label="编辑长期任务"]').trigger('submit')
    await flushPromises()

    expect(repository.update).toHaveBeenCalledWith('envelope-id', {
      title: '新标题', notes: '新第一行\n新第二行', plannedAt: '2026-09-03 09:00',
    })
    expect(repository.moveToQuadrant).toHaveBeenCalledWith('envelope-id', 'urgent-not-important')
    expect(wrapper.text()).toContain('新标题')
    expect(wrapper.get('[data-testid="task-notes"]').text()).toContain('新第二行')
  })

  it('completes, reopens, and deletes from the detail screen', async () => {
    const repository = repositoryWith([{ ...task }])
    const wrapper = mount(LongTaskDetailView, {
      props: { quadrantId: task.quadrantId, taskId: task.entityId },
      global: global(repository),
    })
    await flushPromises()

    await wrapper.get('button[aria-label="完成长期任务"]').trigger('click')
    await flushPromises()
    expect(repository.complete).toHaveBeenCalledWith(task.entityId)
    expect(wrapper.find('button[aria-label="重新打开长期任务"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="重新打开长期任务"]').trigger('click')
    await flushPromises()
    expect(repository.reopen).toHaveBeenCalledWith(task.entityId)

    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.get('button[aria-label="删除长期任务"]').trigger('click')
    await flushPromises()
    expect(repository.remove).toHaveBeenCalledWith(task.entityId)
    expect(wrapper.text()).toContain('任务已删除')
  })

  it('shows completed tasks in the quadrant and reopens them locally', async () => {
    const completed = { ...task, status: 'completed' as const, completedAt: 20 }
    const repository = repositoryWith([completed])
    const wrapper = mount(LongQuadrantView, {
      props: { quadrantId: task.quadrantId },
      global: global(repository),
    })
    await flushPromises()

    expect(wrapper.text()).toContain('已完成')
    await wrapper.get('[data-testid="reopen-long-task"]').trigger('click')
    await flushPromises()
    expect(repository.reopen).toHaveBeenCalledWith(task.entityId)
    expect(wrapper.get('[data-testid="long-task-link"]').text()).toContain(task.title)
  })
})
