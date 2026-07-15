<template>
  <div class="mode-tabs">
    <button
      class="mode-tab"
      :class="{ active: modelValue === 'focus' }"
      type="button"
      @click="$emit('update:modelValue', 'focus')"
    >
      <span class="mode-tab-icon" aria-hidden="true">◉</span>
      <span>专注模式</span>
    </button>
    <button
      class="mode-tab"
      :class="{ active: modelValue === 'rest' }"
      type="button"
      @click="$emit('update:modelValue', 'rest')"
    >
      <span class="mode-tab-icon" aria-hidden="true">☕</span>
      <span>休息模式</span>
    </button>
    <button
      class="mode-tab"
      :class="{ active: modelValue === 'habit' }"
      type="button"
      @click="$emit('update:modelValue', 'habit')"
      title="【习惯形成依赖稳定情境线索与重复行为绑定，持续记录能提高行为自动化的概率。】"
    >
      <span class="mode-tab-icon" aria-hidden="true">↗</span>
      <span>长期习惯构建</span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  modelValue: {
    type: String,
    default: 'focus'
  }
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.mode-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  min-width: 0;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 15px;
  background: rgba(255, 253, 249, 0.8);
  overflow: hidden;
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-width: 0;
  height: 42px;
  padding: 0 18px;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-weight: 700;
  white-space: nowrap;
}

.mode-tab:last-child {
  border-right: 0;
}

.mode-tab.active {
  border-right-color: transparent;
  border-radius: 12px;
  background: linear-gradient(180deg, #7db7a4, var(--accent));
  color: white;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.mode-tab-icon {
  font-size: 18px;
  line-height: 1;
}

@media (max-width: 620px) {
  .mode-tabs {
    width: 100%;
    padding: 3px;
  }

  .mode-tab {
    gap: 5px;
    height: 34px;
    padding: 0 7px;
    font-size: 12px;
  }

  .mode-tab-icon {
    font-size: 14px;
  }
}
</style>
