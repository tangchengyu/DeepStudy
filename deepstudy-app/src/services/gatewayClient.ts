import type { SessionTokenStorage } from '../data/sessionTokenStorage'
import type {
  PendingMutation,
  SyncRecordEnvelope,
} from '../data/syncRepository'
import { normalizeGatewayBaseUrl } from './gatewaySettings'

export interface GatewayUser {
  id: string
  username?: string | null
  name?: string | null
}

export interface SignInResult {
  user: GatewayUser
}

export interface RegistrationResult extends SignInResult {
  recoveryCode: string
}

export interface RecoveryResult {
  ok: true
  recoveryCode: string
}

export type RemoteSyncRecord = Omit<SyncRecordEnvelope, 'key' | 'scopeKey'>

export interface PushAppliedResult {
  mutationId: string
  status: 'applied'
  revision: number
  serverUpdatedAt: number
}

export interface PushConflictResult {
  mutationId: string
  status: 'conflict'
  conflictId: string
  remote: RemoteSyncRecord | null
}

export type PushResult = PushAppliedResult | PushConflictResult

export interface RemoteConflict {
  id: string
  entityType: SyncRecordEnvelope['entityType']
  entityId: string
  local: RemoteSyncRecord
  remote: RemoteSyncRecord | null
  createdAt: number
}

export interface RemoteActiveTimer {
  mode: 'focus' | 'rest'
  ownerDeviceId: string
  status: 'running' | 'paused'
  leaseVersion: number
  targetEndAt: number | null
  remainingMs: number
  plannedMs: number
  sessionStartAt: number | null
  segmentStartAt: number | null
  accumulatedMs: number
  workType: 'core' | 'maintenance' | 'rest' | null
  updatedAt: number
}

export interface TimerClaimInput {
  mode: RemoteActiveTimer['mode']
  status: RemoteActiveTimer['status']
  expectedLeaseVersion: number
  targetEndAt: number | null
  remainingMs: number
  plannedMs: number
  sessionStartAt: number | null
  segmentStartAt: number | null
  accumulatedMs: number
  workType: RemoteActiveTimer['workType']
  takeover?: boolean
}

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details: unknown,
  ) {
    super(code)
    this.name = 'GatewayError'
  }
}

interface GatewayClientOptions {
  getBaseUrl: () => string
  tokenStorage: SessionTokenStorage
  fetchFn?: typeof fetch
  requestTimeoutMs?: number
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  authenticated?: boolean
  deviceId?: string
  requireAuthToken?: boolean
  validateAuthPayload?: (payload: unknown) => boolean
}

function normalizedBaseUrl(value: string) {
  if (!value.trim()) throw new GatewayError(0, 'GATEWAY_NOT_CONFIGURED', null)
  try {
    return normalizeGatewayBaseUrl(value)
  } catch {
    throw new GatewayError(0, 'INVALID_GATEWAY_URL', null)
  }
}

function mutationForWire(mutation: PendingMutation) {
  const { key: _key, scopeKey: _scopeKey, ...record } = mutation.record
  return {
    mutationId: mutation.mutationId,
    baseRevision: mutation.baseRevision,
    record,
  }
}

export function createGatewayClient(options: GatewayClientOptions) {
  const fetchFn = options.fetchFn ?? fetch
  const requestTimeoutMs = Math.max(1_000, Number(options.requestTimeoutMs) || 60_000)

  async function request<T>(path: string, requestOptions: RequestOptions = {}): Promise<T> {
    const baseUrl = normalizedBaseUrl(options.getBaseUrl())
    const headers = new Headers({ accept: 'application/json' })
    if (requestOptions.body) headers.set('content-type', 'application/json')
    if (requestOptions.authenticated) {
      const token = await options.tokenStorage.read(baseUrl)
      if (!token) throw new GatewayError(401, 'UNAUTHENTICATED', null)
      headers.set('authorization', `Bearer ${token}`)
    }
    if (requestOptions.deviceId) headers.set('x-device-id', requestOptions.deviceId)

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timeout = controller ? window.setTimeout(() => controller.abort(), requestTimeoutMs) : null
    let response: Response
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: requestOptions.method ?? 'GET',
        headers,
        body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
        signal: controller?.signal,
      })
    } catch (error) {
      if (controller?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new GatewayError(0, 'NETWORK_TIMEOUT', null)
      }
      throw error
    } finally {
      if (timeout) window.clearTimeout(timeout)
    }
    const responseType = response.headers.get('content-type') ?? ''
    const payload: unknown = responseType.includes('application/json')
      ? await response.json()
      : await response.text()
    if (!response.ok) {
      const errorCode = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP_${response.status}`
      throw new GatewayError(response.status, errorCode, payload)
    }
    const signedToken = response.headers.get('set-auth-token')
    if (requestOptions.validateAuthPayload && !requestOptions.validateAuthPayload(payload)) {
      await options.tokenStorage.clear(baseUrl)
      throw new GatewayError(502, 'RECOVERY_CODE_MISSING', null)
    }
    if (requestOptions.requireAuthToken && !signedToken) {
      await options.tokenStorage.clear(baseUrl)
      throw new GatewayError(502, 'AUTH_TOKEN_MISSING', null)
    }
    if (signedToken) await options.tokenStorage.save(signedToken, baseUrl)
    return payload as T
  }

  return {
    config() {
      return request<{ turnstileSiteKey: string; minimumPasswordLength: number }>('/v1/config')
    },
    register(username: string, password: string, turnstileToken: string) {
      return request<RegistrationResult>('/v1/auth/register', {
        method: 'POST',
        body: { username, password, turnstileToken },
        requireAuthToken: true,
        validateAuthPayload: (payload) => Boolean(
          payload && typeof payload === 'object'
          && typeof (payload as { recoveryCode?: unknown }).recoveryCode === 'string'
          && (payload as { recoveryCode: string }).recoveryCode.trim(),
        ),
      })
    },
    signIn(username: string, password: string, turnstileToken: string) {
      return request<SignInResult>('/v1/auth/sign-in', {
        method: 'POST',
        body: { username, password, turnstileToken },
        requireAuthToken: true,
      })
    },
    recover(username: string, recoveryCode: string, newPassword: string, turnstileToken: string) {
      return request<RecoveryResult>('/v1/auth/recover', {
        method: 'POST',
        body: { username, recoveryCode, newPassword, turnstileToken },
      })
    },
    session() {
      return request<{ user: GatewayUser }>('/v1/auth/session', { authenticated: true })
    },
    async signOut() {
      const baseUrl = normalizedBaseUrl(options.getBaseUrl())
      try {
        return await request<{ success?: boolean }>('/api/auth/sign-out', {
          method: 'POST',
          body: {},
          authenticated: true,
        })
      } finally {
        await options.tokenStorage.clear(baseUrl)
      }
    },
    registerDevice(deviceId: string, name: string, platform: string) {
      return request<{ ok: true }>('/v1/devices', {
        method: 'POST',
        body: { name, platform },
        authenticated: true,
        deviceId,
      })
    },
    push(deviceId: string, mutations: PendingMutation[]) {
      return request<{ results: PushResult[] }>('/v1/sync/push', {
        method: 'POST',
        body: { mutations: mutations.map(mutationForWire) },
        authenticated: true,
        deviceId,
      })
    },
    pull(deviceId: string, cursor: string | null, limit = 200) {
      const query = new URLSearchParams({ cursor: cursor ?? '0', limit: String(limit) })
      return request<{
        records: RemoteSyncRecord[]
        cursor: number
        hasMore: boolean
      }>(`/v1/sync/pull?${query}`, { authenticated: true, deviceId })
    },
    conflicts(deviceId: string) {
      return request<{ conflicts: RemoteConflict[] }>('/v1/sync/conflicts', {
        authenticated: true,
        deviceId,
      })
    },
    resolveConflict(
      deviceId: string,
      conflictId: string,
      resolution: {
        resolution: 'keep_remote'
        operationId: string
      } | {
        resolution: 'keep_local'
        operationId: string
        mutationId: string
        expectedRemoteRevision: number
      },
    ) {
      return request<{
        ok: true
        conflictId: string
        resolution: 'keep_local' | 'keep_remote'
        result?: PushAppliedResult
        idempotent?: boolean
      }>(`/v1/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: 'POST',
        body: resolution,
        authenticated: true,
        deviceId,
      })
    },
    getTimer(deviceId: string) {
      return request<{ timer: RemoteActiveTimer | null }>('/v1/timer', {
        authenticated: true,
        deviceId,
      })
    },
    claimTimer(deviceId: string, input: TimerClaimInput) {
      return request<{ timer: RemoteActiveTimer }>('/v1/timer/claim', {
        method: 'POST',
        body: { ...input },
        authenticated: true,
        deviceId,
      })
    },
    releaseTimer(deviceId: string, expectedLeaseVersion: number) {
      return request<{ timer: null }>('/v1/timer/release', {
        method: 'POST',
        body: { expectedLeaseVersion },
        authenticated: true,
        deviceId,
      })
    },
  }
}

export type GatewayClient = ReturnType<typeof createGatewayClient>
