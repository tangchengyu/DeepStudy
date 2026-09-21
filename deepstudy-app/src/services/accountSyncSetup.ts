import type { SyncRepository } from '../data/syncRepository'
import type { SyncService } from './syncService'

export async function enableAccountSyncWhenReady(repository: SyncRepository, sync: Pick<SyncService, 'start'>) {
  const scope = repository.getActiveScope()
  const status = await repository.getMetadata('importStatus')
  repository.assertActiveScope(scope)
  if (status !== 'committed' && status !== 'skipped') {
    const local = await repository.previewLocalQuarantineImport()
    repository.assertActiveScope(scope)
    if (local.total > 0) return false
    await repository.setMetadata('importStatus', 'skipped')
  }
  repository.assertActiveScope(scope)
  sync.start()
  return true
}
