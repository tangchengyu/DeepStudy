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
    onIdentityChanged?: (identity: { origin: string; userId: string } | null) => void | Promise<void>
  } = {},
) {
  const state = reactive<AuthState>({
    status: 'loading',
    user: null,
    pendingRecoveryCode: null,
    recoveryReason: null,
    error: null,
  })

  async function rememberUser(user: GatewayUser) {
    const origin = options.getScope?.() ?? ''
    await options.onIdentityChanged?.({ origin, userId: user.id })
    state.user = user
    state.status = 'signed-in'
    const writes = [
      metadata.setMetadata('accountUserId', user.id),
      metadata.setMetadata('accountUsername', userName(user)),
    ]
    if (options.getScope) writes.push(metadata.setMetadata('accountOrigin', origin))
    await Promise.all(writes)
  }

  async function applySignInResult(result: SignInResult) {
    await rememberUser(result.user)
    return result
  }

  return {
    state,
    async initialize() {
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
        await options.onIdentityChanged?.(null)
      }
      if (options.getScope && (!cachedId || !scopeMatches)) {
        await options.onIdentityChanged?.(null)
        state.user = null
        state.status = 'signed-out'
        state.error = null
        return state
      }
      try {
        const session = await client.session()
        await rememberUser(session.user)
      } catch (error) {
        if (error instanceof GatewayError && error.status === 401) {
          state.user = null
          state.status = 'signed-out'
          await Promise.all([
            metadata.removeMetadata('accountUserId'),
            metadata.removeMetadata('accountUsername'),
            metadata.removeMetadata('accountOrigin'),
          ])
          await options.onIdentityChanged?.(null)
        } else if (cachedId && scopeMatches) {
          await options.onIdentityChanged?.({ origin: options.getScope?.() ?? '', userId: cachedId })
          state.user = { id: cachedId, username: cachedUsername }
          state.status = 'offline-session'
        } else {
          state.status = 'signed-out'
        }
        state.error = error instanceof Error ? error.message : String(error)
      }
      return state
    },
    async register(username: string, password: string, turnstileToken: string) {
      state.error = null
      const result = await client.register(username, password, turnstileToken) as RegistrationResult
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
        await options.onIdentityChanged?.(null)
        throw new Error('RECOVERY_CODE_MISSING')
      }
      state.pendingRecoveryCode = result.recoveryCode
      state.recoveryReason = 'new-account'
      await rememberUser(result.user)
      return result
    },
    async signIn(username: string, password: string, turnstileToken: string) {
      state.error = null
      return applySignInResult(await client.signIn(username, password, turnstileToken))
    },
    async recover(
      username: string,
      recoveryCode: string,
      newPassword: string,
      turnstileToken: string,
    ) {
      state.error = null
      const result = await client.recover(username, recoveryCode, newPassword, turnstileToken)
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
      try {
        await client.signOut()
      } finally {
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
        await options.onIdentityChanged?.(null)
      }
    },
  }
}

export type AuthCoordinator = ReturnType<typeof createAuthCoordinator>
