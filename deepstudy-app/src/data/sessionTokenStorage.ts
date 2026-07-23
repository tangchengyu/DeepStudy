import { SecureStorage, type SecureStoragePlugin } from '@aparajita/capacitor-secure-storage'
import { Capacitor } from '@capacitor/core'

const bearerTokenKeyPrefix = 'deepstudy.bearerToken.'
const legacyBearerTokenKey = 'deepstudy.bearerToken'

type NativeTokenStorage = Pick<SecureStoragePlugin, 'getItem' | 'removeItem' | 'setItem'>

export interface SessionTokenStorage {
  save(token: string, scope: string): Promise<void>
  read(scope: string): Promise<string | null>
  clear(scope: string): Promise<void>
}

interface SessionTokenStorageOptions {
  isNativePlatform: () => boolean
  secureStorage: NativeTokenStorage
  webStorage: Storage
  allowWebFallback: boolean
}

export function createSessionTokenStorage(
  options: SessionTokenStorageOptions = {
    isNativePlatform: () => Capacitor.isNativePlatform(),
    secureStorage: SecureStorage,
    webStorage: globalThis.sessionStorage,
    allowWebFallback: import.meta.env.DEV || import.meta.env.MODE === 'test',
  },
): SessionTokenStorage {
  const useNativeStorage = options.isNativePlatform()
  const scopedKey = (scope: string) => `${bearerTokenKeyPrefix}${encodeURIComponent(scope)}`

  return {
    async save(token, scope) {
      const key = scopedKey(scope)
      if (useNativeStorage) {
        await options.secureStorage.setItem(key, token)
        await options.secureStorage.removeItem(legacyBearerTokenKey).catch(() => undefined)
        return
      }
      if (!options.allowWebFallback) {
        throw new Error('Web token storage is disabled')
      }
      options.webStorage.setItem(key, token)
      options.webStorage.removeItem(legacyBearerTokenKey)
    },
    async read(scope) {
      const key = scopedKey(scope)
      if (useNativeStorage) {
        return options.secureStorage.getItem(key)
      }
      return options.allowWebFallback ? options.webStorage.getItem(key) : null
    },
    async clear(scope) {
      const key = scopedKey(scope)
      if (useNativeStorage) {
        await options.secureStorage.removeItem(key)
        await options.secureStorage.removeItem(legacyBearerTokenKey).catch(() => undefined)
        return
      }
      if (options.allowWebFallback) {
        options.webStorage.removeItem(key)
        options.webStorage.removeItem(legacyBearerTokenKey)
      }
    },
  }
}

export const sessionTokenStorage = createSessionTokenStorage()
