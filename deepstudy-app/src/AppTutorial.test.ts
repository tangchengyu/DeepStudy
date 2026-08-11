import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { appRoutes } from './router/routes'

vi.mock('./services/appServices', () => ({
  initializeAppServices: vi.fn(async () => undefined),
  accountCoordinator: {
    state: {
      status: 'signed-out',
      user: null,
      pendingRecoveryCode: null,
      recoveryReason: null,
    },
    signOut: vi.fn(async () => undefined),
  },
  gatewayClient: {
    config: vi.fn(async () => ({
      turnstileSiteKey: '',
      minimumPasswordLength: 10,
    })),
  },
  mobileSyncService: {
    state: {
      phase: 'idle',
      online: true,
      pending: 0,
      conflicts: 0,
      lastSyncAt: null,
    },
    start: vi.fn(),
    stop: vi.fn(),
    syncNow: vi.fn(async () => ({ pushed: 0, pulled: 0, applied: 0, conflicts: 0 })),
    previewRemoteImpact: vi.fn(async () => ({
      active: 0,
      create: 0,
      update: 0,
      unchanged: 0,
    })),
  },
}))

describe('mobile onboarding tutorial', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts the guide automatically the first time the app is opened', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: appRoutes })
    await router.push('/today')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await vi.dynamicImportSettled()

    expect(wrapper.text()).toContain('使用教程')
    expect(wrapper.text()).toContain('每日计划')
    expect(localStorage.getItem('deepstudy.mobileTutorial.seen.v1')).toBe('1')
  })

  it('can be reopened from the Mine screen', async () => {
    localStorage.setItem('deepstudy.mobileTutorial.seen.v1', '1')
    const router = createRouter({ history: createMemoryHistory(), routes: appRoutes })
    await router.push('/mine')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await vi.dynamicImportSettled()
    await wrapper.get('button[aria-label="打开使用教程"]').trigger('click')

    expect(wrapper.text()).toContain('使用教程')
    expect(wrapper.text()).toContain('每日计划')
  })
})
