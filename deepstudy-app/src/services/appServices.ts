import { sessionTokenStorage } from '../data/sessionTokenStorage'
import {
  createAccountSyncScope,
  LOCAL_QUARANTINE_SCOPE,
  syncRepository,
} from '../data/syncRepository'
import { createAuthCoordinator } from './authCoordinator'
import { createBrowserConnectivityMonitor } from './connectivity'
import { createGatewayClient } from './gatewayClient'
import { gatewaySettings } from './gatewaySettings'
import { createFocusTimerService } from './focusTimerService'
import { createSyncService } from './syncService'
import { enableAccountSyncWhenReady } from './accountSyncSetup'

export const gatewayClient = createGatewayClient({
  getBaseUrl: gatewaySettings.getBaseUrl,
  tokenStorage: sessionTokenStorage,
})

const accountMetadata = {
  getMetadata: syncRepository.getGlobalMetadata,
  setMetadata: syncRepository.setGlobalMetadata,
  removeMetadata: syncRepository.removeGlobalMetadata,
}

let timerServiceForScopeChange: ReturnType<typeof createFocusTimerService> | null = null
let syncServiceForScopeChange: ReturnType<typeof createSyncService> | null = null

export const accountCoordinator = createAuthCoordinator(gatewayClient, accountMetadata, {
  getScope: gatewaySettings.getBaseUrl,
  async onIdentityChanged(identity, context) {
    syncServiceForScopeChange?.stop()
    syncRepository.setActiveScope(identity
      ? createAccountSyncScope(identity.origin, identity.userId)
      : LOCAL_QUARANTINE_SCOPE)
    await timerServiceForScopeChange?.reloadScope(Boolean(identity) && context?.refreshRemote !== false)
    await syncServiceForScopeChange?.refreshState()
  },
})
export const connectivityMonitor = createBrowserConnectivityMonitor()
export const mobileFocusTimerService = createFocusTimerService({
  repository: syncRepository,
  client: gatewayClient,
  connectivity: connectivityMonitor,
})
timerServiceForScopeChange = mobileFocusTimerService
export const mobileSyncService = createSyncService({
  repository: syncRepository,
  client: gatewayClient,
  connectivity: connectivityMonitor,
})
syncServiceForScopeChange = mobileSyncService

interface AppServiceInitializerDependencies {
  account: {
    state: { status: string }
    restoreCachedSession(): Promise<unknown>
    refreshSession(): Promise<unknown>
  }
  timer: { initialize(): Promise<unknown> }
  sync: { refreshState(): Promise<unknown> }
  enableSync(): Promise<unknown>
}

function hasCachedAccount(status: string) {
  return status === 'signed-in' || status === 'offline-session'
}

export function createAppServiceInitializer(dependencies: AppServiceInitializerDependencies) {
  let initialization: Promise<void> | null = null
  let backgroundInitialization: Promise<void> | null = null

  function startBackground() {
    if (!backgroundInitialization) {
      backgroundInitialization = (async () => {
        await Promise.allSettled([
          dependencies.account.refreshSession(),
          dependencies.timer.initialize(),
        ])
        await dependencies.sync.refreshState()
        if (hasCachedAccount(dependencies.account.state.status)) {
          await dependencies.enableSync()
        }
      })()
    }
    return backgroundInitialization
  }

  return {
    initialize() {
      if (!initialization) {
        initialization = (async () => {
          await dependencies.account.restoreCachedSession()
          await dependencies.sync.refreshState()
          if (hasCachedAccount(dependencies.account.state.status)) {
            await dependencies.enableSync()
          }
          void startBackground().catch(() => undefined)
        })()
      }
      return initialization
    },
    waitForBackground() {
      return backgroundInitialization ?? Promise.resolve()
    },
  }
}

const appServiceInitializer = createAppServiceInitializer({
  account: accountCoordinator,
  timer: mobileFocusTimerService,
  sync: mobileSyncService,
  enableSync: () => enableAccountSyncWhenReady(syncRepository, mobileSyncService),
})

export function initializeAppServices() {
  return appServiceInitializer.initialize()
}
