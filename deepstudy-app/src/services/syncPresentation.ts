import type { SyncState } from './syncService'

export function syncStatusLabel(state: Pick<SyncState, 'phase' | 'pending' | 'conflicts' | 'lastSyncAt'>) {
  if (state.phase === 'syncing') return '正在同步…'
  if (state.phase === 'offline') return '离线，已保存本机'
  if (state.phase === 'error') return '同步暂未完成'
  if (state.conflicts) return `${state.conflicts} 项需要比较`
  if (state.pending) return `${state.pending} 项待上传`
  return state.lastSyncAt ? '已同步' : '等待首次同步'
}

export function syncErrorMessage(code: string) {
  const messages: Record<string, string> = {
    SYNC_DAILY_READ_LIMIT: '同步服务今日读取额度已用完，额度恢复后会自动继续。任务和修改仍保存在本机。',
    SYNC_DAILY_WRITE_LIMIT: '同步服务今日写入额度已用完，额度恢复后会自动上传。任务和修改仍保存在本机。',
    SYNC_STORAGE_LIMIT: '云端存储空间不足，需要服务管理员清理空间或扩容。本机数据仍保留，处理后点击立即同步。',
    SYNC_REQUEST_QUERY_LIMIT: '这批数据暂时无法上传，请更新应用后重试。本机数据仍保留。',
    UNAUTHENTICATED: '登录已失效，请重新登录同一账号。本机待上传数据仍保留。',
    UNAUTHORIZED: '登录已失效，请重新登录同一账号。本机待上传数据仍保留。',
    NETWORK_TIMEOUT: '同步服务响应超时，请检查网络；本机修改已保存，稍后会自动重试。',
    OFFLINE: '当前离线，修改已保存在本机；联网后会自动同步。',
    RATE_LIMITED: '同步请求较多，稍后会自动继续。本机修改已保存。',
    PAYLOAD_TOO_LARGE: '这条数据超过同步大小限制，请缩小其中的图片或附件。本机内容仍保留。',
    BODY_TOO_LARGE: '这条数据超过同步大小限制，请缩小其中的图片或附件。本机内容仍保留。',
  }
  if (messages[code]) return messages[code]
  if (/fetch|network|load failed/i.test(code)) return '网络暂时不可用，请检查连接；本机修改已保存，稍后会自动重试。'
  return `同步暂未完成，本机数据仍保留。请稍后重试（${code}）。`
}
