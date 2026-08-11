import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FocusTimerService, LocalTimerState } from '../services/focusTimerService'
import { focusTimerServiceKey } from '../services/focusTimerServiceContext'
import FocusView from './FocusView.vue'

function localTimer(overrides: Partial<LocalTimerState> = {}): LocalTimerState {
  return {
    version: 1,
    mode: 'focus',
    status: 'idle',
    plannedMs: 25 * 60_000,
    remainingMs: 25 * 60_000,
    targetEndAt: null,
    sessionStartAt: null,
    segmentStartAt: null,
    accumulatedMs: 0,
    workType: 'core',
    leaseVersion: 0,
    ownerDeviceId: null,
    needsOwnershipCheck: false,
    pendingRelease: false,
    distractionStartedAt: null,
    focusDurationMinutes: 25,
    restDurationMinutes: 15,
    updatedAt: 1,
    ...overrides,
  }
}

function fakeTimer(overrides: Partial<FocusTimerService['state']> = {}) {
  const state = reactive({
    local: localTimer(),
    remote: null,
    ownershipConflict: false,
    busy: false,
    message: '',
    ...overrides,
  }) as FocusTimerService['state']
  const service = {
    state,
    initialize: vi.fn(async () => undefined),
    destroy: vi.fn(),
    waitForIdle: vi.fn(async () => undefined),
    reloadScope: vi.fn(async () => undefined),
    remainingMs: vi.fn(() => state.local.remainingMs),
    setMode: vi.fn(async (mode: 'focus' | 'rest') => {
      state.local.mode = mode
      state.local.workType = mode === 'focus' ? 'core' : 'rest'
      return true
    }),
    setDuration: vi.fn(async (minutes: number) => {
      state.local.plannedMs = Number(minutes) * 60_000
      state.local.remainingMs = state.local.plannedMs
      return true
    }),
    setWorkType: vi.fn(async () => true),
    start: vi.fn(async () => { state.local.status = 'running'; return true }),
    pause: vi.fn(async () => { state.local.status = 'paused'; return true }),
    resume: vi.fn(async () => { state.local.status = 'running'; return true }),
    tick: vi.fn(async () => false),
    reconcileVisibility: vi.fn(async () => false),
    reset: vi.fn(async () => { state.local.status = 'idle'; return true }),
    startDistraction: vi.fn(async () => {
      state.local.status = 'paused'
      state.local.distractionStartedAt = 100
      return true
    }),
    finishDistraction: vi.fn(async () => {
      state.local.status = 'running'
      state.local.distractionStartedAt = null
      return true
    }),
    refreshRemote: vi.fn(async () => null),
    takeOverRemote: vi.fn(async () => true),
  }
  return service as unknown as FocusTimerService
}

function mountFocus(service = fakeTimer()) {
  return {
    service,
    wrapper: mount(FocusView, {
      global: { provide: { [focusTimerServiceKey as symbol]: service } },
    }),
  }
}

function stubAudio() {
  const players: Array<{
    src: string
    loop: boolean
    paused: boolean
    volume: number
    playbackRate: number
    currentTime: number
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
  }> = []
  vi.stubGlobal('Audio', class {
    src: string
    loop = false
    paused = true
    volume = 1
    playbackRate = 1
    currentTime = 0
    onended: (() => void) | null = null
    constructor(src: string) {
      this.src = src
      players.push(this)
    }
    play = vi.fn(async () => {
      this.paused = false
    })
    pause = vi.fn(() => {
      this.paused = true
    })
  })
  return players
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('focus timer screen', () => {
  it('exposes usable focus, rest, duration, and timer controls', () => {
    const { wrapper } = mountFocus()

    expect(wrapper.get('button[aria-label="切换到专注模式"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button[aria-label="切换到休息模式"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('input[aria-label="计时分钟数"]').attributes()).toMatchObject({ min: '1', max: '240' })
    expect(wrapper.get('button[aria-label="开始计时"]').text()).toContain('开始专注')
  })

  it('uses a compact desktop-style segmented mode switcher', () => {
    const { wrapper } = mountFocus()

    expect(wrapper.get('[data-testid="focus-mode-segments"]').classes()).toContain('mode-segments')
    expect(wrapper.findAll('.mode-card')).toHaveLength(0)
    expect(wrapper.find('[data-testid="timer-card"]').exists()).toBe(true)
  })

  it('plays the same built-in white noise tracks with rate and volume controls', async () => {
    const players = stubAudio()
    const { wrapper } = mountFocus()

    await wrapper.get('button[aria-label="打开我的白噪音"]').trigger('click')
    expect(wrapper.text()).toContain('木鱼白噪音')
    expect(wrapper.text()).toContain('雨声白噪音')

    await wrapper.get('button[aria-label="播放 木鱼白噪音"]').trigger('click')
    await flushPromises()
    expect(players).toHaveLength(1)
    expect(players[0].src).toContain('muyu')
    expect(players[0].loop).toBe(true)
    expect(players[0].play).toHaveBeenCalledTimes(1)

    await wrapper.get('button[data-noise-rate="1.5"]').trigger('click')
    expect(players[0].playbackRate).toBe(1.5)

    await wrapper.get('input[aria-label="白噪音音量"]').setValue('40')
    expect(players[0].volume).toBeCloseTo(0.4)
  })

  it('shows desktop-matched breathing practice in rest mode', async () => {
    const players = stubAudio()
    const service = fakeTimer({ local: localTimer({ mode: 'rest', workType: 'rest', plannedMs: 15 * 60_000, remainingMs: 15 * 60_000 }) })
    const { wrapper } = mountFocus(service)

    expect(wrapper.text()).toContain('呼吸练习')
    await wrapper.get('button[aria-label="打开呼吸练习"]').trigger('click')
    expect(wrapper.text()).toContain('4-4-4-4 腹式呼吸')
    expect(wrapper.text()).toContain('冰人呼吸法')

    await wrapper.get('button[aria-label="开始 4-4-4-4 腹式呼吸"]').trigger('click')
    await flushPromises()
    expect(players[0].src).toContain('4-4-4-4')
    expect(players[0].play).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="breathing-stage"]').text()).toContain('语音同步')
  })

  it('switches mode, applies a 1–240 minute duration, and starts from labelled controls', async () => {
    const { wrapper, service } = mountFocus()

    await wrapper.get('button[aria-label="切换到休息模式"]').trigger('click')
    await flushPromises()
    expect(service.setMode).toHaveBeenCalledWith('rest')

    await wrapper.get('input[aria-label="计时分钟数"]').setValue('30')
    await wrapper.get('input[aria-label="计时分钟数"]').trigger('change')
    await wrapper.get('button[aria-label="开始计时"]').trigger('click')
    await flushPromises()

    expect(service.setDuration).toHaveBeenCalledWith(30)
    expect(service.start).toHaveBeenCalled()
  })

  it('captures a quick distraction and offers a direct return to focus', async () => {
    const service = fakeTimer({ local: localTimer({ status: 'running' }) })
    const { wrapper } = mountFocus(service)

    await wrapper.get('button.distraction-button').trigger('click')
    await flushPromises()
    expect(service.startDistraction).toHaveBeenCalled()
    expect(wrapper.text()).toContain('刚才是什么打断了你')

    await wrapper.get('#distraction-text').setValue('临时消息')
    await wrapper.get('.distraction-sheet .primary-button').trigger('click')
    await flushPromises()
    expect(service.finishDistraction).toHaveBeenCalledWith(
      '临时消息',
      'controllable',
      'interesting',
      true,
    )
  })

  it('keeps another device timer read-only behind one explicit takeover action', async () => {
    const service = fakeTimer({
      ownershipConflict: true,
      remote: {
        mode: 'focus',
        ownerDeviceId: 'other-device',
        status: 'running',
        leaseVersion: 3,
        targetEndAt: Date.now() + 20_000,
        remainingMs: 20_000,
        plannedMs: 60_000,
        sessionStartAt: Date.now() - 40_000,
        segmentStartAt: Date.now() - 40_000,
        accumulatedMs: 0,
        workType: 'core',
        updatedAt: Date.now(),
      },
    })
    const { wrapper } = mountFocus(service)

    const takeover = wrapper.findAll('button').filter((button) => button.text().includes('接管并继续'))
    expect(takeover).toHaveLength(1)
    expect(wrapper.get('button[aria-label="开始计时"]').attributes()).toHaveProperty('disabled')
    await takeover[0].trigger('click')
    await flushPromises()
    expect(service.takeOverRemote).toHaveBeenCalledTimes(1)
  })
})
