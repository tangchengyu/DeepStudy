import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'

export const useTimerStore = defineStore('timer', () => {
  const stopwatchRunning = ref(false)
  const stopwatchElapsed = ref(0)
  const lapTimes = ref([])
  const countdownRunning = ref(false)
  const countdownPaused = ref(false)
  const countdownRemaining = ref(0)
  const countdownInitial = ref(0)
  const countdownPreset = ref(60)

  const displayStopwatch = computed(() => formatTimespan(stopwatchElapsed.value, true))
  const displayCountdown = computed(() => formatTimespan(countdownRemaining.value, false))

  let stopwatchRAF = null
  let stopwatchStart = 0
  let countdownInterval = null

  function formatTimespan(ms, showHundredths) {
    const n = Math.max(0, ms)
    const total = Math.floor(n / 1000)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (v) => String(v).padStart(2, '0')
    if (showHundredths) {
      return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(Math.floor((n % 1000) / 10))}`
    }
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }

  function startStopwatch() {
    if (stopwatchRunning.value) return
    stopwatchRunning.value = true
    if (stopwatchElapsed.value === 0) {
      stopwatchStart = Date.now()
    } else {
      stopwatchStart = Date.now() - stopwatchElapsed.value
    }
    function tick() {
      if (!stopwatchRunning.value) return
      stopwatchElapsed.value = Date.now() - stopwatchStart
      stopwatchRAF = requestAnimationFrame(tick)
    }
    tick()
  }

  function stopStopwatch() {
    stopwatchRunning.value = false
    if (stopwatchRAF) {
      cancelAnimationFrame(stopwatchRAF)
      stopwatchRAF = null
    }
  }

  function resetStopwatch() {
    stopStopwatch()
    stopwatchElapsed.value = 0
    lapTimes.value = []
  }

  function lapStopwatch() {
    if (!stopwatchRunning.value) return
    const prevTotal = lapTimes.value.reduce((sum, l) => sum + l.duration, 0)
    lapTimes.value.push({
      index: lapTimes.value.length + 1,
      duration: stopwatchElapsed.value - prevTotal,
      total: stopwatchElapsed.value
    })
  }

  function startCountdown(seconds) {
    if (countdownRunning.value) return
    countdownRunning.value = true
    countdownPaused.value = false
    if (seconds) {
      countdownInitial.value = seconds * 1000
      countdownRemaining.value = seconds * 1000
    } else {
      countdownRemaining.value = countdownInitial.value
    }
    const startTime = Date.now()
    countdownInterval = setInterval(() => {
      if (!countdownPaused.value) {
        const elapsed = Date.now() - startTime - (
          countdownPaused.value ? 0 : 0
        )
        // Recalc properly
        countdownRemaining.value = countdownInitial.value - (Date.now() - startTime)
        if (countdownRemaining.value <= 0) {
          countdownRemaining.value = 0
          stopCountdown()
        }
      }
    }, 100)
  }

  function pauseCountdown() {
    countdownPaused.value = !countdownPaused.value
    if (!countdownPaused.value) {
      // Resume recalc
    }
  }

  function resetCountdown() {
    countdownRunning.value = false
    countdownPaused.value = false
    countdownRemaining.value = countdownInitial.value
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  function stopCountdown() {
    countdownRunning.value = false
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  function setCountdownPreset(seconds) {
    countdownPreset.value = seconds
    countdownInitial.value = seconds * 1000
    countdownRemaining.value = seconds * 1000
  }

  return {
    stopwatchRunning, stopwatchElapsed, lapTimes, displayStopwatch,
    countdownRunning, countdownPaused, countdownRemaining, countdownInitial,
    countdownPreset, displayCountdown,
    startStopwatch, stopStopwatch, resetStopwatch, lapStopwatch,
    startCountdown, pauseCountdown, resetCountdown, stopCountdown,
    setCountdownPreset
  }
})
