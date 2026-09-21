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
  async onIdentityChanged(identity) {
    syncServiceForScopeChange?.stop()
    syncRepository.setActiveScope(identity
      ? createAccountSyncScope(identity.origin, identity.userId)
      : LOCAL_QUARANTINE_SCOPE)
    await timerServiceForScopeChange?.reloadScope(Boolean(identity))
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

let initialization: Promise<void> | null = null

export function initializeAppServices() {
  if (!initialization) {
    initialization = (async () => {
      await accountCoordinator.initialize()
      await mobileFocusTimerService.initialize()
      await mobileSyncService.refreshState()
      if (accountCoordinator.state.status === 'signed-in'
        || accountCoordinator.state.status === 'offline-session') {
        await enableAccountSyncWhenReady(syncRepository, mobileSyncService)
      }
    })()
  }
  return initialization
}
