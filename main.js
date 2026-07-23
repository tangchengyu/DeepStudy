const { app, BrowserWindow, ipcMain, dialog, safeStorage, Tray, Menu, Notification, nativeImage, powerMonitor, shell, net } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAppReadyRunner } = require("./renderer/app-lifecycle");
const {
  createCredentialStore,
  createDesktopSyncService,
  createLegacyBackupStore,
  createStateStore,
} = require("./renderer/desktop-sync-service");

const APP_USER_MODEL_ID = "com.deepstudy.focus";
const APP_DATA_DIR_NAME = "deepstudy";

const productionUserDataPath = path.join(app.getPath("appData"), APP_DATA_DIR_NAME);
const requestedTestUserData = cleanTestUserDataPath(
  process.env.DEEPSTUDY_TEST_USER_DATA,
  process.env.DEEPSTUDY_TEST_MODE,
  productionUserDataPath,
);
app.setPath("userData", requestedTestUserData || productionUserDataPath);

function cleanTestUserDataPath(value, testMode, productionPath) {
  if (!value) return "";
  if (testMode !== "1") throw new Error("DEEPSTUDY_TEST_USER_DATA requires DEEPSTUDY_TEST_MODE=1.");
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new Error("Refusing to use a filesystem root as test userData.");
  const temporaryRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(temporaryRoot, resolved);
  if (!relativeToTemp || relativeToTemp.startsWith("..") || path.isAbsolute(relativeToTemp)) {
    throw new Error("Test userData must be a descendant of the OS temporary directory.");
  }
  if (resolved.toLowerCase() === path.resolve(productionPath).toLowerCase()) {
    throw new Error("Refusing to use the production DeepStudy profile for a test.");
  }
  return resolved;
}

const syncUserDataPath = app.getPath("userData");
const syncCredentialStore = createCredentialStore({
  fs,
  filePath: path.join(syncUserDataPath, "sync-credentials.json"),
  safeStorage,
});
const syncStateStore = createStateStore({
  fs,
  filePath: path.join(syncUserDataPath, "sync-device.json"),
});
const legacyBackupStore = createLegacyBackupStore({
  fs,
  userDataPath: syncUserDataPath,
  longTasksFilePath: path.join(syncUserDataPath, "long-tasks.json"),
});
let syncContractPromise;
const desktopSyncService = createDesktopSyncService({
  fetch: (...args) => net.fetch(...args),
  credentialStore: syncCredentialStore,
  stateStore: syncStateStore,
  hashSnapshot: async (records) => {
    syncContractPromise ||= import("./packages/sync-contract/index.js");
    return (await syncContractPromise).snapshotHash(records);
  },
});

if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const gotTheLock = app.requestSingleInstanceLock();
const runWhenAppReady = createAppReadyRunner(app);

if (!gotTheLock) {
  app.exit(0);
  process.exit(0);
}

const {
  sanitizeChatHistory,
  upsertApiProfile,
} = require("./renderer/planner-utils");
const { dueTasks, extractJson, fallbackAiOperationsFromText, normalizeAiOperations, normalizeTask } = require("./renderer/long-task-utils");

const DEFAULT_PLANNER_SETTINGS = {
  mode: "api",
  api: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-120b:free" },
};
const FREE_API_TUTORIAL_URL = "https://my.feishu.cn/docx/Sr9RdRzFaop9BSxBgcAcdxDonOc";
const PLANNER_TIMEOUT_MS = 120000;
const PORTABLE_ICON_PATH = process.env.PORTABLE_EXECUTABLE_FILE
  ? path.join(path.dirname(process.env.PORTABLE_EXECUTABLE_FILE), "deepstudy.ico")
  : "";
const DIST_ICON_PATH = path.join(__dirname, "dist", "deepstudy.ico");
const APP_ICON_PATH = path.join(__dirname, "build", "deepstudy.ico");

let mainWindow;
let longTasksWindow;
let tray;
let quitting = false;
let dailyPlanSnapshot = { date: "", tasks: [] };
let pendingReminderIds = new Set();
let currentLongTaskDrag = null;
let _minimizedByCode = false;
const DEFAULT_WINDOW_WIDTH = 1180;
const DEFAULT_WINDOW_HEIGHT = 780;
const timerWindows = new Map(); // keyed by mode: "stopwatch" | "countdown"

function isTimerWindow(win) {
  for (const tw of timerWindows.values()) {
    if (tw === win) return true;
  }
  return false;
}

function windowIcon() {
  return [PORTABLE_ICON_PATH, DIST_ICON_PATH, APP_ICON_PATH].find((iconPath) => iconPath && fs.existsSync(iconPath));
}

function appIconImage(size = 16) {
  const iconPath = windowIcon();
  if (!iconPath) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: size, height: size });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 520,
    minHeight: 420,
    resizable: true,
    title: "DeepStudy",
    backgroundColor: "#f0f7f4",
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.control &&
      input.key.toLowerCase() === "d"
    ) {
      event.preventDefault();
      mainWindow.webContents.send("focus:open-distraction");
    }
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("resize", () => {
    // Guard: don't react when resize is triggered by autoMinimize
    if (_minimizedByCode) return;
    const [w, h] = mainWindow.getSize();
    const [minW, minH] = [mainWindow.getMinimumSize()[0], mainWindow.getMinimumSize()[1]];
    if (w > minW || h > minH) {
      mainWindow.webContents.send("window:minimized-changed", false);
    }
  });
  return mainWindow;
}

function showWhenReady(window, fallbackMs = 5000) {
  let shown = false;
  const show = () => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
  };
  window.once("ready-to-show", show);
  window.webContents.once("did-finish-load", () => setTimeout(show, 50));
  setTimeout(show, fallbackMs).unref?.();
}

function attachWindowLoadDiagnostics(window, label) {
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`${label} failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.warn(`${label} renderer exited: ${details.reason}`);
    if (!window.isDestroyed()) window.reload();
  });
}

function showMainWindow() {
  void bringMainWindowToFront().catch((error) => {
    console.warn("Unable to show the main window:", error);
  });
}

function bringMainWindowToFront() {
  return runWhenAppReady(() => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.moveTop?.();
    mainWindow.focus();
    return mainWindow;
  });
}

function trayImage(alerting = false) {
  const icon = appIconImage(16);
  if (!icon.isEmpty()) return icon;
  const color = alerting ? "%23e8888a" : "%235bb8a0";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="2" y="2" width="28" height="28" rx="8" fill="${color}"/><path d="M9 17l4 4 10-11" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml,${svg}`).resize({ width: 16, height: 16 });
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip("DeepStudy");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 DeepStudy", click: showMainWindow },
    { label: "长期任务", click: openLongTasksWindow },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showMainWindow);
}

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function collectTextParts(value, output = []) {
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectTextParts(item, output));
    return output;
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") collectTextParts(value.text, output);
    if (typeof value.content === "string" || Array.isArray(value.content)) collectTextParts(value.content, output);
    if (typeof value.output_text === "string") collectTextParts(value.output_text, output);
    if (value.function?.arguments) collectTextParts(value.function.arguments, output);
    if (value.message) collectTextParts(value.message, output);
  }
  return output;
}

function extractModelContent(data, isApi) {
  const choice = data?.choices?.[0];
  const candidates = isApi
    ? [
      choice?.message?.content,
      choice?.message?.tool_calls,
      choice?.text,
      data?.output_text,
      data?.output,
      data?.message?.content,
    ]
    : [data?.message?.content, data?.response, data?.content];
  return collectTextParts(candidates).join("\n").trim();
}

function modelHeaders(settings) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.api.apiKey}`,
  };
  if (/openrouter\.ai/i.test(settings.api.baseUrl)) {
    headers["HTTP-Referer"] = "https://my.feishu.cn/docx/Sr9RdRzFaop9BSxBgcAcdxDonOc";
    headers["X-Title"] = "DeepStudy";
  }
  return headers;
}

function modelNetworkError(error, baseUrl) {
  const message = cleanString(error?.message, String(error || ""));
  if (/fetch failed|ERR_|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(message)) {
    return `API 网络连接失败：无法连接 ${baseUrl}。请检查网络、代理/VPN、Base URL 和防火墙设置。原始错误：${message}`;
  }
  return message;
}

function longTasksPath() {
  return path.join(app.getPath("userData"), "long-tasks.json");
}

function noiseDir() {
  return path.join(app.getPath("userData"), "noise");
}

function noiseIndexPath() {
  return path.join(noiseDir(), "index.json");
}

function readNoiseIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(noiseIndexPath(), "utf8"));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function writeNoiseIndex(items) {
  fs.mkdirSync(noiseDir(), { recursive: true });
  fs.writeFileSync(noiseIndexPath(), JSON.stringify({ version: 1, items }, null, 2), "utf8");
  return items;
}

function noisePublicItem(item) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    createdAt: item.createdAt,
  };
}

function audioExtension(name = "", type = "") {
  const fromName = path.extname(name).slice(1).toLowerCase();
  const allowed = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "webm"]);
  if (allowed.has(fromName)) return fromName;
  if (/mpeg|mp3/i.test(type)) return "mp3";
  if (/wav/i.test(type)) return "wav";
  if (/ogg/i.test(type)) return "ogg";
  if (/flac/i.test(type)) return "flac";
  if (/mp4|m4a/i.test(type)) return "m4a";
  if (/webm/i.test(type)) return "webm";
  return "";
}

function normalizeNoiseBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function readLongTasks() {
  try {
    const data = JSON.parse(fs.readFileSync(longTasksPath(), "utf8"));
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const maxOrder = tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), -1);
    return tasks.map((task, index) => ({
      ...task,
      order: Number.isFinite(Number(task.order)) ? Number(task.order) : maxOrder + 1 + index,
    }));
  } catch {
    return [];
  }
}

function writeLongTasks(tasks) {
  const target = longTasksPath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, tasks }, null, 2), "utf8");
  fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("long-tasks:changed", tasks);
  return tasks;
}

function completeLongTask(id) {
  const tasks = readLongTasks();
  const task = tasks.find((item) => item.id === cleanString(id) && item.status === "active");
  if (!task) throw new Error("长期任务不存在或已完成。");
  task.status = "completed";
  task.completedAt = Date.now();
  task.updatedAt = Date.now();
  task.reminder.enabled = false;
  writeLongTasks(tasks);
  mainWindow?.webContents.send("long-tasks:completed", task);
  return { completed: true, task };
}

function moveLongTaskToDailyPlan(id) {
  const tasks = readLongTasks();
  const task = tasks.find((item) => item.id === cleanString(id) && item.status === "active");
  if (!task) throw new Error("长期任务不存在或已移入今日计划。");
  task.status = "planned";
  task.plannedAt = Date.now();
  task.updatedAt = Date.now();
  if (task.reminder) task.reminder.enabled = false;
  writeLongTasks(tasks);
  return { moved: true, task };
}

function acknowledgeReminders() {
  if (!pendingReminderIds.size) return;
  pendingReminderIds.clear();
  tray?.setImage(trayImage(false));
  mainWindow?.flashFrame(false);
  mainWindow?.webContents.send("reminders:cleared");
}

function openLongTasksWindow() {
  acknowledgeReminders();
  if (longTasksWindow && !longTasksWindow.isDestroyed()) {
    longTasksWindow.show();
    longTasksWindow.focus();
    return true;
  }
  longTasksWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    show: false,
    title: "长期任务备忘录",
    backgroundColor: "#f0f7f4",
    icon: windowIcon(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  longTasksWindow.setMenuBarVisibility(false);
  attachWindowLoadDiagnostics(longTasksWindow, "Long tasks window");
  showWhenReady(longTasksWindow);
  longTasksWindow.on("closed", () => { longTasksWindow = null; });
  longTasksWindow.loadFile(path.join(__dirname, "renderer", "long-tasks.html"));
  return true;
}

function checkReminders() {
  const tasks = readLongTasks();
  const now = Date.now();
  const due = dueTasks(tasks, now, 70000);
  if (!due.length) return;
  due.forEach((task) => { task.reminder.lastTriggeredAt = now; pendingReminderIds.add(task.id); });
  writeLongTasks(tasks);
  tray?.setImage(trayImage(true));
  mainWindow?.flashFrame(true);
  mainWindow?.webContents.send("reminders:due", due);
  if (Notification.isSupported()) {
    const notification = new Notification({ title: "长期任务提醒", body: due.map((task) => task.title).join("、"), silent: true });
    notification.on("click", openLongTasksWindow);
    notification.show();
  }
}

function normalizeBaseUrl(value, fallback) {
  const raw = cleanString(value, fallback).replace(/\/+$/, "");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("服务地址必须以 http:// 或 https:// 开头。");
  }
  return url.toString().replace(/\/+$/, "");
}

function plannerSettingsPath(scope = "planner") {
  return path.join(app.getPath("userData"), scope === "long-tasks" ? "long-task-ai-settings.json" : "planner-settings.json");
}

function decryptApiKey(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function createConfigId() {
  return `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readRawStoredSettings(scope = "planner") {
  try {
    return JSON.parse(fs.readFileSync(plannerSettingsPath(scope), "utf8"));
  } catch {
    if (scope === "long-tasks") {
      try { return JSON.parse(fs.readFileSync(plannerSettingsPath(), "utf8")); }
      catch { return {}; }
    }
    return {};
  }
}

function readPlannerSettings(scope = "planner") {
  const stored = readRawStoredSettings(scope);
  const otherScope = scope === "long-tasks" ? "planner" : "long-tasks";
  const otherStored = readRawStoredSettings(otherScope);
  const otherProfiles = (Array.isArray(otherStored.apiProfiles) ? otherStored.apiProfiles : [])
    .map((profile) => ({
      id: cleanString(profile.id),
      label: cleanString(profile.label, cleanString(profile.model, "API 配置")),
      baseUrl: cleanString(profile.baseUrl),
      model: cleanString(profile.model),
      apiKey: decryptApiKey(profile.apiKeyEncrypted),
    }))
    .filter((profile) => profile.id && profile.baseUrl && profile.model);
  let apiProfiles = (Array.isArray(stored.apiProfiles)
    ? stored.apiProfiles
    : []
  )
    .map((profile) => ({
      id: cleanString(profile.id),
      label: cleanString(profile.label, cleanString(profile.model, "API 配置")),
      baseUrl: cleanString(profile.baseUrl),
      model: cleanString(profile.model),
      apiKey: decryptApiKey(profile.apiKeyEncrypted),
    }))
    .filter((profile) => profile.id && profile.baseUrl && profile.model);
  if (!apiProfiles.length && stored.api?.model && stored.apiKeyEncrypted) {
    apiProfiles = [
      {
        id: "legacy-api",
        label: cleanString(stored.api.model),
        baseUrl: cleanString(
          stored.api.baseUrl,
          DEFAULT_PLANNER_SETTINGS.api.baseUrl,
        ),
        model: cleanString(stored.api.model),
        apiKey: decryptApiKey(stored.apiKeyEncrypted),
      },
    ];
  }
  const mergedById = new Map();
  otherProfiles.forEach((profile) => mergedById.set(profile.id, profile));
  apiProfiles.forEach((profile) => mergedById.set(profile.id, profile));
  apiProfiles = [...mergedById.values()];
  const activeApiProfileId = cleanString(
    stored.activeApiProfileId,
    apiProfiles[0]?.id || "",
  );
  const activeProfile = apiProfiles.find(
    (profile) => profile.id === activeApiProfileId,
  );
  return {
    mode: "api",
    api: {
      baseUrl: activeProfile?.baseUrl || cleanString(
          stored.api?.baseUrl,
          DEFAULT_PLANNER_SETTINGS.api.baseUrl,
        ),
      model: activeProfile?.model || cleanString(stored.api?.model),
      apiKey: activeProfile?.apiKey || decryptApiKey(stored.apiKeyEncrypted),
    },
    apiProfiles,
    activeApiProfileId: activeProfile?.id || "",
  };
}

function publicPlannerSettings(settings = readPlannerSettings()) {
  return {
    mode: settings.mode,
    api: {
      baseUrl: settings.api.baseUrl,
      model: settings.api.model,
      hasApiKey: Boolean(settings.api.apiKey),
    },
    apiProfiles: settings.apiProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      baseUrl: profile.baseUrl,
      model: profile.model,
    })),
    activeApiProfileId: settings.activeApiProfileId,
  };
}

function savePlannerSettings(input = {}, scope = "planner") {
  const current = readPlannerSettings(scope);
  const mode = "api";
  const selectedProfile = current.apiProfiles.find(
    (profile) => profile.id === cleanString(input.api?.profileId),
  );
  const apiKey = cleanString(input.api?.apiKey) || selectedProfile?.apiKey || "";
  if (apiKey && !safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统无法安全保存 API Key。");
  }
  const settings = {
    mode,
    api: {
      baseUrl: normalizeBaseUrl(input.api?.baseUrl, current.api.baseUrl),
      model: cleanString(input.api?.model, current.api.model),
      apiKey,
    },
    apiProfiles: current.apiProfiles.map((profile) => ({ ...profile })),
    activeApiProfileId: current.activeApiProfileId,
  };
  if (mode === "api" && (!settings.api.model || !settings.api.apiKey)) {
    throw new Error("API 模式需要模型名称和 API Key。");
  }
  if (mode === "api") {
    const updated = upsertApiProfile(
      settings.apiProfiles,
      {
        id: selectedProfile?.id,
        label: cleanString(input.api?.label, settings.api.model),
        baseUrl: settings.api.baseUrl,
        model: settings.api.model,
        apiKey: settings.api.apiKey,
        forceNew: Boolean(input.api?.forceNewProfile),
      },
      createConfigId,
    );
    settings.apiProfiles = updated.profiles;
    settings.activeApiProfileId = updated.activeProfileId;
  }
  const stored = {
    mode: settings.mode,
    api: { baseUrl: settings.api.baseUrl, model: settings.api.model },
    activeApiProfileId: settings.activeApiProfileId,
    apiProfiles: settings.apiProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKeyEncrypted: profile.apiKey
        ? safeStorage.encryptString(profile.apiKey).toString("base64")
        : "",
    })),
  };
  fs.writeFileSync(plannerSettingsPath(scope), JSON.stringify(stored, null, 2), "utf8");
  syncApiProfilesToOtherScope(scope, stored.apiProfiles);
  return publicPlannerSettings(settings);
}

function syncApiProfilesToOtherScope(sourceScope, sourceProfilesEncrypted) {
  const otherScope = sourceScope === "long-tasks" ? "planner" : "long-tasks";
  const otherStored = readRawStoredSettings(otherScope);
  const otherProfiles = (Array.isArray(otherStored.apiProfiles) ? otherStored.apiProfiles : [])
    .map((profile) => ({ ...profile }))
    .filter((profile) => profile.id && profile.baseUrl && profile.model);
  const otherById = new Map(otherProfiles.map((profile) => [profile.id, profile]));
  (sourceProfilesEncrypted || []).forEach((profile) => otherById.set(profile.id, profile));
  const mergedOtherProfiles = [...otherById.values()];
  const otherActiveId = cleanString(otherStored.activeApiProfileId);
  const updatedActive = mergedOtherProfiles.find((profile) => profile.id === otherActiveId);
  let otherApi = otherStored.api || DEFAULT_PLANNER_SETTINGS.api;
  if (updatedActive) otherApi = { baseUrl: updatedActive.baseUrl, model: updatedActive.model };
  const otherStoredUpdated = {
    mode: otherStored.mode || "api",
    api: otherApi,
    activeApiProfileId: typeof otherStored.activeApiProfileId === "string" ? otherStored.activeApiProfileId : (mergedOtherProfiles[0]?.id || ""),
    apiProfiles: mergedOtherProfiles,
  };
  fs.writeFileSync(plannerSettingsPath(otherScope), JSON.stringify(otherStoredUpdated, null, 2), "utf8");
}

function deleteApiProfile(profileId, scope = "planner") {
  const targetId = cleanString(profileId);
  if (!targetId) throw new Error("请选择要删除的 API 配置。");
  const current = readPlannerSettings(scope);
  const nextProfiles = current.apiProfiles.filter((profile) => profile.id !== targetId);
  if (nextProfiles.length === current.apiProfiles.length) {
    throw new Error("未找到要删除的 API 配置。");
  }
  const activeProfile = nextProfiles.find((profile) => profile.id === current.activeApiProfileId) || nextProfiles[0];
  const settings = {
    mode: "api",
    api: {
      baseUrl: activeProfile?.baseUrl || DEFAULT_PLANNER_SETTINGS.api.baseUrl,
      model: activeProfile?.model || DEFAULT_PLANNER_SETTINGS.api.model,
      apiKey: activeProfile?.apiKey || "",
    },
    apiProfiles: nextProfiles,
    activeApiProfileId: activeProfile?.id || "",
  };
  const stored = {
    mode: settings.mode,
    api: { baseUrl: settings.api.baseUrl, model: settings.api.model },
    activeApiProfileId: settings.activeApiProfileId,
    apiProfiles: settings.apiProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKeyEncrypted: profile.apiKey
        ? safeStorage.encryptString(profile.apiKey).toString("base64")
        : "",
    })),
  };
  fs.writeFileSync(plannerSettingsPath(scope), JSON.stringify(stored, null, 2), "utf8");
  deleteApiProfileFromOtherScope(profileId, scope);
  return publicPlannerSettings(settings);
}

function deleteApiProfileFromOtherScope(deletedProfileId, sourceScope) {
  const otherScope = sourceScope === "long-tasks" ? "planner" : "long-tasks";
  const otherStored = readRawStoredSettings(otherScope);
  const otherProfiles = (Array.isArray(otherStored.apiProfiles) ? otherStored.apiProfiles : [])
    .map((profile) => ({ ...profile }))
    .filter((profile) => profile.id && profile.baseUrl && profile.model);
  const nextOtherProfiles = otherProfiles.filter((profile) => profile.id !== deletedProfileId);
  if (nextOtherProfiles.length === otherProfiles.length) return;
  const otherActiveId = cleanString(otherStored.activeApiProfileId);
  const otherActive = nextOtherProfiles.find((profile) => profile.id === otherActiveId) || nextOtherProfiles[0];
  const otherStoredUpdated = {
    mode: otherStored.mode || "api",
    api: otherActive
      ? { baseUrl: otherActive.baseUrl, model: otherActive.model }
      : (otherStored.api || DEFAULT_PLANNER_SETTINGS.api),
    activeApiProfileId: otherActive?.id || "",
    apiProfiles: nextOtherProfiles,
  };
  fs.writeFileSync(plannerSettingsPath(otherScope), JSON.stringify(otherStoredUpdated, null, 2), "utf8");
}

function buildPlannerMessages(payload = {}) {
  const userMessage = cleanString(payload.message);
  const date = cleanString(payload.date, new Date().toISOString().slice(0, 10));

  const history = sanitizeChatHistory(payload.history);
  return [
    {
      role: "system",
      content: [
        "You help turn a short chat into a practical daily plan for a desktop timer app.",
        "Reply in the same language as the user, defaulting to Simplified Chinese.",
        "Keep the response concise and action-oriented.",
        "When you suggest tasks to add, end with a section named exactly PLAN_ITEMS:",
        "Use one plain-text bullet per task under PLAN_ITEMS. Do not use JSON, arrays, brackets, or code blocks in PLAN_ITEMS.",
        "Each task should be specific, short, and suitable for a checklist.",
        "Split sequential user plans into separate checklist tasks instead of collapsing them into one task.",
        "Prefix the most important tasks with [PRIORITY]. Mark at most three.",
        "Priority means purposeful work that produces short-term progress or meaningful personal growth.",
        "Do not mark entertainment, passive video watching, or routine administration as priority.",
        "Only suggest tasks that follow from the current conversation.",
        "Do not invent filler tasks just to reach a target number of priorities.",
      ].join("\n"),
    },
    ...history,
    {
      role: "user",
      content: [
        `Date: ${date}`,
        "User message:",
        userMessage,
      ].join("\n"),
    },
  ];
}

async function requestPlannerReply(payload) {
  const message = cleanString(payload && payload.message);
  if (!message) {
    throw new Error("Message is required.");
  }

  const settings = readPlannerSettings();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

  try {
    const response = await net.fetch(`${normalizeBaseUrl(settings.api.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: modelHeaders(settings),
      body: JSON.stringify({
        model: settings.api.model,
        stream: false,
        max_tokens: 800,
        temperature: 0.2,
        messages: buildPlannerMessages(payload),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `API 返回 HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = await response.json();
    const content = cleanString(extractModelContent(data, true));
    if (!content) {
      throw new Error("API 返回了空内容。");
    }

    return {
      content,
      model: cleanString(
        data.model,
        settings.api.model,
      ),
      mode: settings.mode,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("模型请求在 120 秒后超时。");
    }
    throw new Error(modelNetworkError(error, settings.api.baseUrl));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestStructuredModel(messages, signal, settingsOverride) {
  const settings = settingsOverride || readPlannerSettings();
  try {
    const response = await net.fetch(`${normalizeBaseUrl(settings.api.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: modelHeaders(settings),
      signal,
      body: JSON.stringify({
        model: settings.api.model,
        stream: false,
        temperature: 0,
        max_tokens: 700,
        messages,
      }),
    });
    if (!response.ok) throw new Error(`模型返回 HTTP ${response.status}`);
    const data = await response.json();
    const content = cleanString(extractModelContent(data, true));
    if (!content) throw new Error("模型返回了空内容。");
    return { content, metrics: data };
  } catch (error) {
    throw new Error(modelNetworkError(error, settings.api.baseUrl));
  }
}

async function proposeLongTaskOperations(payload = {}) {
  const tasks = readLongTasks();
  const history = sanitizeChatHistory(payload.history, 6);
  const requestText = cleanString(payload.message);
  const messages = [{
    role: "system",
    content: [
      "You manage a four-quadrant long-term task board.",
      "Return JSON only: {\"operations\":[{\"action\":\"create|update|delete|restore\",\"id\":\"existing id when needed\",\"task\":{\"title\":\"\",\"notes\":\"\",\"quadrant\":\"important-urgent|important-not-urgent|urgent-not-important|not-important-not-urgent\",\"reminder\":{\"kind\":\"none|once|daily|weekly\",\"at\":\"ISO date\",\"time\":\"HH:mm\",\"weekdays\":[0]}}}]}",
      "If the user asks to add a future task, create exactly one operation unless they clearly ask for multiple tasks.",
      "If the user asks for a reminder relative to the task time, calculate the reminder time and set reminder.kind to once.",
      "Never invent a reminder time. Use the user's local timezone. Keep titles concise.",
    ].join("\n"),
  }, ...history, {
    role: "user",
    content: `Current local time: ${new Date().toString()}\nExisting tasks: ${JSON.stringify(tasks.map(({ id, title, quadrant, status, reminder }) => ({ id, title, quadrant, status, reminder })))}\nRequest: ${requestText}`,
  }];
  try {
    const reply = await requestStructuredModel(messages, null, readPlannerSettings("long-tasks"));
    return { content: reply.content, operations: normalizeAiOperations(reply.content, tasks) };
  } catch (error) {
    const recoverable = /空内容|结构化结果|JSON|Unexpected token|变更列表无效/.test(error.message);
    if (!recoverable) throw error;
    const operations = fallbackAiOperationsFromText(requestText);
    if (!operations.length) throw error;
    return {
      content: JSON.stringify({ operations }),
      operations,
      fallback: true,
      warning: "模型返回格式不完整，已根据原始请求生成待确认变更。",
    };
  }
}

ipcMain.handle("long-tasks:open", openLongTasksWindow);
ipcMain.handle("long-tasks:list", () => readLongTasks());
ipcMain.handle("long-tasks:save", (_event, input) => {
  const tasks = readLongTasks();
  const normalized = normalizeTask(input);
  const index = tasks.findIndex((task) => task.id === normalized.id);
  if (index >= 0) tasks[index] = { ...tasks[index], ...normalized, createdAt: tasks[index].createdAt };
  else {
    const maxOrder = tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), -1);
    normalized.order = maxOrder + 1;
    tasks.push(normalized);
  }
  writeLongTasks(tasks);
  return normalized;
});
ipcMain.handle("long-tasks:delete", (_event, id) => {
  const tasks = readLongTasks().filter((task) => task.id !== cleanString(id));
  writeLongTasks(tasks);
  return true;
});
ipcMain.handle("long-tasks:complete", (_event, id) => completeLongTask(id));
ipcMain.handle("long-tasks:reorder", (_event, updates) => {
  const tasks = readLongTasks();
  for (const update of Array.isArray(updates) ? updates : []) {
    const index = tasks.findIndex((task) => task.id === update.id);
    if (index >= 0) tasks[index] = { ...tasks[index], ...update, updatedAt: Date.now() };
  }
  return writeLongTasks(tasks);
});
ipcMain.handle("long-tasks:apply-operations", (_event, operations) => {
  let tasks = readLongTasks();
  let nextOrder = tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), -1) + 1;
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (operation.action === "delete") tasks = tasks.filter((task) => task.id !== operation.id);
    else if (operation.action === "create") {
      const created = normalizeTask(operation.task);
      created.order = nextOrder++;
      tasks.push(created);
    }
    else {
      const index = tasks.findIndex((task) => task.id === operation.id);
      if (index < 0) continue;
      const updated = normalizeTask({ ...tasks[index], ...operation.task, id: operation.id, status: operation.action === "restore" ? "active" : operation.task.status });
      updated.createdAt = tasks[index].createdAt;
      if (operation.action === "restore") { updated.completedAt = null; updated.reminder.enabled = false; }
      tasks[index] = updated;
    }
  }
  return writeLongTasks(tasks);
});
ipcMain.handle("long-tasks:chat", (_event, payload) => proposeLongTaskOperations(payload));
ipcMain.handle("long-tasks:get-config", () => publicPlannerSettings(readPlannerSettings("long-tasks")));
ipcMain.handle("long-tasks:save-config", (_event, settings) => savePlannerSettings(settings, "long-tasks"));
ipcMain.handle("long-tasks:delete-api-profile", (_event, profileId) => deleteApiProfile(profileId, "long-tasks"));
ipcMain.handle("long-tasks:set-drag-payload", (_event, payload = {}) => {
  currentLongTaskDrag = {
    id: cleanString(payload.id),
    title: cleanString(payload.title),
    startedAt: Date.now(),
  };
  return true;
});
ipcMain.handle("long-tasks:get-drag-payload", () => {
  if (!currentLongTaskDrag || Date.now() - currentLongTaskDrag.startedAt > 30000) return null;
  return currentLongTaskDrag;
});
ipcMain.handle("daily-plan:sync", (_event, snapshot) => {
  if (snapshot && Array.isArray(snapshot.tasks)) dailyPlanSnapshot = { date: cleanString(snapshot.date), tasks: snapshot.tasks };
  return true;
});
ipcMain.handle("daily-plan:add-task", (_event, payload = {}) => {
  const title = cleanString(payload.title || payload.text, "");
  if (!title) throw new Error("任务名称不能为空。");
  mainWindow?.webContents.send("daily-plan:add-task", {
    text: title,
    priority: Boolean(payload.priority),
  });
  return true;
});
ipcMain.handle("long-tasks:move-to-daily-plan", (_event, payload = {}) => {
  return moveLongTaskToDailyPlan(payload.id);
});
ipcMain.handle("reminders:acknowledge", acknowledgeReminders);

ipcMain.handle("sync:auth-register", (_event, input) => desktopSyncService.register(input));
ipcMain.handle("sync:auth-sign-in", (_event, input) => desktopSyncService.signIn(input));
ipcMain.handle("sync:auth-recover", (_event, input) => desktopSyncService.recover(input));
ipcMain.handle("sync:auth-sign-out", () => desktopSyncService.signOut());
ipcMain.handle("sync:session", () => desktopSyncService.session());
ipcMain.handle("sync:status", () => desktopSyncService.status());
ipcMain.handle("sync:device-register", (_event, input, expected) => desktopSyncService.registerDevice(input, expected));
ipcMain.handle("sync:snapshot-capture-long-tasks", () => legacyBackupStore.captureLongTasks());
ipcMain.handle("sync:snapshot-verify-long-tasks", (_event, fingerprint) => legacyBackupStore.verifyLongTasks(fingerprint));
ipcMain.handle("sync:import-preview", (_event, records) => desktopSyncService.previewImport(records));
ipcMain.handle("sync:import-commit", (_event, input, expected) => desktopSyncService.commitImport(input, expected));
ipcMain.handle("sync:import-progress", () => desktopSyncService.importProgress());
ipcMain.handle("sync:import-progress-save", (_event, progress) => desktopSyncService.saveImportProgress(progress));
ipcMain.handle("sync:push", (_event, mutations, expected) => desktopSyncService.push(mutations, expected));
ipcMain.handle("sync:pull", (_event, input) => desktopSyncService.pull(input));
ipcMain.handle("sync:pull-commit", (_event, input) => desktopSyncService.commitPull(input));
ipcMain.handle("sync:outbox-state", (_event, expected) => desktopSyncService.outboxState(expected));
ipcMain.handle("sync:outbox-queue", (_event, mutations, expected) => desktopSyncService.queueOutbox(mutations, expected));
ipcMain.handle("sync:outbox-settle", (_event, results, expected) => desktopSyncService.settleOutbox(results, expected));
ipcMain.handle("sync:records-remember", (_event, records, expected) => desktopSyncService.recordPulled(records, expected));
ipcMain.handle("sync:enrollment-finish", (_event, records) => desktopSyncService.finishEnrollment(records));
ipcMain.handle("sync:conflicts", (_event, expected) => desktopSyncService.conflicts(expected));
ipcMain.handle("sync:conflict-resolve", (_event, conflictId, input, expected) => desktopSyncService.resolveConflict(conflictId, input, expected));
ipcMain.handle("sync:timer-current", (_event, expected) => desktopSyncService.currentTimer(expected));
ipcMain.handle("sync:timer-claim", (_event, input, expected) => desktopSyncService.claimTimer(input, expected));
ipcMain.handle("sync:timer-release", (_event, input, expected) => desktopSyncService.releaseTimer(input, expected));
ipcMain.handle("sync:backup-create", (_event, snapshot) => legacyBackupStore.createBackup(snapshot));
ipcMain.handle("sync:backup-write-long-tasks", (_event, tasks, backupId) => {
  const result = legacyBackupStore.writeLongTasks(tasks, backupId);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("long-tasks:changed", result);
  return result;
});
ipcMain.handle("sync:backup-read-long-tasks", () => legacyBackupStore.readLongTasks());
ipcMain.handle("sync:backup-restore", (_event, backupId) => {
  const result = legacyBackupStore.restoreBackup(backupId);
  const tasks = legacyBackupStore.readLongTasks();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("long-tasks:changed", tasks);
  return result;
});

ipcMain.handle("window:toggle-always-on-top", (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && !targetWindow.isDestroyed()) {
    const current = targetWindow.isAlwaysOnTop();
    // Timer windows (秒表/倒计时) get higher priority level,
    // so they can stay on top above the main DeepStudy window
    const level = isTimerWindow(targetWindow) ? "floating" : "normal";
    targetWindow.setAlwaysOnTop(!current, level);
    return !current;
  }
  return false;
});

ipcMain.handle("window:get-always-on-top", (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    return targetWindow && !targetWindow.isDestroyed() ? targetWindow.isAlwaysOnTop() : false;
  });

	ipcMain.handle("window:auto-minimize", (event) => {
		const targetWindow = BrowserWindow.fromWebContents(event.sender);
		if (targetWindow && !targetWindow.isDestroyed()) {
			// If maximized, unmaximize first so setSize takes effect cleanly
			if (targetWindow.isMaximized()) targetWindow.unmaximize();
			_minimizedByCode = true;
			targetWindow.setSize(targetWindow.getMinimumSize()[0], targetWindow.getMinimumSize()[1]);
			targetWindow.center();
			targetWindow.webContents.send("window:minimized-changed", true);
			// Clear guard after resize events settle
			setTimeout(() => { _minimizedByCode = false; }, 500);
			return true;
		}
		return false;
	});

	ipcMain.handle("window:auto-restore", (event) => {
		const targetWindow = BrowserWindow.fromWebContents(event.sender);
		if (targetWindow && !targetWindow.isDestroyed()) {
			_minimizedByCode = true;
			targetWindow.setSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
			targetWindow.center();
			targetWindow.webContents.send("window:minimized-changed", false);
			setTimeout(() => { _minimizedByCode = false; }, 500);
			return true;
		}
		return false;
	});

ipcMain.handle("planner:get-config", () => publicPlannerSettings());

ipcMain.handle("planner:save-config", (_event, settings) =>
  savePlannerSettings(settings),
);
ipcMain.handle("planner:delete-api-profile", (_event, profileId) =>
  deleteApiProfile(profileId),
);
ipcMain.handle("app:open-free-api-tutorial", () =>
  shell.openExternal(FREE_API_TUTORIAL_URL),
);

ipcMain.handle("planner:chat", (_event, payload) =>
  requestPlannerReply(payload),
);

ipcMain.handle("window:open-timer", (_event, mode) => {
  if (!["stopwatch", "countdown"].includes(mode)) {
    throw new Error("Unsupported timer mode.");
  }

  // Reuse existing timer window for this mode
  const existing = timerWindows.get(mode);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return true;
  }

  const timerWindow = new BrowserWindow({
    width: 460,
    height: 580,
    minWidth: 420,
    minHeight: 520,
    show: false,
    alwaysOnTop: true,
    title: mode === "stopwatch" ? "秒表" : "倒计时",
    backgroundColor: "#f0f7f4",
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  timerWindow.setMenuBarVisibility(false);
  timerWindows.set(mode, timerWindow);
  attachWindowLoadDiagnostics(timerWindow, "Timer window");
  showWhenReady(timerWindow, 3000);
  timerWindow.on("closed", () => {
    if (timerWindows.get(mode) === timerWindow) {
      timerWindows.delete(mode);
    }
  });
  timerWindow.loadFile(path.join(__dirname, "renderer", "timer.html"), {
    query: { mode },
  });
  return true;
});

ipcMain.handle("dialog:save-file", async (_event, payload = {}) => {
  const content = typeof payload.content === "string" ? payload.content : "";
  const defaultName = cleanString(payload.defaultName, "专注力反思.txt");
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出每日反思",
    defaultPath: defaultName,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  fs.writeFileSync(result.filePath, content, "utf8");
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("noise:list", () => readNoiseIndex().map(noisePublicItem));

ipcMain.handle("noise:add", (_event, payload = {}) => {
  const sourceName = cleanString(payload.name, "white-noise");
  const type = cleanString(payload.type, "audio/mpeg");
  const extension = audioExtension(sourceName, type);
  if (!extension) throw new Error("仅支持常见音频文件。");
  const buffer = normalizeNoiseBuffer(payload.buffer);
  if (!buffer || !buffer.length) throw new Error("音频文件为空。");
  if (buffer.length > 200 * 1024 * 1024) throw new Error("音频文件不能超过 200MB。");

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const safeName = path.basename(sourceName, path.extname(sourceName)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim() || "white-noise";
  const fileName = `${id}.${extension}`;
  fs.mkdirSync(noiseDir(), { recursive: true });
  fs.writeFileSync(path.join(noiseDir(), fileName), buffer);
  const item = {
    id,
    name: safeName.slice(0, 80),
    type,
    size: buffer.length,
    fileName,
    createdAt: Date.now(),
  };
  const items = readNoiseIndex().concat(item);
  writeNoiseIndex(items);
  return noisePublicItem(item);
});

ipcMain.handle("noise:read", (_event, id) => {
  const item = readNoiseIndex().find((entry) => entry.id === cleanString(id));
  if (!item) throw new Error("白噪音不存在。");
  const filePath = path.join(noiseDir(), item.fileName);
  return {
    ...noisePublicItem(item),
    buffer: fs.readFileSync(filePath),
  };
});

ipcMain.handle("noise:delete", (_event, id) => {
  const targetId = cleanString(id);
  const items = readNoiseIndex();
  const item = items.find((entry) => entry.id === targetId);
  if (!item) return false;
  fs.rmSync(path.join(noiseDir(), item.fileName), { force: true });
  writeNoiseIndex(items.filter((entry) => entry.id !== targetId));
  return true;
});

app.on("second-instance", () => {
  showMainWindow();
});

runWhenAppReady(() => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  createTray();
  checkReminders();
  setInterval(checkReminders, 30000);
  powerMonitor.on("resume", checkReminders);
  const testExitMs = Number(process.env.DEEPSTUDY_TEST_EXIT_AFTER_MS);
  if (requestedTestUserData && Number.isFinite(testExitMs) && testExitMs > 0) {
    setTimeout(() => {
      quitting = true;
      app.quit();
    }, testExitMs);
  }
}).catch((error) => {
  console.error("DeepStudy failed to finish starting:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "win32" && quitting) app.quit();
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => { quitting = true; });
