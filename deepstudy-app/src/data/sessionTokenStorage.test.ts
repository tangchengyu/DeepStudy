import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionTokenStorage } from './sessionTokenStorage'
import { createSyncDatabase, createSyncRepository } from './syncRepository'

describe('session token storage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('stores, reads and removes the bearer token with native secure storage', async () => {
    const secureStorage = {
      setItem: vi.fn(async () => undefined),
      getItem: vi.fn(async () => 'native-token'),
      removeItem: vi.fn(async () => undefined),
    }
    const storage = createSessionTokenStorage({
      isNativePlatform: () => true,
      secureStorage,
      webStorage: sessionStorage,
      allowWebFallback: false,
    })

    await storage.save('native-token', 'https://gateway-a.example')
    await expect(storage.read('https://gateway-a.example')).resolves.toBe('native-token')
    await storage.clear('https://gateway-a.example')

    expect(secureStorage.setItem).toHaveBeenCalledWith(
      'deepstudy.bearerToken.https%3A%2F%2Fgateway-a.example',
      'native-token',
    )
    expect(secureStorage.getItem).toHaveBeenCalledWith(
      'deepstudy.bearerToken.https%3A%2F%2Fgateway-a.example',
    )
    expect(secureStorage.removeItem).toHaveBeenCalledWith(
      'deepstudy.bearerToken.https%3A%2F%2Fgateway-a.example',
    )
    expect(sessionStorage.length).toBe(0)
  })

  it('uses sessionStorage only for the explicit web development fallback', async () => {
    const secureStorage = {
      setItem: vi.fn(async () => undefined),
      getItem: vi.fn(async () => null),
      removeItem: vi.fn(async () => undefined),
    }
    const storage = createSessionTokenStorage({
      isNativePlatform: () => false,
      secureStorage,
      webStorage: sessionStorage,
      allowWebFallback: true,
    })

    await storage.save('web-session-token', 'https://gateway-a.example')
    await expect(storage.read('https://gateway-a.example')).resolves.toBe('web-session-token')
    await expect(storage.read('https://gateway-b.example')).resolves.toBeNull()
    expect(localStorage.getItem('deepstudy.bearerToken')).toBeNull()
    expect(secureStorage.setItem).not.toHaveBeenCalled()

    await storage.clear('https://gateway-a.example')
    expect(sessionStorage.length).toBe(0)
  })

  it('refuses to persist a bearer token in a production web build', async () => {
    const storage = createSessionTokenStorage({
      isNativePlatform: () => false,
      secureStorage: {
        setItem: vi.fn(async () => undefined),
        getItem: vi.fn(async () => null),
        removeItem: vi.fn(async () => undefined),
      },
      webStorage: sessionStorage,
      allowWebFallback: false,
    })

    await expect(storage.save('must-not-persist', 'https://gateway-a.example')).rejects.toThrow('Web token storage is disabled')
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })

  it('never writes the bearer token into the sync IndexedDB', async () => {
    const databaseName = `deepstudy-token-audit-${crypto.randomUUID()}`
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database, { createDeviceId: () => 'device-token-audit' })
    await repository.getOrCreateDeviceId()
    const secureStorage = {
      setItem: vi.fn(async () => undefined),
      getItem: vi.fn(async () => 'indexeddb-forbidden-token'),
      removeItem: vi.fn(async () => undefined),
    }
    const storage = createSessionTokenStorage({
      isNativePlatform: () => true,
      secureStorage,
      webStorage: sessionStorage,
      allowWebFallback: false,
    })

    await storage.save('indexeddb-forbidden-token', 'https://gateway-a.example')
    const persistedRows = await Promise.all(database.tables.map((table) => table.toArray()))

    expect(JSON.stringify(persistedRows)).not.toContain('indexeddb-forbidden-token')
    database.close()
    await Dexie.delete(databaseName)
  })
})
