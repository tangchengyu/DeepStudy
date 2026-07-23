import { describe, expect, it, vi } from 'vitest'
import { createGatewaySettings } from './gatewaySettings'
import { switchGatewayOrigin } from './gatewaySwitch'

describe('gateway origin switching', () => {
  it('requires confirmation and signs out before changing an existing origin', async () => {
    const storage = new Map<string, string>()
    const settings = createGatewaySettings({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value) },
      removeItem: (key) => { storage.delete(key) },
    }, 'https://old.example.test')
    const calls: string[] = []
    const account = { signOut: vi.fn(async () => { calls.push('sign-out') }) }
    const sync = { stop: vi.fn(() => { calls.push('stop-sync') }) }
    const tokenStorage = { clear: vi.fn(async (scope: string) => { calls.push(`clear:${scope}`) }) }

    await expect(switchGatewayOrigin({
      nextUrl: 'https://new.example.test/path',
      settings,
      account,
      sync,
      tokenStorage,
      confirm: () => true,
    })).resolves.toMatchObject({ changed: true, baseUrl: 'https://new.example.test' })

    expect(calls).toEqual(['stop-sync', 'sign-out', 'clear:https://new.example.test'])
    expect(settings.getBaseUrl()).toBe('https://new.example.test')
  })

  it('does not change origin or sign out when the user cancels', async () => {
    const storage = localStorage
    storage.clear()
    const settings = createGatewaySettings(storage, 'https://old.example.test')
    const account = { signOut: vi.fn() }
    const sync = { stop: vi.fn() }
    const tokenStorage = { clear: vi.fn() }

    await expect(switchGatewayOrigin({
      nextUrl: 'https://new.example.test',
      settings,
      account,
      sync,
      tokenStorage,
      confirm: () => false,
    })).resolves.toMatchObject({ changed: false, baseUrl: 'https://old.example.test' })

    expect(account.signOut).not.toHaveBeenCalled()
    expect(settings.getBaseUrl()).toBe('https://old.example.test')
  })
})
