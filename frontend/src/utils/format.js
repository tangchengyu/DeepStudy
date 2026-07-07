// 时间格式化工具 - 从原 app.js 迁移

export function formatClock(ms, hundredths = false) {
  const n = Math.max(0, ms)
  const total = Math.floor(n / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (v) => String(v).padStart(2, '0')
  return hundredths
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(Math.floor((n % 1000) / 10))}`
    : `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function formatMinutes(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

export function formatFlexibleClock(ms) {
  const value = formatClock(ms)
  return ms >= 3600000 ? value : value.slice(3)
}

export function todayKey(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 10)
}

export function createDateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(date)
}

export function formatDateTimeLabel(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

export function formatTimeLabel(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date))
}

export function formatDateShort(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric'
  }).format(new Date(date))
}
