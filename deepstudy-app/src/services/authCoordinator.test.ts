import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAccountSyncScope,
  createSyncDatabase,
  createSyncRepository,
  LOCAL_QUARANTINE_SCOPE,
} from '../data/syncRepository'
import { createAuthCoordinator } from './authCoordinator'
import { GatewayError } from './gatewayClient'

const databases: string[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => Dexie.delete(name)))
})

describe('account authentication coordinator', () => {
  it('restores the cached account scope without waiting for remote session validation', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'cached-user')
    await repository.setMetadata('accountUsername', 'alice')
    await repository.setMetadata('accountOrigin', 'https://gateway.example.test')
    let resolveSession!: (value: { user: { id: string; username: string } }) => void
    const client = {
      register: vi.fn(), signIn: vi.fn(), recover: vi.fn(), signOut: vi.fn(),
      session: vi.fn(() => new Promise<{ user: { id: string; username: string } }>((resolve) => {
        resolveSession = resolve
      })),
    }
    const identities: Array<{ origin: string; userId: string } | null> = []
    const remoteRefreshes: Array<boolean | undefined> = []
    const coordinator = createAuthCoordinator(client, repository, {
      getScope: () => 'https://gateway.example.test',
      onIdentityChanged(identity, context) {
        identities.push(identity)
        remoteRefreshes.push(context?.refreshRemote)
      },
    })

    await coordinator.restoreCachedSession()

    expect(client.session).not.toHaveBeenCalled()
    expect(coordinator.state).toMatchObject({
      status: 'offline-session',
      user: { id: 'cached-user', username: 'alice' },
    })
    expect(identities).toEqual([{ origin: 'https://gateway.example.test', userId: 'cached-user' }])
    expect(remoteRefreshes).toEqual([false])

    const refresh = coordinator.refreshSession()
    await vi.waitFor(() => expect(client.session).toHaveBeenCalledTimes(1))
    resolveSession({ user: { id: 'cached-user', username: 'alice' } })
    await refresh
    expect(coordinator.state.status).toBe('signed-in')
    database.close()
  })

  it('ignores a late background session success after sign-out', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'cached-user')
    await repository.setMetadata('accountUsername', 'alice')
    await repository.setMetadata('accountOrigin', 'https://gateway.example.test')
    let resolveSession!: (value: { user: { id: string; username: string } }) => void
    const client = {
      register: vi.fn(), signIn: vi.fn(), recover: vi.fn(),
      signOut: vi.fn(async () => ({ success: true })),
      session: vi.fn(() => new Promise<{ user: { id: string; username: string } }>((resolve) => {
        resolveSession = resolve
      })),
    }
    const coordinator = createAuthCoordinator(client, repository, {
      getScope: () => 'https://gateway.example.test',
    })
    await coordinator.restoreCachedSession()
    const refresh = coordinator.refreshSession()
    await vi.waitFor(() => expect(client.session).toHaveBeenCalledTimes(1))

    await coordinator.signOut()
    resolveSession({ user: { id: 'cached-user', username: 'alice' } })
    await refresh

    expect(coordinator.state.status).toBe('signed-out')
    expect(coordinator.state.user).toBeNull()
    await expect(repository.getMetadata('accountUserId')).resolves.toBeNull()
    database.close()
  })

  it('ignores a late background session success after another account signs in', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'old-user')
    await repository.setMetadata('accountUsername', 'alice')
    await repository.setMetadata('accountOrigin', 'https://gateway.example.test')
    let resolveSession!: (value: { user: { id: string; username: string } }) => void
    const client = {
      register: vi.fn(), recover: vi.fn(), signOut: vi.fn(),
      signIn: vi.fn(async () => ({ user: { id: 'new-user', username: 'bob' } })),
      session: vi.fn(() => new Promise<{ user: { id: string; username: string } }>((resolve) => {
        resolveSession = resolve
      })),
    }
    const coordinator = createAuthCoordinator(client, repository, {
      getScope: () => 'https://gateway.example.test',
    })
    await coordinator.restoreCachedSession()
    const refresh = coordinator.refreshSession()
    await vi.waitFor(() => expect(client.session).toHaveBeenCalledTimes(1))

    await coordinator.signIn('bob', 'password', 'challenge')
    resolveSession({ user: { id: 'old-user', username: 'alice' } })
    await refresh

    expect(coordinator.state).toMatchObject({
      status: 'signed-in',
      user: { id: 'new-user', username: 'bob' },
    })
    await expect(repository.getMetadata('accountUserId')).resolves.toBe('new-user')
    database.close()
  })

  it('does not bind a late session response to a newly selected gateway origin', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'old-user')
    await repository.setMetadata('accountUsername', 'alice')
    await repository.setMetadata('accountOrigin', 'https://old.example.test')
    let origin = 'https://old.example.test'
    let resolveSession!: (value: { user: { id: string; username: string } }) => void
    const identities: Array<{ origin: string; userId: string } | null> = []
    const client = {
      register: vi.fn(), signIn: vi.fn(), recover: vi.fn(), signOut: vi.fn(),
      session: vi.fn(() => new Promise<{ user: { id: string; username: string } }>((resolve) => {
        resolveSession = resolve
      })),
    }
    const coordinator = createAuthCoordinator(client, repository, {
      getScope: () => origin,
      onIdentityChanged(identity) {
        identities.push(identity)
      },
    })
    await coordinator.restoreCachedSession()
    const refresh = coordinator.refreshSession()
    await vi.waitFor(() => expect(client.session).toHaveBeenCalledTimes(1))

    origin = 'https://new.example.test'
    resolveSession({ user: { id: 'old-user', username: 'alice' } })
    await refresh

    expect(identities).toEqual([{ origin: 'https://old.example.test', userId: 'old-user' }])
    await expect(repository.getMetadata('accountOrigin')).resolves.toBe('https://old.example.test')
    expect(coordinator.state.status).toBe('offline-session')
    database.close()
  })

  it('keeps the one-time recovery code in memory until the user confirms it is saved', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    const client = {
      register: vi.fn(async () => ({
        user: { id: 'user-1', username: 'alice' },
        recoveryCode: 'ABCD-EFGH-JKLM-NPQR',
      })),
      signIn: vi.fn(),
      recover: vi.fn(),
      session: vi.fn(),
      signOut: vi.fn(),
    }
    const coordinator = createAuthCoordinator(client, repository)

    await coordinator.register('alice', 'long-enough-password', 'turnstile-token')

    expect(coordinator.state.pendingRecoveryCode).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(coordinator.confirmRecoveryCodeSaved(false)).toBe(false)
    expect(coordinator.state.pendingRecoveryCode).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(coordinator.confirmRecoveryCodeSaved(true)).toBe(true)
    expect(coordinator.state.pendingRecoveryCode).toBeNull()
    expect(localStorage.getItem('deepstudy.recoveryCode')).toBeNull()
    expect(await repository.getMetadata('recoveryCode')).toBeNull()
    database.close()
  })

  it('requires confirmation for the rotated recovery code after password recovery', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    const client = {
      register: vi.fn(),
      signIn: vi.fn(),
      recover: vi.fn(async () => ({ ok: true as const, recoveryCode: 'WXYZ-2345-6789-BCDF' })),
      session: vi.fn(),
      signOut: vi.fn(),
    }
    const coordinator = createAuthCoordinator(client, repository)

    await coordinator.recover('alice', 'OLD1-OLD2-OLD3-OLD4', 'new-secure-password', 'challenge')

    expect(coordinator.state.pendingRecoveryCode).toBe('WXYZ-2345-6789-BCDF')
    expect(coordinator.state.recoveryReason).toBe('rotated')
    database.close()
  })

  it('clears the local account state even when the remote sign-out request is offline', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'user-1')
    await repository.setMetadata('accountUsername', 'alice')
    const client = {
      register: vi.fn(),
      signIn: vi.fn(),
      recover: vi.fn(),
      session: vi.fn(async () => ({ user: { id: 'user-1', username: 'alice' } })),
      signOut: vi.fn(async () => { throw new TypeError('offline') }),
    }
    const coordinator = createAuthCoordinator(client, repository)
    await coordinator.initialize()

    await expect(coordinator.signOut()).rejects.toThrow('offline')

    expect(coordinator.state.status).toBe('signed-out')
    expect(coordinator.state.user).toBeNull()
    await expect(repository.getMetadata('accountUserId')).resolves.toBeNull()
    database.close()
  })

  it('does not treat an explicitly rejected bearer token as an offline session', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'expired-user')
    await repository.setMetadata('accountUsername', 'alice')
    const client = {
      register: vi.fn(),
      signIn: vi.fn(),
      recover: vi.fn(),
      session: vi.fn(async () => { throw new GatewayError(401, 'UNAUTHORIZED', null) }),
      signOut: vi.fn(),
    }
    const coordinator = createAuthCoordinator(client, repository)

    await coordinator.initialize()

    expect(coordinator.state.status).toBe('signed-out')
    await expect(repository.getMetadata('accountUserId')).resolves.toBeNull()
    database.close()
  })

  it('does not enter signed-in state when registration has no recovery code', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    const client = {
      register: vi.fn(async () => ({ user: { id: 'unsafe-user', username: 'alice' } })),
      signIn: vi.fn(),
      recover: vi.fn(),
      session: vi.fn(),
      signOut: vi.fn(),
    }
    const coordinator = createAuthCoordinator(client as never, repository)

    await expect(coordinator.register('alice', 'long-enough-password', 'challenge')).rejects.toThrow(
      'RECOVERY_CODE_MISSING',
    )
    expect(coordinator.state.status).not.toBe('signed-in')
    expect(coordinator.state.user).toBeNull()
    await expect(repository.getMetadata('accountUserId')).resolves.toBeNull()
    database.close()
  })

  it('clears cached account metadata when the configured gateway origin changes', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database)
    await repository.setMetadata('accountUserId', 'old-user')
    await repository.setMetadata('accountUsername', 'alice')
    await repository.setMetadata('accountOrigin', 'https://old.example.test')
    const client = {
      register: vi.fn(), signIn: vi.fn(), recover: vi.fn(), signOut: vi.fn(),
      session: vi.fn(async () => { throw new TypeError('offline') }),
    }
    const coordinator = createAuthCoordinator(client, repository, {
      getScope: () => 'https://new.example.test',
    })

    await coordinator.initialize()

    expect(coordinator.state.status).toBe('signed-out')
    expect(client.session).not.toHaveBeenCalled()
    await expect(repository.getMetadata('accountUserId')).resolves.toBeNull()
    await expect(repository.getMetadata('accountOrigin')).resolves.toBeNull()
    database.close()
  })

  it('binds sign-in identity to a stable account scope and quarantines it on sign-out', async () => {
    const databaseName = `deepstudy-auth-${crypto.randomUUID()}`
    databases.push(databaseName)
    const database = createSyncDatabase(databaseName)
    const repository = createSyncRepository(database, {
      createMutationId: () => 'account-scoped-mutation',
    })
    const metadata = {
      getMetadata: repository.getGlobalMetadata,
      setMetadata: repository.setGlobalMetadata,
      removeMetadata: repository.removeGlobalMetadata,
    }
    const origin = 'https://gateway.example.test'
    const accountScope = createAccountSyncScope(origin, 'stable-user-id')
    const client = {
      register: vi.fn(), recover: vi.fn(), session: vi.fn(),
      signIn: vi.fn(async () => ({ user: { id: 'stable-user-id', username: 'alice' } })),
      signOut: vi.fn(async () => ({ success: true })),
    }
    const coordinator = createAuthCoordinator(client, metadata, {
      getScope: () => origin,
      onIdentityChanged(identity) {
        repository.setActiveScope(identity
          ? createAccountSyncScope(identity.origin, identity.userId)
          : LOCAL_QUARANTINE_SCOPE)
      },
    })

    await coordinator.signIn('alice', 'password', 'challenge')
    expect(repository.getActiveScope()).toBe(accountScope)
    await repository.enqueueUpsert('long_task', 'account-only', { title: '账号私有任务' })
    expect(await repository.getGlobalMetadata('accountUserId')).toBe('stable-user-id')

    await coordinator.signOut()
    expect(repository.getActiveScope()).toBe(LOCAL_QUARANTINE_SCOPE)
    expect(await repository.getRecord('long_task', 'account-only')).toBeUndefined()

    repository.setActiveScope(accountScope)
    await expect(repository.getRecord('long_task', 'account-only')).resolves.toMatchObject({
      payload: { title: '账号私有任务' },
    })
    database.close()
  })
})
