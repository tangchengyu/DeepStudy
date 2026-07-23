[简体中文](#简体中文) · [English](#english)

# DeepStudy Android

## 简体中文

DeepStudy Android 是 DeepStudy 的手机端客户端，采用 Vue 3、Capacitor 和本地 IndexedDB 构建。界面使用已确认的五栏底部导航：今日、长期、中间专注、习惯、我的。

### 当前功能

- 今日任务：创建、重命名、优先级、排序、完成/重开和删除。
- 长期任务：四象限总览，进入象限列表，再进入任务详情；支持多行备注、计划时间、完成/重开、移动象限和删除。
- 离线优先：本地修改先进入持久化 outbox，恢复网络后再同步。
- 旧数据兼容：保留旧任务 ID、未知字段、多行备注和 `plannedAt`。
- 账号安全：原生 Android 使用系统安全存储保存会话令牌；Android 备份已关闭，避免令牌进入设备备份。
- 冲突与计时器：同步冲突需要用户明确选择；另一设备正在计时时，必须点击“接管并继续”。

### 本地开发与验证

需要 Node.js 22+、Android Studio 和可用的 Android SDK。

```bash
npm ci
npm test -- --run
npm run build
npm run cap:sync
```

用 Android Studio 打开 `android/` 后可以运行或生成 APK。仓库工作流 `.github/workflows/android-pilot.yml` 会为 `android-v*` 标签构建试点 Debug APK。

真实账号服务地址和密钥不应提交到 GitHub。客户端只保存网关 URL 和受保护的会话凭据，不保存用户明文密码。

## English

DeepStudy Android is the mobile client for DeepStudy, built with Vue 3, Capacitor, and a local IndexedDB store. It uses the approved five-tab navigation: Today, Long, a centered Focus tab, Habit, and Mine.

### Current capabilities

- Today tasks: create, rename, prioritize, reorder, complete/reopen, and delete.
- Long tasks: four-quadrant overview, quadrant list, and task detail; supports multiline notes, planned time, completion/reopen, quadrant moves, and deletion.
- Offline-first writes through a durable outbox.
- Legacy compatibility for payload IDs, unknown fields, multiline notes, and `plannedAt`.
- Native Android sessions use OS-backed secure storage, and Android backups are disabled.
- Conflicts require an explicit choice; a timer owned by another device remains read-only until the user taps “Take over and continue”.

### Local development and verification

Node.js 22+, Android Studio, and an Android SDK are required.

```bash
npm ci
npm test -- --run
npm run build
npm run cap:sync
```

Open `android/` in Android Studio to run the app or generate an APK. The repository workflow `.github/workflows/android-pilot.yml` builds a pilot Debug APK for `android-v*` tags.

Never commit real gateway secrets or credentials. The client stores only the gateway URL and protected session material, not plaintext user passwords.
