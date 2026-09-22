import { reactive } from 'vue'
import type { SyncRepository } from '../data/syncRepository'
import type { GatewayClient, GatewayUser, RegistrationResult, SignInResult } from './gatewayClient'
import { GatewayError } from './gatewayClient'

type AuthClient = Pick<GatewayClient, 'recover' | 'register' | 'session' | 'signIn' | 'signOut'>
type AccountMetadata = Pick<SyncRepository, 'getMetadata' | 'removeMetadata' | 'setMetadata'>

export interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in' | 'offline-session'
  user: GatewayUser | null
  pendingRecoveryCode: string | null
  recoveryReason: 'new-account' | 'rotated' | null
  error: string | null
}

function userName(user: GatewayUser) {
  return user.username || user.name || ''
}

export function createAuthCoordinator(
  client: AuthClient,
  metadata: AccountMetadata,
  options: {
    getScope?: () => string
    onIdentityChanged?: (
      identity: { origin: string; userId: string } | null,
      context?: { refreshRemote: boolean },
    ) => void | Promise<void>
  } = {},
) {
  const state = reactive<AuthState>({
    status: 'loading',
    user: null,
    pendingRecoveryCode: null,
    recoveryReason: null,
    error: null,
  })

  let authGeneration = 0

  function beginAuthOperation() {
    return {
      generation: ++authGeneration,
      origin: options.getScope?.() ?? '',
    }
  }

  function isCurrentAuthOperation(operation: { generation: number; origin: string }) {
    return operation.generation === authGeneration
      && operation.origin === (options.getScope?.() ?? '')
  }

  async function rememberUser(
    user: GatewayUser,
    operation = beginAuthOperation(),
  ) {
    if (!isCurrentAuthOperation(operation)) return false
    await options.onIdentityChanged?.(
      { origin: operation.origin, userId: user.id },
      { refreshRemote: true },
    )
    if (!isCurrentAuthOperation(operation)) return false
    state.user = user
    state.status = 'signed-in'
    const writes = [
      metadata.setMetadata('accountUserId', user.id),
      metadata.setMetadata('accountUsername', userName(user)),
    ]
    if (options.getScope) writes.push(metadata.setMetadata('accountOrigin', operation.origin))
    await Promise.all(writes)
    return true
  }

  async function applySignInResult(
    result: SignInResult,
    operation: { generation: number; origin: string },
  ) {
    await rememberUser(result.user, operation)
    return result
  }

  let cachedSessionRestoration: Promise<AuthState> | null = null

  function restoreCachedSession() {
    if (!cachedSessionRestoration) {
      cachedSessionRestoration = (async () => {
        const [cachedId, cachedUsername, cachedOrigin] = await Promise.all([
          metadata.getMetadata('accountUserId'),
          metadata.getMetadata('accountUsername'),
          metadata.getMetadata('accountOrigin'),
        ])
        const scopeMatches = !options.getScope || cachedOrigin === options.getScope()
        if (cachedId && !scopeMatches) {
          await Promise.all([
            metadata.removeMetadata('accountUserId'),
            metadata.removeMetadata('accountUsername'),
            metadata.removeMetadata('accountOrigin'),
          ])
          await options.onIdentityChanged?.(null, { refreshRemote: false })
          state.user = null
          state.status = 'signed-out'
          state.error = null
          return state
        }
        if (cachedId) {
          await options.onIdentityChanged?.(
            { origin: options.getScope?.() ?? '', userId: cachedId },
            { refreshRemote: false },
          )
          state.user = { id: cachedId, username: cachedUsername }
          state.status = 'offline-session'
          state.error = null
          return state
        }
        if (options.getScope) await options.onIdentityChanged?.(null, { refreshRemote: false })
        state.user = null
        state.status = 'signed-out'
        state.error = null
        return state
      })()
    }
    return cachedSessionRestoration
  }

  async function refreshSession() {
    await restoreCachedSession()
    if (options.getScope && state.status === 'signed-out') return state
    const operation = beginAuthOperation()
    const cachedId = state.user?.id ?? null
    const cachedUsername = state.user?.username ?? state.user?.name ?? null
    try {
      const session = await client.session()
      if (!isCurrentAuthOperation(operation)) return state
      await rememberUser(session.user, operation)
      if (!isCurrentAuthOperation(operation)) return state
      state.error = null
    } catch (error) {
      if (!isCurrentAuthOperation(operation)) return state
      if (error instanceof GatewayError && error.status === 401) {
        state.user = null
        state.status = 'signed-out'
        await Promise.all([
          metadata.removeMetadata('accountUserId'),
          metadata.removeMetadata('accountUsername'),
          metadata.removeMetadata('accountOrigin'),
        ])
        await options.onIdentityChanged?.(null, { refreshRemote: false })
      } else if (cachedId) {
        state.user = { id: cachedId, username: cachedUsername }
        state.status = 'offline-session'
      } else {
        state.status = 'signed-out'
      }
      state.error = error instanceof Error ? error.message : String(error)
    }
    return state
  }

  return {
    state,
    restoreCachedSession,
    refreshSession,
    async initialize() {
      await restoreCachedSession()
      return refreshSession()
    },
    async register(username: string, password: string, turnstileToken: string) {
      const operation = beginAuthOperation()
      state.error = null
      const result = await client.register(username, password, turnstileToken) as RegistrationResult
      if (!isCurrentAuthOperation(operation)) return result
      if (!result.recoveryCode?.trim()) {
        state.status = 'signed-out'
        state.user = null
        state.pendingRecoveryCode = null
        state.recoveryReason = null
        await Promise.all([
          metadata.removeMetadata('accountUserId'),
          metadata.removeMetadata('accountUsername'),
          metadata.removeMetadata('accountOrigin'),
        ])
        await options.onIdentityChanged?.(null, { refreshRemote: false })
        throw new Error('RECOVERY_CODE_MISSING')
      }
      state.pendingRecoveryCode = result.recoveryCode
      state.recoveryReason = 'new-account'
      await rememberUser(result.user, operation)
      return result
    },
    async signIn(username: string, password: string, turnstileToken: string) {
      const operation = beginAuthOperation()
      state.error = null
      return applySignInResult(
        await client.signIn(username, password, turnstileToken),
        operation,
      )
    },
    async recover(
      username: string,
      recoveryCode: string,
      newPassword: string,
      turnstileToken: string,
    ) {
      const operation = beginAuthOperation()
      state.error = null
      const result = await client.recover(username, recoveryCode, newPassword, turnstileToken)
      if (!isCurrentAuthOperation(operation)) return result
      state.pendingRecoveryCode = result.recoveryCode
      state.recoveryReason = 'rotated'
      return result
    },
    confirmRecoveryCodeSaved(confirmed: boolean) {
      if (!confirmed || !state.pendingRecoveryCode) return false
      state.pendingRecoveryCode = null
      state.recoveryReason = null
      return true
    },
    async signOut() {
      const operation = beginAuthOperation()
      try {
        await client.signOut()
      } finally {
        if (isCurrentAuthOperation(operation)) {
          state.status = 'signed-out'
          state.user = null
          state.pendingRecoveryCode = null
          state.recoveryReason = null
          state.error = null
          await Promise.all([
            metadata.removeMetadata('accountUserId'),
            metadata.removeMetadata('accountUsername'),
            metadata.removeMetadata('accountOrigin'),
          ])
          await options.onIdentityChanged?.(null, { refreshRemote: false })
        }
      }
    },
  }
}

export type AuthCoordinator = ReturnType<typeof createAuthCoordinator>
