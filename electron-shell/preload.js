const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deepstudyShell", {
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-always-on-top"),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:get-always-on-top"),
  autoMinimize: () => ipcRenderer.invoke("window:auto-minimize"),
  autoRestore: () => ipcRenderer.invoke("window:auto-restore"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  getBackendUrl: () => ipcRenderer.invoke("backend:url"),
  onMinimizedChanged: (callback) => {
    const listener = (_event, minimized) => callback(minimized);
    ipcRenderer.on("window:minimized-changed", listener);
    return () => ipcRenderer.removeListener("window:minimized-changed", listener);
  },
});
