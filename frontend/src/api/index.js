// API base URL - backend runs on 8080
const API_BASE = '/api'

export async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: '网络请求失败' }))
    throw new Error(err.message || err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Daily Plan
  getPlan: (date) => request(`/plans?${new URLSearchParams({ date }).toString()}`),
  addTask: (task) => request('/plans', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, task) => request(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(task) }),
  deleteTask: (id) => request(`/plans/${id}`, { method: 'DELETE' }),
  reorderTasks: (tasks) => request('/plans/reorder', { method: 'POST', body: JSON.stringify(tasks) }),
  clearCompleted: (date) => request('/plans/clear-completed', { method: 'POST', body: JSON.stringify({ date }) }),
  resetPlan: (date) => request(`/plans/reset?${new URLSearchParams({ date }).toString()}`),

  // Focus Session
  startFocus: (data) => request('/focus/start', { method: 'POST', body: JSON.stringify(data) }),
  pauseFocus: (id) => request(`/focus/pause/${id}`, { method: 'PATCH' }),
  resumeFocus: (id) => request(`/focus/resume/${id}`, { method: 'PATCH' }),
  stopFocus: (id) => request(`/focus/stop/${id}`, { method: 'PATCH' }),
  getActiveSession: () => request('/focus'),
  getSessions: (start, end) => request(`/focus/sessions?${new URLSearchParams({ start, end }).toString()}`),

  // Distraction
  getDistractions: (date) => request(`/distractions?${new URLSearchParams({ date }).toString()}`),
  addDistraction: (entry) => request('/distractions', { method: 'POST', body: JSON.stringify(entry) }),
  resolveDistraction: (id) => request(`/distractions/${id}/resolve`, { method: 'PATCH' }),
  deleteDistraction: (id) => request(`/distractions/${id}`, { method: 'DELETE' }),
  updateDistraction: (id, data) => request(`/distractions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getDistractionsRange: (start, end) => request(`/distractions/range?${new URLSearchParams({ start, end }).toString()}`),

  // Reflections
  getReflections: (date) => request(`/reflections?${new URLSearchParams({ date }).toString()}`),
  saveReflection: (data) => request('/reflections', { method: 'POST', body: JSON.stringify(data) }),
  updateReflection: (id, data) => request(`/reflections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReflection: (id) => request(`/reflections/${id}`, { method: 'DELETE' }),
  exportReflection: (id) => request(`/reflections/${id}/export`),
  getReflectionDates: () => request('/reflections/dates'),

  // Soul Quotes
  getRandomQuote: () => request('/quotes/random'),
  getAllQuotes: () => request('/quotes'),
  createQuote: (quote) => request('/quotes', { method: 'POST', body: JSON.stringify(quote) }),
  updateQuote: (id, data) => request(`/quotes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteQuote: (id) => request(`/quotes/${id}`, { method: 'DELETE' }),

  // Long Tasks
  getLongTasks: () => request('/long-tasks'),
  getAllLongTasks: () => request('/long-tasks/all'),
  createLongTask: (task) => request('/long-tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateLongTask: (id, task) => request(`/long-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(task) }),
  deleteLongTask: (id) => request(`/long-tasks/${id}`, { method: 'DELETE' }),
  reorderLongTasks: (tasks) => request('/long-tasks/reorder', { method: 'POST', body: JSON.stringify(tasks) }),
  completeLongTask: (id) => request(`/long-tasks/complete/${id}`, { method: 'POST' }),
  aiChat: (payload) => request('/long-tasks/ai-chat', { method: 'POST', body: JSON.stringify(payload) }),
  applyAiOps: (ops) => request('/long-tasks/ai-apply', { method: 'POST', body: JSON.stringify(ops) }),

  // AI Config
  getAiConfig: (scope) => request(`/ai/config?${new URLSearchParams({ scope: scope || 'planner' }).toString()}`),
  saveAiConfig: (scope, config) => request('/ai/config', { method: 'POST', body: JSON.stringify({ scope: scope || 'planner', ...config }) }),
  getAiProfiles: () => request('/ai/profiles'),
  deleteAiProfile: (id, scope) => request(`/ai/profiles/${id}?${new URLSearchParams({ scope: scope || 'planner' }).toString()}`, { method: 'DELETE' }),
  plannerChat: (payload) => request('/ai/planner', { method: 'POST', body: JSON.stringify(payload) }),

  // Audio / Noise
  getNoiseTracks: () => request('/audio/tracks'),
  uploadNoise: (formData) => request('/audio/upload', { method: 'POST', body: formData, headers: {} }),
  deleteNoise: (id) => request(`/audio/${id}`, { method: 'DELETE' }),
  getDefaultTracks: () => request('/audio/defaults'),
  getNoiseFile: (fileName) => request(`/audio/file/${encodeURIComponent(fileName)}`),

  // Time Audit
  getTimeAudit: (start, end) => request(`/time-audit?${new URLSearchParams({ start, end }).toString()}`),
  createAuditEntry: (entry) => request('/time-audit', { method: 'POST', body: JSON.stringify(entry) }),
  batchCreateAudit: (entries) => request('/time-audit/batch', { method: 'POST', body: JSON.stringify(entries) }),
  deleteAuditEntry: (id) => request(`/time-audit/${id}`, { method: 'DELETE' }),

  // Health
  health: () => request('/health')
}
