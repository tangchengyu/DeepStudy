import { ref } from 'vue'

export function useElectron() {
  const alwaysOnTop = ref(false)
  const bridge = typeof window !== 'undefined'
    ? (window.deepstudyShell || window.electronAPI || null)
    : null

  // Electron IPC bridge - works with both real Electron and browser fallback
  const getAlwaysOnTop = async () => {
    if (bridge?.getAlwaysOnTop) {
      alwaysOnTop.value = await bridge.getAlwaysOnTop()
    }
    return alwaysOnTop.value
  }

  const setAlwaysOnTopAsync = async (enabled) => {
    const current = await getAlwaysOnTop()
    if (bridge?.toggleAlwaysOnTop && current !== enabled) {
      alwaysOnTop.value = await bridge.toggleAlwaysOnTop()
      return alwaysOnTop.value
    }
    alwaysOnTop.value = enabled
    return enabled
  }

  const toggleAlwaysOnTop = async () => {
    if (bridge?.toggleAlwaysOnTop) {
      alwaysOnTop.value = await bridge.toggleAlwaysOnTop()
      return alwaysOnTop.value
    }
    alwaysOnTop.value = !alwaysOnTop.value
    return alwaysOnTop.value
  }

  const openTimerWindow = () => {
    // In Electron, open a new BrowserWindow
    // In browser, use router
    window.open('/#/timer', '_blank', 'width=400,height=600')
  }

  const openLongTasksWindow = () => {
    window.open('/#/long-tasks', '_blank', 'width=800,height=600')
  }

  const openDevTools = () => {}

  const closeWindow = () => {
    if (typeof window !== 'undefined') window.close()
  }

  const minimizeWindow = () => {}
  const autoMinimize = () => {
    if (bridge?.autoMinimize) {
      return bridge.autoMinimize()
    }
    return Promise.resolve()
  }
  const autoRestore = () => {
    if (bridge?.autoRestore) {
      return bridge.autoRestore()
    }
    return Promise.resolve()
  }
  const maximizeWindow = () => {}
  const isMaximized = () => Promise.resolve(false)
  const toggleMaximize = () => Promise.resolve()

  const readCustomNoise = (trackId) => {
    // In browser context, read from localStorage as fallback
    try {
      const data = localStorage.getItem(`noise_${trackId}`)
      return data ? JSON.parse(data) : null
    } catch (e) {
      return null
    }
  }

  const addCustomNoise = (track) => {
    try {
      const id = `noise_${Date.now()}`
      localStorage.setItem(id, JSON.stringify(track))
      return Promise.resolve({ id, ...track })
    } catch (e) {
      return Promise.resolve({ id: `noise_${Date.now()}`, ...track })
    }
  }

  const deleteCustomNoise = (trackId) => {
    try {
      localStorage.removeItem(trackId)
    } catch (e) { /* ignore */ }
    return Promise.resolve()
  }

  const listCustomNoise = () => {
    try {
      const tracks = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('noise_')) {
          tracks.push(JSON.parse(localStorage.getItem(key)))
        }
      }
      return Promise.resolve(tracks)
    } catch (e) {
      return Promise.resolve([])
    }
  }

  const saveDialog = (options) => {
    // Fallback: create a download link
    if (options?.defaultPath) {
      const blob = new Blob([''], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = options.defaultPath || 'export.txt'
      a.click()
      URL.revokeObjectURL(url)
    }
    return Promise.resolve(options?.defaultPath || '')
  }

  const openDialog = (options) => {
    // Fallback: create a file input
    return Promise.resolve([])
  }

  const messageBox = (options) => {
    // Fallback
    if (options?.type === 'question') {
      const result = confirm(options.message || '')
      return Promise.resolve({ response: result ? 0 : 1 })
    }
    alert(options?.message || '')
    return Promise.resolve({ response: 0 })
  }

  const beep = () => {
    // Play a simple beep using AudioContext
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 800
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.15)
    } catch (e) { /* ignore audio errors */ }
  }

  const getSystemInfo = () => Promise.resolve({
    platform: navigator.platform || 'unknown',
    userAgent: navigator.userAgent || 'unknown',
    language: navigator.language || 'zh-CN'
  })

  return {
    alwaysOnTop,
    getAlwaysOnTop,
    setAlwaysOnTop: setAlwaysOnTopAsync,
    toggleAlwaysOnTop,
    openTimerWindow,
    openLongTasksWindow,
    openDevTools,
    closeWindow,
    minimizeWindow,
    autoMinimize,
    autoRestore,
    maximizeWindow,
    isMaximized,
    toggleMaximize,
    readCustomNoise,
    addCustomNoise,
    deleteCustomNoise,
    listCustomNoise,
    saveDialog,
    openDialog,
    messageBox,
    beep,
    getSystemInfo
  }
}
