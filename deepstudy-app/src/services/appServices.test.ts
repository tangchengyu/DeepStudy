import { describe, expect, it, vi } from 'vitest'
import { createAppServiceInitializer } from './appServices'

describe('offline-first app service initialization', () => {
  it('makes local account data available before remote validation finishes', async () => {
    let finishRemote!: () => void
    const account = {
      state: { status: 'offline-session' },
      restoreCachedSession: vi.fn(async () => undefined),
      refreshSession: vi.fn(() => new Promise<void>((resolve) => { finishRemote = resolve })),
    }
    const timer = { initialize: vi.fn(async () => undefined) }
    const sync = { refreshState: vi.fn(async () => undefined) }
    const enableSync = vi.fn(async () => true)
    const initializer = createAppServiceInitializer({ account, timer, sync, enableSync })

    await initializer.initialize()

    expect(account.restoreCachedSession).toHaveBeenCalledTimes(1)
    expect(sync.refreshState).toHaveBeenCalled()
    expect(enableSync).toHaveBeenCalledTimes(1)
    expect(account.refreshSession).toHaveBeenCalledTimes(1)
    expect(timer.initialize).toHaveBeenCalledTimes(1)

    finishRemote()
    await initializer.waitForBackground()
  })
})
