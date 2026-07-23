import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGatewayClient } from './gatewayClient'

describe('gateway client', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('adds bearer and device headers without persisting the token in browser databases', async () => {
    const tokenStorage = {
      read: vi.fn(async (scope: string) => scope === 'https://gateway.example.test' ? 'secure-token' : null),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secure-token')
      expect(new Headers(init?.headers).get('x-device-id')).toBe('android-device-001')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createGatewayClient({
      getBaseUrl: () => 'https://gateway.example.test/',
      tokenStorage,
      fetchFn,
    })

    await expect(client.registerDevice('android-device-001', 'Pixel', 'android')).resolves.toEqual({
      ok: true,
    })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/devices',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(tokenStorage.read).toHaveBeenCalledWith('https://gateway.example.test')
    expect(localStorage.getItem('deepstudy.bearerToken')).toBeNull()
    expect(sessionStorage.getItem('deepstudy.bearerToken')).toBeNull()
  })

  it('captures a signed bearer response only through sessionTokenStorage', async () => {
    const tokenStorage = {
      read: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 'user-1', username: 'alice' },
      recoveryCode: 'ABCD-EFGH-JKLM-NPQR',
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-auth-token': 'signed-token',
      },
    }))
    const client = createGatewayClient({
      getBaseUrl: () => 'https://gateway.example.test',
      tokenStorage,
      fetchFn,
    })

    const result = await client.register('alice', 'long-enough-password', 'challenge-token')

    expect(result.recoveryCode).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(tokenStorage.save).toHaveBeenCalledWith('signed-token', 'https://gateway.example.test')
    expect(localStorage.length).toBe(0)
  })

  it('never sends a bearer from one normalized gateway origin to another', async () => {
    const tokens = new Map([['https://old.example.test', 'old-origin-token']])
    const tokenStorage = {
      read: vi.fn(async (scope: string) => tokens.get(scope) ?? null),
      save: vi.fn(async (token: string, scope: string) => { tokens.set(scope, token) }),
      clear: vi.fn(async (scope: string) => { tokens.delete(scope) }),
    }
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBeNull()
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createGatewayClient({
      getBaseUrl: () => 'https://new.example.test/path-that-must-normalize',
      tokenStorage,
      fetchFn,
    })

    await expect(client.session()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(tokenStorage.read).toHaveBeenCalledWith('https://new.example.test')
  })

  it('fails registration closed when the gateway omits the one-time recovery code', async () => {
    const tokenStorage = {
      read: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const client = createGatewayClient({
      getBaseUrl: () => 'https://gateway.example.test',
      tokenStorage,
      fetchFn: vi.fn(async () => new Response(JSON.stringify({
        user: { id: 'user-without-code', username: 'alice' },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-auth-token': 'must-not-be-saved',
        },
      })),
    })

    await expect(client.register('alice', 'long-enough-password', 'challenge')).rejects.toMatchObject({
      code: 'RECOVERY_CODE_MISSING',
    })
    expect(tokenStorage.save).not.toHaveBeenCalled()
    expect(tokenStorage.clear).toHaveBeenCalledWith('https://gateway.example.test')
  })

  it('keeps local scope keys off the wire and sends the stable conflict operation id', async () => {
    const bodies: unknown[] = []
    const client = createGatewayClient({
      getBaseUrl: () => 'https://gateway.example.test',
      tokenStorage: {
        read: async () => 'secure-token',
        save: async () => undefined,
        clear: async () => undefined,
      },
      fetchFn: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        if (String(input).endsWith('/v1/sync/push')) {
          return Response.json({ results: [] })
        }
        return Response.json({
          ok: true,
          conflictId: 'gateway-conflict',
          resolution: 'keep_remote',
          idempotent: true,
        })
      }),
    })
    const scopeKey = 'account:https%3A%2F%2Fgateway.example.test:user-1'

    await client.push('device-1', [{
      mutationId: 'mutation-1',
      recordKey: `${scopeKey}::long_task:task-1`,
      entityType: 'long_task',
      entityId: 'task-1',
      operation: 'upsert',
      baseRevision: 0,
      record: {
        key: `${scopeKey}::long_task:task-1`,
        scopeKey,
        entityType: 'long_task',
        entityId: 'task-1',
        payload: { title: '私有任务' },
        deleted: false,
        revision: 0,
        clientUpdatedAt: 1,
        serverUpdatedAt: null,
        deviceId: 'device-1',
      },
      createdAt: 1,
      state: 'pending',
      scopeKey,
    }])
    await client.resolveConflict('device-1', 'gateway-conflict', {
      resolution: 'keep_remote',
      operationId: 'stable-operation-1',
    })

    expect(JSON.stringify(bodies[0])).not.toContain('scopeKey')
    expect(JSON.stringify(bodies[0])).not.toContain('account:https')
    expect(bodies[1]).toEqual({ resolution: 'keep_remote', operationId: 'stable-operation-1' })
  })

  it('uses device-scoped timer GET, lease claim, explicit takeover, and release requests', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown; deviceId: string | null }> = []
    const remoteTimer = {
      mode: 'focus' as const,
      ownerDeviceId: 'device-2',
      status: 'running' as const,
      leaseVersion: 7,
      targetEndAt: 50_000,
      remainingMs: 40_000,
      plannedMs: 60_000,
      sessionStartAt: 10_000,
      segmentStartAt: 10_000,
      accumulatedMs: 0,
      workType: 'core' as const,
      updatedAt: 10_000,
    }
    const client = createGatewayClient({
      getBaseUrl: () => 'https://gateway.example.test',
      tokenStorage: {
        read: async () => 'secure-token',
        save: async () => undefined,
        clear: async () => undefined,
      },
      fetchFn: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          deviceId: new Headers(init?.headers).get('x-device-id'),
        })
        return Response.json({ timer: String(input).endsWith('/release') ? null : remoteTimer })
      }),
    })

    await client.getTimer('device-1')
    await client.claimTimer('device-1', {
      mode: 'focus',
      status: 'running',
      expectedLeaseVersion: 7,
      targetEndAt: 50_000,
      remainingMs: 40_000,
      plannedMs: 60_000,
      sessionStartAt: 10_000,
      segmentStartAt: 10_000,
      accumulatedMs: 0,
      workType: 'core',
      takeover: true,
    })
    await client.releaseTimer('device-1', 8)

    expect(requests).toEqual([
      {
        url: 'https://gateway.example.test/v1/timer',
        method: 'GET',
        body: undefined,
        deviceId: 'device-1',
      },
      {
        url: 'https://gateway.example.test/v1/timer/claim',
        method: 'POST',
        body: expect.objectContaining({ expectedLeaseVersion: 7, takeover: true }),
        deviceId: 'device-1',
      },
      {
        url: 'https://gateway.example.test/v1/timer/release',
        method: 'POST',
        body: { expectedLeaseVersion: 8 },
        deviceId: 'device-1',
      },
    ])
  })
})
