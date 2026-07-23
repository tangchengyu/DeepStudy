<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AuthPanel from '../components/AuthPanel.vue'
import ConflictList from '../components/ConflictList.vue'
import RecoveryCodePanel from '../components/RecoveryCodePanel.vue'
import { syncRepository, type LocalImportPreview, type SyncConflictRecord } from '../data/syncRepository'
import { sessionTokenStorage } from '../data/sessionTokenStorage'
import {
  accountCoordinator,
  gatewayClient,
  initializeAppServices,
  mobileSyncService,
} from '../services/appServices'
import { GatewayError } from '../services/gatewayClient'
import { gatewaySettings } from '../services/gatewaySettings'
import { switchGatewayOrigin } from '../services/gatewaySwitch'

const gatewayUrl = ref(gatewaySettings.getBaseUrl())
const gatewayMessage = ref<string | null>(null)
const siteKey = ref('')
const minimumPasswordLength = ref(10)
const deviceId = ref('读取中…')
const importStatus = ref('未开始')
const authVisible = ref(false)
const authBusy = ref(false)
const authError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const conflicts = ref<SyncConflictRecord[]>([])
const resolvingConflictId = ref<string | null>(null)
const localImportPreview = ref<LocalImportPreview | null>(null)
const importingLocalData = ref(false)

const account = accountCoordinator.state
const syncState = mobileSyncService.state
const signedIn = computed(() => account.status === 'signed-in' || account.status === 'offline-session')
const displayName = computed(() => account.user?.username || account.user?.name || 'DeepStudy 用户')
const syncLabel = computed(() => ({
  idle: syncState.lastSyncAt ? '已同步' : '等待首次同步',
  offline: '离线，修改会保留',
  syncing: '正在同步…',
  error: '同步失败',
})[syncState.phase])
const importStatusLabel = computed(() => ({
  blocked: '需重新预览',
  previewed: '待确认',
  applying: '导入中',
  committed: '已完成',
  skipped: '已跳过',
  '未开始': '未开始',
} as Record<string, string>)[importStatus.value] || importStatus.value)
const hasLocalImportChoices = computed(() => Boolean(
  localImportPreview.value
    && (localImportPreview.value.importable.length || localImportPreview.value.conflicts.length),
))

function formatTime(value: number | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value) : '尚未同步'
}

function friendlyError(error: unknown) {
  if (error instanceof GatewayError) {
    return ({
      GATEWAY_NOT_CONFIGURED: '请先填写网关地址',
      INVALID_CREDENTIALS: '用户名或密码不正确',
      INVALID_RECOVERY_CODE: '恢复码无效或已使用',
      TURNSTILE_REJECTED: '安全验证已过期，请重新验证',
      RATE_LIMITED: '尝试次数过多，请稍后再试',
      UNAUTHENTICATED: '登录已失效，请重新登录',
    } as Record<string, string>)[error.code] || `请求失败：${error.code}`
  }
  if (error instanceof Error && error.message === 'OFFLINE') return '当前离线，冲突与待上传数据仍保留在本机'
  if (error instanceof Error) {
    const conflictMessage = ({
      CONFLICT_RESOLVED_DIFFERENTLY: '云端已按另一种方式解决。本机修改仍保留，请重新比较两个版本。',
      CONFLICT_RESOLUTION_DIRECTION_UNKNOWN: '无法确认云端采用了哪个版本。本机修改仍保留，请稍后重试。',
      CONFLICT_REMOTE_STATE_MISMATCH: '当前云端版本与冲突时不同。本机修改仍保留，请重新比较。',
      CONFLICT_RESOLUTION_RECOVERY_PENDING: '云端结果尚未确认。本机修改仍保留，请稍后重试。',
    } as Record<string, string>)[error.message]
    if (conflictMessage) return conflictMessage
  }
  return error instanceof Error ? error.message : String(error)
}

async function loadGatewayConfig() {
  if (!gatewaySettings.getBaseUrl()) {
    siteKey.value = ''
    return
  }
  try {
    const config = await gatewayClient.config()
    siteKey.value = config.turnstileSiteKey
    minimumPasswordLength.value = config.minimumPasswordLength
    gatewayMessage.value = '网关连接正常'
  } catch (error) {
    siteKey.value = ''
    gatewayMessage.value = friendlyError(error)
  }
}

async function loadDashboard() {
  await initializeAppServices()
  const [resolvedDeviceId, savedImportStatus] = await Promise.all([
    syncRepository.getOrCreateDeviceId(),
    syncRepository.getMetadata('importStatus'),
  ])
  deviceId.value = resolvedDeviceId
  importStatus.value = savedImportStatus || '未开始'
  localImportPreview.value = signedIn.value ? await syncRepository.previewLocalQuarantineImport() : null
  conflicts.value = await syncRepository.listConflicts()
  await loadGatewayConfig()
}

async function refreshLocalImportPreview() {
  localImportPreview.value = signedIn.value ? await syncRepository.previewLocalQuarantineImport() : null
  if (localImportPreview.value?.importable.length) {
    importStatus.value = 'previewed'
    await syncRepository.setMetadata('importStatus', 'previewed')
  }
}

async function saveGateway() {
  gatewayMessage.value = null
  try {
    const result = await switchGatewayOrigin({
      nextUrl: gatewayUrl.value,
      settings: gatewaySettings,
      account: accountCoordinator,
      sync: mobileSyncService,
      tokenStorage: sessionTokenStorage,
      confirm: (message) => window.confirm(message),
    })
    gatewayUrl.value = result.baseUrl
    if (!result.changed) {
      gatewayMessage.value = '网关地址未改变'
      return
    }
    gatewayMessage.value = gatewayUrl.value ? '已保存，正在检查…' : '已恢复构建默认值'
    await loadGatewayConfig()
  } catch (error) {
    gatewayMessage.value = friendlyError(error)
  }
}

function openAuth() {
  authError.value = null
  if (!gatewaySettings.getBaseUrl()) {
    gatewayMessage.value = '请先填写并保存网关地址'
    return
  }
  authVisible.value = true
  if (!siteKey.value) void loadGatewayConfig()
}

async function afterSignIn() {
  authVisible.value = false
  await refreshLocalImportPreview()
  if (localImportPreview.value?.importable.length) {
    actionMessage.value = '发现旧本机数据，请先确认是否导入到当前账号。'
    return
  }
  mobileSyncService.start()
  actionMessage.value = '登录成功，本机数据保持不变并开始同步'
  await mobileSyncService.syncNow()
  conflicts.value = await syncRepository.listConflicts()
}

async function importLocalData() {
  if (importingLocalData.value) return
  importingLocalData.value = true
  actionMessage.value = null
  try {
    await syncRepository.setMetadata('importStatus', 'applying')
    importStatus.value = 'applying'
    const result = await syncRepository.importLocalQuarantineRecords()
    await refreshLocalImportPreview()
    importStatus.value = 'committed'
    mobileSyncService.start()
    await mobileSyncService.syncNow()
    conflicts.value = await syncRepository.listConflicts()
    actionMessage.value = `已导入 ${result.imported} 条旧本机数据并开始同步。`
  } catch (error) {
    importStatus.value = 'blocked'
    actionMessage.value = friendlyError(error)
  } finally {
    importingLocalData.value = false
  }
}

async function skipLocalImport() {
  await syncRepository.setMetadata('importStatus', 'skipped')
  importStatus.value = 'skipped'
  localImportPreview.value = null
  mobileSyncService.start()
  try {
    await mobileSyncService.syncNow()
    conflicts.value = await syncRepository.listConflicts()
    actionMessage.value = '已跳过旧本机数据导入，并开始同步当前账号数据。'
  } catch (error) {
    actionMessage.value = friendlyError(error)
  }
}

async function signIn(value: { username: string; password: string; turnstileToken: string }) {
  authBusy.value = true
  authError.value = null
  try {
    await accountCoordinator.signIn(value.username, value.password, value.turnstileToken)
    await afterSignIn()
  } catch (error) {
    authError.value = friendlyError(error)
  } finally {
    authBusy.value = false
  }
}

async function register(value: { username: string; password: string; turnstileToken: string }) {
  authBusy.value = true
  authError.value = null
  try {
    await accountCoordinator.register(value.username, value.password, value.turnstileToken)
  } catch (error) {
    authError.value = friendlyError(error)
  } finally {
    authBusy.value = false
  }
}

async function recover(value: {
  username: string
  recoveryCode: string
  newPassword: string
  turnstileToken: string
}) {
  authBusy.value = true
  authError.value = null
  try {
    await accountCoordinator.recover(
      value.username,
      value.recoveryCode,
      value.newPassword,
      value.turnstileToken,
    )
  } catch (error) {
    authError.value = friendlyError(error)
  } finally {
    authBusy.value = false
  }
}

async function confirmRecoveryCode() {
  const reason = account.recoveryReason
  if (!accountCoordinator.confirmRecoveryCodeSaved(true)) return
  if (reason === 'new-account') {
    try {
      await afterSignIn()
    } catch (error) {
      actionMessage.value = `恢复码已确认；${friendlyError(error)}`
    }
  } else {
    authVisible.value = true
    authError.value = '新恢复码已确认，请使用新密码登录'
  }
}

async function manualSync() {
  actionMessage.value = null
  try {
    await mobileSyncService.syncNow()
    conflicts.value = await syncRepository.listConflicts()
    actionMessage.value = '同步完成'
  } catch (error) {
    actionMessage.value = friendlyError(error)
  }
}

async function resolveConflict(id: string, resolution: 'keep_local' | 'keep_remote') {
  if (resolution === 'keep_remote' && !window.confirm(
    '保留云端版本会放弃这条记录尚未上传的本机修改，确认继续吗？',
  )) return
  resolvingConflictId.value = id
  actionMessage.value = null
  try {
    await mobileSyncService.resolveConflict(id, resolution)
    await mobileSyncService.syncNow()
    conflicts.value = await syncRepository.listConflicts()
    actionMessage.value = resolution === 'keep_local' ? '已保留本机版本并完成同步' : '已采用云端版本'
  } catch (error) {
    actionMessage.value = friendlyError(error)
  } finally {
    resolvingConflictId.value = null
  }
}

async function signOut() {
  mobileSyncService.stop()
  try {
    await accountCoordinator.signOut()
    actionMessage.value = '已退出账号；设备上的任务仍安全保留'
  } catch {
    actionMessage.value = '已退出本机；服务器会话将在下次联网后过期'
  }
}

onMounted(() => {
  void loadDashboard().catch((error) => {
    actionMessage.value = friendlyError(error)
  })
})

watch(() => syncState.conflicts, () => {
  void syncRepository.listConflicts().then((items) => {
    conflicts.value = items
  })
})
</script>

<template>
  <main class="page mine-page">
    <div
      class="mine-content"
      :inert="authVisible || Boolean(account.pendingRecoveryCode && account.recoveryReason) || undefined"
      :aria-hidden="authVisible || Boolean(account.pendingRecoveryCode && account.recoveryReason) || undefined"
    >
      <header class="screen-heading">
        <h1>我的</h1>
        <p>账号只保存登录凭据；任务继续本地优先，联网后再同步。</p>
      </header>

      <section class="profile-card surface-card">
      <div class="profile-avatar" aria-hidden="true">{{ signedIn ? displayName.slice(0, 1).toUpperCase() : '本' }}</div>
      <div class="profile-copy">
        <h2>{{ signedIn ? displayName : '本机模式' }}</h2>
        <p v-if="account.status === 'offline-session'">账号已保存，当前离线</p>
        <p v-else>{{ signedIn ? '已连接账号，支持多端同步' : '登录后可连接手机与电脑' }}</p>
      </div>
      <span class="connection-dot" :class="{ online: syncState.online }" :title="syncState.online ? '在线' : '离线'" />
      </section>

      <section class="status-grid" aria-label="同步概览">
      <article>
        <span>同步状态</span>
        <strong>{{ syncLabel }}</strong>
      </article>
      <article>
        <span>待上传</span>
        <strong>{{ syncState.pending }}</strong>
      </article>
      <article>
        <span>冲突</span>
        <strong>{{ syncState.conflicts }}</strong>
      </article>
      <article>
        <span>旧数据导入</span>
        <strong>{{ importStatusLabel }}</strong>
      </article>
      </section>

      <section class="details-card surface-card" aria-label="设备与同步详情">
      <div><span>设备 ID</span><code>{{ deviceId }}</code></div>
      <div><span>最后同步</span><strong>{{ formatTime(syncState.lastSyncAt) }}</strong></div>
      <div><span>连接状态</span><strong>{{ syncState.online ? '在线' : '离线' }}</strong></div>
      </section>

      <section v-if="hasLocalImportChoices && localImportPreview" class="import-card surface-card" aria-label="旧本机数据导入">
      <div>
        <h2>导入旧本机数据</h2>
        <p>
          发现 {{ localImportPreview.importable.length }} 条可导入数据；
          {{ localImportPreview.duplicates.length }} 条已在账号中存在；
          {{ localImportPreview.conflicts.length }} 条需要稍后手动比较。
        </p>
      </div>
      <div class="import-actions">
        <button type="button" :disabled="importingLocalData" @click="importLocalData">
          {{ importingLocalData ? '导入中…' : '导入到当前账号' }}
        </button>
        <button type="button" class="secondary-button" :disabled="importingLocalData" @click="skipLocalImport">
          暂不导入并同步
        </button>
      </div>
      </section>

      <ConflictList
        v-if="conflicts.length"
        :conflicts="conflicts"
        :busy-id="resolvingConflictId"
        @resolve="resolveConflict"
      />

      <section class="gateway-card surface-card">
      <label for="gateway-url">同步网关</label>
      <p>这里只是公开服务地址，不是密钥。账号密码和令牌不会写入此设置。</p>
      <div class="gateway-row">
        <input id="gateway-url" v-model="gatewayUrl" type="url" inputmode="url" placeholder="https://sync.example.com">
        <button type="button" @click="saveGateway">保存</button>
      </div>
      <small v-if="gatewayMessage">{{ gatewayMessage }}</small>
      </section>

      <p v-if="actionMessage" class="action-message" role="status">{{ actionMessage }}</p>

      <section class="action-list" aria-label="账号与同步操作">
      <button v-if="!signedIn" type="button" @click="openAuth">
        <span>登录或注册</span><small>用户名与密码</small>
      </button>
      <template v-else>
        <button type="button" :disabled="syncState.phase === 'syncing'" @click="manualSync">
          <span>立即同步</span><small>{{ syncState.pending }} 项待上传</small>
        </button>
        <button type="button" @click="signOut"><span>退出账号</span><small>保留本机数据</small></button>
      </template>
      </section>
    </div>

    <div v-if="authVisible" class="overlay" tabindex="-1" @click.self="authVisible = false" @keydown.esc="authVisible = false">
      <AuthPanel
        :site-key="siteKey"
        :minimum-password-length="minimumPasswordLength"
        :busy="authBusy"
        :error="authError"
        @close="authVisible = false"
        @sign-in="signIn"
        @register="register"
        @recover="recover"
      />
    </div>

    <div v-if="account.pendingRecoveryCode && account.recoveryReason" class="overlay recovery-overlay">
      <RecoveryCodePanel
        :code="account.pendingRecoveryCode"
        :reason="account.recoveryReason"
        @confirmed="confirmRecoveryCode"
      />
    </div>
  </main>
</template>

<style scoped>
.mine-page {
  padding-bottom: 1rem;
}

.profile-card {
  align-items: center;
  display: flex;
  gap: 0.9rem;
}

.profile-avatar {
  align-items: center;
  background: #ebe8ff;
  border-radius: 1rem;
  color: var(--accent);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 1.25rem;
  font-weight: 800;
  height: 3.5rem;
  justify-content: center;
  width: 3.5rem;
}

.profile-copy {
  min-width: 0;
}

.profile-copy h2,
.profile-copy p {
  margin: 0;
}

.profile-copy h2 {
  font-size: 1.05rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-copy p {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.2rem;
}

.connection-dot {
  background: #c3c8d2;
  border: 3px solid var(--surface);
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--border-soft);
  height: 0.85rem;
  margin-left: auto;
  width: 0.85rem;
}

.connection-dot.online {
  background: #27ae60;
}

.status-grid {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0.9rem;
}

.status-grid article {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 5rem;
  padding: 0.85rem;
}

.status-grid span,
.details-card span {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.status-grid strong {
  font-size: 0.95rem;
}

.details-card,
.gateway-card,
.import-card {
  margin-top: 0.9rem;
}

.details-card div {
  align-items: flex-start;
  border-top: 1px solid var(--border-soft);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem 0;
}

.details-card div:first-child {
  border-top: 0;
  padding-top: 0;
}

.details-card div:last-child {
  padding-bottom: 0;
}

.details-card code,
.details-card strong {
  font-size: 0.78rem;
  max-width: 68%;
  overflow-wrap: anywhere;
  text-align: right;
}

.gateway-card label {
  font-size: 0.9rem;
  font-weight: 750;
}

.gateway-card p {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.5;
  margin: 0.3rem 0 0.75rem;
}

.gateway-row {
  display: flex;
  gap: 0.5rem;
}

.gateway-row input {
  background: #fafbfe;
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  min-height: 2.9rem;
  min-width: 0;
  padding: 0 0.75rem;
  width: 100%;
}

.gateway-row button {
  background: var(--accent);
  border: 0;
  border-radius: 0.75rem;
  color: #fff;
  flex: 0 0 auto;
  font-weight: 700;
  padding: 0 1rem;
}

.gateway-card small {
  color: var(--text-muted);
  display: block;
  margin-top: 0.55rem;
}

.import-card {
  display: grid;
  gap: 0.85rem;
}

.import-card h2,
.import-card p {
  margin: 0;
}

.import-card h2 {
  font-size: 1rem;
}

.import-card p {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.55;
  margin-top: 0.35rem;
}

.import-actions {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.import-actions button {
  background: var(--accent);
  border: 0;
  border-radius: 0.85rem;
  color: #fff;
  font-weight: 750;
  min-height: 2.75rem;
  padding: 0 0.75rem;
}

.import-actions .secondary-button {
  background: var(--surface-muted);
  color: var(--text-main);
}

.action-message {
  background: #eeecff;
  border-radius: 0.85rem;
  color: var(--accent-strong);
  font-size: 0.8rem;
  line-height: 1.45;
  margin: 0.9rem 0 0;
  padding: 0.75rem;
}

.action-list {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  margin-top: 0.9rem;
  overflow: hidden;
}

.action-list button {
  align-items: center;
  background: transparent;
  border: 0;
  border-top: 1px solid var(--border-soft);
  color: var(--text-main);
  display: flex;
  justify-content: space-between;
  min-height: 3.8rem;
  padding: 0 1rem;
  text-align: left;
  width: 100%;
}

.action-list button:first-child {
  border-top: 0;
}

.action-list button:disabled {
  opacity: 0.55;
}

.action-list small {
  color: var(--text-muted);
}

.overlay {
  background: rgb(18 25 42 / 45%);
  bottom: 0;
  display: flex;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 40;
}

.recovery-overlay {
  align-items: center;
  padding: max(1rem, env(safe-area-inset-top)) 0 max(1rem, env(safe-area-inset-bottom));
  z-index: 50;
}
</style>
