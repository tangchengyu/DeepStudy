export function useAudio() {
  let audioCtx = null
  let oscillator = null
  let gainNode = null

  // 简单提示音
  function alarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      ;[0, 0.3, 0.6].forEach((offset, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = i % 2 ? 660 : 880
        gain.gain.setValueAtTime(0.18, ctx.currentTime + offset)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18)
        osc.connect(gain).connect(ctx.destination)
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + 0.2)
      })
    } catch (e) {
      console.warn(e)
    }
  }

  // 提醒音
  function reminderSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const gain = ctx.createGain()
      gain.gain.value = 0.12
      gain.connect(ctx.destination)
      for (let offset = 0; offset < 3; offset += 0.5) {
        const osc = ctx.createOscillator()
        osc.frequency.value = offset % 1 ? 720 : 880
        osc.connect(gain)
        osc.start(ctx.currentTime + offset)
        osc.stop(ctx.currentTime + offset + 0.22)
      }
      setTimeout(() => ctx.close(), 3200)
    } catch (e) {
      console.warn(e)
    }
  }

  function cleanup() {
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
  }

  return { alarm, reminderSound, cleanup }
}