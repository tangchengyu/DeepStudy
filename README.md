# DeepStudy（Vue 版）

> **桌面端专注力管理工具** — 每日计划 · 专注计时 · 休息恢复 · 呼吸练习 · 白噪音 · 时间审计
>
> 本仓库为 Vue 3 + Spring Boot + Electron Shell 的现代化实现版本。

## 🚀 一键安装

| 系统 | 下载 | 说明 |
|------|------|------|
| **Windows** | [最新版 `.exe`](https://github.com/tangchengyu/DeepStudy/releases/latest) | 双击即用，便携版 |
| **macOS** | [最新版 `.dmg`](https://github.com/tangchengyu/DeepStudy/releases/latest) | 拖入 `/Applications` 即可 |

**Windows 用户**：下载 `deepstudy-*.exe` 到任意目录，双击启动。首次运行自动创建桌面快捷方式。

### 🤖 AI Agent 一键安装（Windows）

> **把这段发给 Codex / Claude Code / Cursor 等 AI 工具，它们会自动帮你下载安装：**

```text
请帮我在 Windows 上安装 DeepStudy。访问 https://github.com/tangchengyu/DeepStudy/releases/latest，
下载最新的 deepstudy-*.exe，保存到 %LOCALAPPDATA%\Programs\DeepStudy\deepstudy.exe，然后运行它。
```

或直接复制以下 PowerShell 命令执行：

```powershell
$repo="tangchengyu/DeepStudy"; $rel=Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$exe=$rel.assets|?{$_.name-like"deepstudy-*.exe"}|Select -First 1
$dir="$env:LOCALAPPDATA\Programs\DeepStudy"; New-Item -ItemType Directory -Force -Path $dir|Out-Null
Invoke-WebRequest $exe.browser_download_url -OutFile "$dir\deepstudy.exe"; Start-Process "$dir\deepstudy.exe"
```

---

[English](#english) | [简体中文](#简体中文)

DeepStudy is a desktop focus-management app for daily planning, focus sessions, rest recovery, long-term task tracking, white noise, and time review.

DeepStudy 是一款桌面端专注力管理软件，用于每日计划、专注计时、休息恢复、长期任务、白噪音和时间复盘。

## English

### What You Get

- Daily plan checklist with priority marking, quick add, reset, and reflection merge.
- Focus mode with a configurable timer, distraction capture, and keyboard shortcut support.
- Rest mode with guided breathing, recovery audio, and white-noise controls.
- Stopwatch and countdown timer windows.
- Long-term task board with four quadrants, reminders, completion, and move-to-today flow.
- Fast single-instance restore when the desktop shortcut is double-clicked while the app is already hidden or minimized.
- Responsive daily-plan layout that keeps the input, task list, clear/reset buttons, and AI assistant from overlapping in narrow docked windows.
- Local data storage, no account required.
- Windows portable executable and macOS DMG release workflow.

### Download and Install

1. Open the latest release:
   [https://github.com/tangchengyu/DeepStudy/releases/latest](https://github.com/tangchengyu/DeepStudy/releases/latest)
2. Download the file for your system:
   - Windows: `deepstudy-*.exe`
   - macOS: `deepstudy-*.dmg`
3. Install or run:
   - Windows: place the `.exe` in a stable folder such as `%LOCALAPPDATA%\Programs\DeepStudy\deepstudy.exe`, then double-click it. DeepStudy creates or repairs the desktop shortcut on first launch.
   - macOS: open the `.dmg`, drag `deepstudy.app` to `/Applications`, then open it. Because the package is unsigned, first launch may require **Control-click -> Open**.

### Agent-Friendly Install

Use this section when an automation agent needs to install DeepStudy on Windows.

```powershell
$release = Invoke-RestMethod "https://api.github.com/repos/tangchengyu/DeepStudy/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "deepstudy-*.exe" } | Select-Object -First 1
if (-not $asset) { throw "No Windows deepstudy-*.exe asset was found." }

$installDir = Join-Path $env:LOCALAPPDATA "Programs\DeepStudy"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir "deepstudy.exe"
Invoke-WebRequest $asset.browser_download_url -OutFile $target
Start-Process $target
```

Verify the executable and shortcut:

```powershell
Get-Item "$env:LOCALAPPDATA\Programs\DeepStudy\deepstudy.exe"
$shortcut = "$env:USERPROFILE\Desktop\DeepStudy.lnk"
if (Test-Path $shortcut) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  [pscustomobject]@{ Shortcut = $shortcut; Target = $s.TargetPath; WorkingDirectory = $s.WorkingDirectory }
}
```

### Run From Source

Requirements:

- Node.js 18 or newer
- Java 21 and Maven 3.9 or newer if you want to inspect the Spring Boot backend

Production Electron app:

```powershell
git clone https://github.com/tangchengyu/DeepStudy.git
cd DeepStudy
npm install
npm start
```

Validate:

```powershell
npm test
```

Build Windows portable executable:

```powershell
npm run pack:win
```

Build macOS DMG on macOS:

```bash
npm install
npm run pack:mac
```

The output is written to `dist/`.

### Vue and Spring Boot Workspace

This repository also contains a modernized implementation workspace:

- `frontend/`: Vue 3 + Vite + Element Plus + Pinia.
- `backend/`: Spring Boot 3.5 REST service with OpenAPI documentation, JPA entities, services, repositories, and global exception handling.
- `electron-shell/`: Electron shell that can load the Vue frontend and bundled backend jar.

Run the Vue frontend:

```powershell
cd frontend
npm install
npm run build
npm run dev
```

Run the backend:

```powershell
cd backend
mvn spring-boot:run
```

Open API documentation after the backend starts:

- Swagger UI: `http://localhost:8080/swagger-ui.html`
- OpenAPI JSON: `http://localhost:8080/api-docs`

The root Electron app remains the verified release entry because it preserves the original desktop behavior most closely. The Vue/Spring workspace is included for ongoing modernization and API inspection.

### Data Locations

DeepStudy stores data locally in Electron user-data locations:

| Platform | Typical location |
| --- | --- |
| Windows | `%APPDATA%\deepstudy\` |
| macOS | `~/Library/Application Support/deepstudy/` |
| Linux | `~/.config/deepstudy/` |

Important files include long-term tasks, planner settings, encrypted API profiles, and custom white-noise tracks.

### Release Workflow

The repository includes `.github/workflows/release.yml`.

To publish a release:

```powershell
git tag v1.2.5
git push origin main --tags
```

GitHub Actions builds:

- Windows: `dist/deepstudy-*.exe`
- macOS: `dist/deepstudy-*.dmg`

Both artifacts are uploaded to the GitHub Release for the tag.

### License

DeepStudy uses the **PolyForm Noncommercial License 1.0.0**. See [LICENSE](LICENSE).

The required notice is in [NOTICE](NOTICE).

## 简体中文

### 软件功能

- 每日计划清单：支持优先级、快速添加、重置和完成任务合并到复盘。
- 专注模式：可配置专注时长，支持干扰记录和快捷键。
- 休息模式：呼吸练习、恢复音频和白噪音控制。
- 独立秒表和倒计时窗口。
- 长期任务四象限看板：支持提醒、完成、移动到今日计划。
- 应用已隐藏或最小化时，再次双击桌面快捷方式会快速恢复已有窗口。
- 每日计划在窄屏或右侧停靠窗口中保持响应式排列，输入框、任务列表、清除/重置按钮和 AI 助手不会互相覆盖。
- 本地数据保存，不需要账号。
- 支持 Windows 便携版 `.exe`，并提供 macOS `.dmg` 的 GitHub Actions 发布流程。

### 下载安装

1. 打开最新发布页：
   [https://github.com/tangchengyu/DeepStudy/releases/latest](https://github.com/tangchengyu/DeepStudy/releases/latest)
2. 下载对应平台文件：
   - Windows：`deepstudy-*.exe`
   - macOS：`deepstudy-*.dmg`
3. 安装或运行：
   - Windows：建议把 `.exe` 放到稳定目录，例如 `%LOCALAPPDATA%\Programs\DeepStudy\deepstudy.exe`，然后双击运行。首次运行会自动创建或修复桌面快捷方式。
   - macOS：打开 `.dmg`，把 `deepstudy.app` 拖到 `/Applications`，再打开。由于当前包未签名，首次启动可能需要按住 Control 点击并选择“打开”。

### 给自动化 Agent 的 Windows 安装命令

```powershell
$release = Invoke-RestMethod "https://api.github.com/repos/tangchengyu/DeepStudy/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "deepstudy-*.exe" } | Select-Object -First 1
if (-not $asset) { throw "No Windows deepstudy-*.exe asset was found." }

$installDir = Join-Path $env:LOCALAPPDATA "Programs\DeepStudy"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir "deepstudy.exe"
Invoke-WebRequest $asset.browser_download_url -OutFile $target
Start-Process $target
```

验证可执行文件和桌面快捷方式：

```powershell
Get-Item "$env:LOCALAPPDATA\Programs\DeepStudy\deepstudy.exe"
$shortcut = "$env:USERPROFILE\Desktop\DeepStudy.lnk"
if (Test-Path $shortcut) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  [pscustomobject]@{ Shortcut = $shortcut; Target = $s.TargetPath; WorkingDirectory = $s.WorkingDirectory }
}
```

### 从源码运行

环境要求：

- Node.js 18 或更高版本
- 如果要查看 Spring Boot 后端，需要 Java 21 和 Maven 3.9 或更高版本

运行生产 Electron 应用：

```powershell
git clone https://github.com/tangchengyu/DeepStudy.git
cd DeepStudy
npm install
npm start
```

验证：

```powershell
npm test
```

打包 Windows 便携版：

```powershell
npm run pack:win
```

在 macOS 上打包 DMG：

```bash
npm install
npm run pack:mac
```

产物会输出到 `dist/`。

### Vue 和 Spring Boot 工作区

仓库同时包含现代化实现工作区：

- `frontend/`：Vue 3 + Vite + Element Plus + Pinia。
- `backend/`：Spring Boot 3.5 REST 服务，包含 OpenAPI 文档、JPA 实体、服务层、仓储层和全局异常处理。
- `electron-shell/`：可加载 Vue 前端和后端 jar 的 Electron 壳。

运行 Vue 前端：

```powershell
cd frontend
npm install
npm run build
npm run dev
```

运行后端：

```powershell
cd backend
mvn spring-boot:run
```

后端启动后可查看接口文档：

- Swagger UI：`http://localhost:8080/swagger-ui.html`
- OpenAPI JSON：`http://localhost:8080/api-docs`

根目录 Electron 应用仍然是已验证的发布入口，因为它最完整地保留了原桌面版的功能和界面。Vue/Spring 工作区作为后续现代化和接口检查源码一并保留。

### 本地数据位置

DeepStudy 使用 Electron 用户数据目录保存本地数据：

| 平台 | 常见位置 |
| --- | --- |
| Windows | `%APPDATA%\deepstudy\` |
| macOS | `~/Library/Application Support/deepstudy/` |
| Linux | `~/.config/deepstudy/` |

重要数据包括长期任务、计划设置、加密后的 API 配置和自定义白噪音。

### 发布流程

仓库包含 `.github/workflows/release.yml`。

发布新版本：

```powershell
git tag v1.2.5
git push origin main --tags
```

GitHub Actions 会构建：

- Windows：`dist/deepstudy-*.exe`
- macOS：`dist/deepstudy-*.dmg`

两个文件会上传到对应 tag 的 GitHub Release。

### 许可证

DeepStudy 使用 **PolyForm Noncommercial License 1.0.0** 授权，详见 [LICENSE](LICENSE)。

必要版权声明见 [NOTICE](NOTICE)。
