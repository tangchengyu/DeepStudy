<template>
  <Teleport to="body">
    <div v-if="visible" id="reset-confirm-overlay" class="modal-overlay" @click.self="close">
      <div id="reset-confirm-card" class="modal-card">
        <div class="settings-heading">
          <h2>确认重置</h2>
        </div>
        <p class="reset-confirm-text">确定要清除所有今日计划吗？此操作不可撤销。</p>
        <div class="modal-actions">
          <button class="secondary-btn" type="button" @click="close">取消</button>
          <button class="danger-btn" type="button" @click="confirm">确认重置</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false }
})
const emit = defineEmits(['confirm', 'cancel', 'update:visible'])
function close() { emit('update:visible', false) }
function confirm() { emit('confirm'); emit('update:visible', false) }
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(50, 68, 59, 0.34);
  backdrop-filter: blur(2px);
}
.modal-card {
  max-width: 420px;
  width: 90%;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 10px 30px rgba(50, 68, 59, 0.12);
}
.settings-heading { margin-bottom: 16px; }
.reset-confirm-text {
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 20px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
