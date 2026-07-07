const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

let mainWindow;
let backendProcess;
let _minimizedByCode = false;
const DEFAULT_WINDOW_WIDTH = 1180;
const DEFAULT_WINDOW_HEIGHT = 780;

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.DEEPSTUDY_FRONTEND_URL || "http://127.0.0.1:5173";
const BACKEND_URL = process.env.DEEPSTUDY_BACKEND_URL || "http://127.0.0.1:8080";

function backendJarPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "backend", "deepstudy-backend.jar"),
    path.join(__dirname, "..", "backend", "target", "deepstudy-backend.jar"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function startBackendIfBundled() {
  const jar = backendJarPath();
  if (!jar || process.env.DEEPSTUDY_SKIP_BACKEND === "1") return;

  backendProcess = spawn("java", ["-jar", jar], {
    cwd: path.dirname(jar),
    stdio: "ignore",
    windowsHide: true,
  });
}

function rendererUrl() {
  if (isDev) return DEV_SERVER_URL;
  return `file://${path.join(__dirname, "..", "frontend", "dist", "index.html")}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 520,
    minHeight: 420,
    title: "DeepStudy",
    backgroundColor: "#f0f7f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(rendererUrl());

  mainWindow.on("resize", () => {
    if (_minimizedByCode) return;
    const [w, h] = mainWindow.getSize();
    const [minW, minH] = [mainWindow.getMinimumSize()[0], mainWindow.getMinimumSize()[1]];
    if (w > minW || h > minH) {
      mainWindow.webContents.send("window:minimized-changed", false);
    }
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.moveTop?.();
  mainWindow.focus();
}

ipcMain.handle("window:toggle-always-on-top", (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target) return false;
  const next = !target.isAlwaysOnTop();
  target.setAlwaysOnTop(next);
  return next;
});

ipcMain.handle("window:get-always-on-top", (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  return target ? target.isAlwaysOnTop() : false;
});

ipcMain.handle("window:auto-minimize", (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && !targetWindow.isDestroyed()) {
    _minimizedByCode = true;
    targetWindow.setSize(targetWindow.getMinimumSize()[0], targetWindow.getMinimumSize()[1]);
    targetWindow.center();
    targetWindow.webContents.send("window:minimized-changed", true);
    setTimeout(() => { _minimizedByCode = false; }, 300);
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
    setTimeout(() => { _minimizedByCode = false; }, 300);
    return true;
  }
  return false;
});

ipcMain.handle("app:open-external", (_event, url) => {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs can be opened.");
  }
  return shell.openExternal(parsed.toString());
});

ipcMain.handle("backend:url", () => BACKEND_URL);

app.whenReady().then(() => {
  startBackendIfBundled();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
});
