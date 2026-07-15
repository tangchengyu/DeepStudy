<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="closeModal">
      <section class="modal-card settings-card" role="dialog" aria-modal="true" aria-labelledby="planner-settings-title">
    <div class="settings-heading">
      <div>
        <div class="eyebrow">AI MODEL</div>
        <h2 id="planner-settings-title">AI 计划助手设置</h2>
        <p>仅使用 API 模型，支持 OpenAI 兼容接口。</p>
      </div>
      <button id="planner-settings-close" class="icon-btn compact" type="button" @click="closeModal" aria-label="关闭设置">×</button>
    </div>

    <button id="free-api-tutorial" class="tutorial-button" type="button">
      免费 API 配置教程
    </button>

    <div id="api-settings" class="settings-panel">
      <p class="settings-help">支持 OpenAI 兼容接口，例如 OpenRouter、OpenAI、DeepSeek、通义千问及自建服务。</p>
      <div class="saved-profile-row">
        <label>已保存的 API<select id="api-profile-select"><option value="">选择已保存 API</option></select></label>
        <button id="api-profile-new" class="secondary-btn" type="button">新建 API 配置</button>
        <button id="api-profile-delete" class="secondary-btn danger-lite" type="button" disabled>删除此 API</button>
      </div>
      <div id="api-saved-credential" class="saved-credential" hidden>
        <span>此配置的凭据已安全保存，可直接使用</span>
        <button id="api-key-change" class="reflection-action edit" type="button">更换 API Key</button>
      </div>
      <label>配置名称<input id="api-profile-name" maxlength="60" placeholder="例如：工作用 DeepSeek" /></label>
      <label>常用模型<select id="api-model-preset"><option value="custom">自定义模型</option></select></label>
      <label>API Base URL<input id="api-base-url" type="url" spellcheck="false" placeholder="https://api.openai.com/v1" /></label>
      <label>模型名称<input id="api-model" spellcheck="false" placeholder="例如 gpt-4.1-mini" /></label>
      <label id="api-key-entry">API Key<input id="api-key" type="password" autocomplete="off" placeholder="输入 API Key" /></label>
    </div>

    <div id="planner-settings-status" class="settings-status" role="status"></div>
    <div class="modal-actions">
      <button id="planner-settings-cancel" class="secondary-btn" type="button">取消</button>
      <button id="planner-settings-save" class="primary-btn" type="button">保存并使用</button>
    </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { api } from '@/api'

defineProps({
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:visible'])

function closeModal() {
  emit('update:visible', false)
}

// We'll implement the actual API config logic in a real implementation
// For now, this is just the UI shell
</script>

<style scoped>
.settings-card {
  width: min(640px, 100%);
  max-height: min(700px, calc(100vh - 40px));
  overflow: auto;
  padding: 24px;
  border-color: var(--border);
  background: var(--surface);
  box-shadow: 0 10px 30px rgba(50, 68, 59, 0.12);
}

.settings-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.settings-heading h2 {
  margin-top: 3px;
}

.provider-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 20px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-3);
}

.provider-switch label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 42px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.provider-switch label:has(input:checked) {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 3px 12px rgba(44, 62, 56, 0.08);
}

.provider-switch input,
.saved-key input {
  accent-color: var(--accent);
}

.settings-panel {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.tutorial-button {
  width: 100%;
  min-height: 48px;
  margin-top: 18px;
  padding: 12px 16px;
  border: 0;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, var(--accent), #2f8f7b);
  color: white;
  box-shadow: 0 4px 14px rgba(72, 111, 93, 0.12);
  cursor: pointer;
  font-size: 14px;
  font-weight: 850;
}

.tutorial-button:hover {
  box-shadow: 0 5px 16px rgba(72, 111, 93, 0.14);
}

.saved-profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: end;
  gap: 10px;
}

.saved-profile-row > label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.danger-lite {
  min-width: 110px;
  border-color: rgba(191, 76, 76, 0.28);
  color: var(--red-hover);
}

.danger-lite:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.settings-panel > label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.settings-panel input:not([type="checkbox"]) {
  width: 100%;
  height: 42px;
  padding: 0 11px;
  color: var(--text);
  font-weight: 400;
}

.settings-panel select {
  width: 100%;
  height: 42px;
  padding: 0 11px;
  color: var(--text);
  font-weight: 400;
  cursor: pointer;
}

.settings-help {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.saved-credential {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(72, 168, 142, 0.28);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 12px;
}

.settings-panel .saved-key {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 8px;
  font-weight: 400;
}

.settings-status {
  min-height: 20px;
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.settings-status.error {
  color: var(--red-hover);
}

.settings-status.success {
  color: var(--accent-hover);
}

@media (max-width: 520px) {
  .provider-switch {
    grid-template-columns: 1fr;
  }
  .settings-card {
    padding: 18px;
  }
  .saved-profile-row {
    grid-template-columns: 1fr;
  }
}
</style>
