import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http from '@/api/http'

export const useAudioStore = defineStore('audio', () => {
  const defaultTracks = ref([
    { id: 'muyu', name: '木鱼白噪音', kind: 'default' },
    { id: 'rain', name: '雨声白噪音', kind: 'default' }
  ])
  const customTracks = ref([])
  const activeTrackId = ref(null)
  const volume = ref(0.7)
  const lastVolume = ref(0.7)
  const playbackRate = ref(1)
  const loading = ref(false)

  const allTracks = computed(() => [...defaultTracks.value, ...customTracks.value])

  let activeAudio = null

  async function loadNoiseTracks() {
    loading.value = true
    try {
      const data = await http.get('/audio/tracks')
      customTracks.value = Array.isArray(data) ? data : []
    } catch (e) {
      customTracks.value = []
    } finally {
      loading.value = false
    }
  }

  function playTrack(trackId) {
    stopAll()
    const track = allTracks.value.find(t => t.id === trackId)
    if (!track) return

    if (track.kind === 'default') {
      // Default tracks use bundled audio files (MP3)
      const src = track.id === 'muyu' ? '/assets/audio/muyu.mp3' : '/assets/audio/rain.mp3'
      activeAudio = new Audio(src)
      activeAudio.loop = true
    } else {
      // Custom tracks served from backend
      activeAudio = new Audio(`/api/audio/file/${encodeURIComponent(track.fileName)}`)
      activeAudio.loop = true
    }
    activeAudio.volume = volume.value
    activeAudio.playbackRate = playbackRate.value
    activeAudio.play().catch(e => console.warn('Audio play failed:', e))
    activeTrackId.value = trackId
  }

  function stopAll() {
    if (activeAudio) {
      activeAudio.pause()
      activeAudio.currentTime = 0
      activeAudio = null
    }
    activeTrackId.value = null
  }

  function toggleTrack(trackId) {
    if (activeTrackId.value === trackId) {
      stopAll()
    } else {
      playTrack(trackId)
    }
  }

  function setVolume(vol) {
    volume.value = vol
    if (activeAudio) activeAudio.volume = vol
  }

  function mute() {
    if (volume.value > 0) {
      lastVolume.value = volume.value
      setVolume(0)
    } else {
      setVolume(lastVolume.value || 0.7)
    }
  }

  function setPlaybackRate(rate) {
    playbackRate.value = rate
    if (activeAudio) activeAudio.playbackRate = rate
  }

  async function uploadCustomNoise(formData) {
    try {
      const saved = await http.post('/audio/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      customTracks.value.unshift(saved)
      return saved
    } catch (e) {
      console.error('Upload failed:', e)
      throw e
    }
  }

  async function deleteCustomNoise(id) {
    try {
      await http.delete(`/audio/${id}`)
      customTracks.value = customTracks.value.filter(t => t.id !== id)
      if (activeTrackId.value === id) stopAll()
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  return {
    defaultTracks, customTracks, activeTrackId, volume, lastVolume,
    playbackRate, loading, allTracks,
    loadNoiseTracks, playTrack, stopAll, toggleTrack,
    setVolume, mute, setPlaybackRate, uploadCustomNoise, deleteCustomNoise
  }
})
