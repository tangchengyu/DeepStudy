import type { AuthCoordinator } from './authCoordinator'
import type { SyncService } from './syncService'
import type { SessionTokenStorage } from '../data/sessionTokenStorage'
import { normalizeGatewayBaseUrl } from './gatewaySettings'

interface GatewaySettingsLike {
  getBaseUrl(): string
  setBaseUrl(value: string): string
}

export async function switchGatewayOrigin(options: {
  nextUrl: string
  settings: GatewaySettingsLike
  account: Pick<AuthCoordinator, 'signOut'>
  sync: Pick<SyncService, 'stop'>
  tokenStorage: Pick<SessionTokenStorage, 'clear'>
  confirm: (message: string) => boolean
}) {
  const currentUrl = options.settings.getBaseUrl()
  const nextUrl = normalizeGatewayBaseUrl(options.nextUrl)
  if (currentUrl === nextUrl) return { changed: false, baseUrl: currentUrl }

  if (currentUrl && !options.confirm(
    '切换同步网关会退出当前账号。设备上的任务与待同步数据会保留，确认继续吗？',
  )) {
    return { changed: false, baseUrl: currentUrl }
  }

  if (currentUrl) {
    options.sync.stop()
    try {
      await options.account.signOut()
    } catch {
      // signOut clears the local scoped token and account metadata in its finally block.
    }
  }
  await options.tokenStorage.clear(nextUrl)
  return { changed: true, baseUrl: options.settings.setBaseUrl(nextUrl) }
}
