import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useRuntimeStore = defineStore('runtime', () => {
  const alwaysOnTop = ref(false)
  const currentMode = ref('focus')
  const showGate = ref(true)
  const showPlannerSettings = ref(false)
  const showSoulModal = ref(false)
  const showDistractionModal = ref(false)
  const showResetConfirm = ref(false)
  const focusDuration = ref(25 * 60 * 1000)

  function setAlwaysOnTop(value) {
    alwaysOnTop.value = value
  }

  function setMode(mode) {
    currentMode.value = mode
  }

  function enterGate() {
    showGate.value = true
  }

  function exitGate() {
    showGate.value = false
  }

  function openPlannerSettings() {
    showPlannerSettings.value = true
  }

  function closePlannerSettings() {
    showPlannerSettings.value = false
  }

  function openSoulModal() {
    showSoulModal.value = true
  }

  function closeSoulModal() {
    showSoulModal.value = false
  }

  function openDistractionModal() {
    showDistractionModal.value = true
  }

  function closeDistractionModal() {
    showDistractionModal.value = false
  }

  function openResetConfirm() {
    showResetConfirm.value = true
  }

  function closeResetConfirm() {
    showResetConfirm.value = false
  }

  function setFocusDuration(ms) {
    focusDuration.value = ms
  }

  return {
    alwaysOnTop, currentMode, showGate,
    showPlannerSettings, showSoulModal, showDistractionModal, showResetConfirm,
    focusDuration,
    setAlwaysOnTop, setMode, enterGate, exitGate,
    openPlannerSettings, closePlannerSettings,
    openSoulModal, closeSoulModal,
    openDistractionModal, closeDistractionModal,
    openResetConfirm, closeResetConfirm,
    setFocusDuration
  }
})
