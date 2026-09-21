import { describe, expect, it } from 'vitest'
import { syncErrorMessage, syncStatusLabel } from './syncPresentation'

describe('mobile sync messages', () => {
  it('does not call pending or conflicted data synchronized', () => {
    const state = { phase: 'idle' as const, pending: 2, conflicts: 0, lastSyncAt: 100 }
    expect(syncStatusLabel(state)).toContain('待上传')
    expect(syncStatusLabel({ ...state, pending: 0, conflicts: 1 })).toContain('比较')
    expect(syncStatusLabel({ ...state, pending: 0 })).toBe('已同步')
  })
  it('explains server quotas without implying the local device has run out of space', () => {
    expect(syncErrorMessage('SYNC_DAILY_WRITE_LIMIT')).toContain('今日写入额度')
    expect(syncErrorMessage('SYNC_DAILY_READ_LIMIT')).toContain('今日读取额度')
    expect(syncErrorMessage('SYNC_STORAGE_LIMIT')).toContain('云端存储空间')
    expect(syncErrorMessage('SYNC_STORAGE_LIMIT')).toContain('本机')
    expect(syncErrorMessage('UNAUTHENTICATED')).toContain('重新登录')
    expect(syncErrorMessage('Failed to fetch')).toContain('网络')
  })
})
