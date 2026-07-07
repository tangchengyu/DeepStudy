import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/http'
import { todayKey } from '@/utils/format'

export const useFocusStore = defineStore('focus', () => {
  const activeSession = ref(null)
  const isRunning = ref(false)
  const isPaused = ref(false)
  const plannedMs = ref(25 * 60 * 1000)
  const elapsedMs = ref(0)
  const focusedMs = ref(0)
  const workType = ref('core') // 'core' | 'maintenance'
  const sessions = ref([])
  const loading = ref(false)

  let timerHandle = null
  let lastTick = 0

  const remainingMs = computed(() => Math.max(0, plannedMs.value - focusedMs.value))
  const progress = computed(() => plannedMs.value > 0 ? focusedMs.value / plannedMs.value : 0)
  const todayTotalMs = computed(() =>
    sessions.value.reduce((sum, s) => sum + (s.focusedMs || 0), 0)
  )

  async function fetchActiveSession() {
    try {
      const data = await http.get('/focus')
      if (Array.isArray(data) && data.length > 0) {
        activeSession.value = data[0]
        isRunning.value = true
      } else {
        activeSession.value = null
        isRunning.value = false
      }
    } catch (e) {
      activeSession.value = null
    }
  }

  async function fetchSessions(start, end) {
    loading.value = true
    try {
      const params = {}
      if (start) params.start = start
      if (end) params.end = end
      const data = await http.get('/focus/sessions', { params })
      sessions.value = Array.isArray(data) ? data : []
    } finally {
      loading.value = false
    }
  }

  async function startFocus(durationMs) {
    if (durationMs) plannedMs.value = durationMs
    const session = {
      plannedMs: plannedMs.value,
      type: workType.value,
      typesJson: JSON.stringify([workType.value])
    }
    try {
      const saved = await http.post('/focus/start', session)
      activeSession.value = saved
      isRunning.value = true
      isPaused.value = false
      focusedMs.value = 0
      startTicking()
      return saved
    } catch (e) {
      // Fallback: run locally without backend
      isRunning.value = true
      isPaused.value = false
      startTicking()
    }
  }

  async function pauseFocus() {
    if (!activeSession.value) {
      isPaused.value = true
      stopTicking()
      return
    }
    try {
      const saved = await http.patch(`/focus/pause/${activeSession.value.id}`)
      activeSession.value = saved
    } catch (e) {
      // ignore
    }
    isPaused.value = true
    stopTicking()
  }

  async function resumeFocus() {
    if (!activeSession.value) {
      isPaused.value = false
      startTicking()
      return
    }
    try {
      const saved = await http.patch(`/focus/resume/${activeSession.value.id}`)
      activeSession.value = saved
    } catch (e) {
      // ignore
    }
    isPaused.value = false
    startTicking()
  }

  async function stopFocus() {
    if (activeSession.value) {
      try {
        const saved = await http.patch(`/focus/stop/${activeSession.value.id}`)
        sessions.value.unshift(saved)
      } catch (e) {
        // ignore
      }
    }
    isRunning.value = false
    isPaused.value = false
    activeSession.value = null
    focusedMs.value = 0
    stopTicking()
  }

  function setWorkType(type) {
    workType.value = type
  }

  function setPlannedMs(ms) {
    plannedMs.value = ms
  }

  function startTicking() {
    stopTicking()
    lastTick = Date.now()
    timerHandle = setInterval(() => {
      const now = Date.now()
      const delta = now - lastTick
      lastTick = now
      if (!isPaused.value) {
        focusedMs.value += delta
        elapsedMs.value += delta
        if (plannedMs.value > 0 && focusedMs.value >= plannedMs.value) {
          stopFocus()
        }
      }
    }, 1000)
  }

  function stopTicking() {
    if (timerHandle) {
      clearInterval(timerHandle)
      timerHandle = null
    }
  }

  return {
    activeSession, isRunning, isPaused, plannedMs, elapsedMs, focusedMs,
    workType, sessions, loading,
    remainingMs, progress, todayTotalMs,
    fetchActiveSession, fetchSessions, startFocus, pauseFocus, resumeFocus,
    stopFocus, setWorkType, setPlannedMs
  }
})
