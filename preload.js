const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  toggleAlwaysOnTop: () => ipcRenderer.invoke("window:toggle-always-on-top"),
  getAlwaysOnTop: () => ipcRenderer.invoke("window:get-always-on-top"),
  autoMinimize: () => ipcRenderer.invoke("window:auto-minimize"),
  autoRestore: () => ipcRenderer.invoke("window:auto-restore"),
  getPlannerConfig: () => ipcRenderer.invoke("planner:get-config"),
  savePlannerConfig: (settings) =>
    ipcRenderer.invoke("planner:save-config", settings),
  deletePlannerApiProfile: (profileId) =>
    ipcRenderer.invoke("planner:delete-api-profile", profileId),
  getAppPreferences: () => ipcRenderer.invoke("app:get-preferences"),
  saveAppPreferences: (preferences) => ipcRenderer.invoke("app:save-preferences", preferences),
  testApiConfig: (payload) => ipcRenderer.invoke("app:test-api-config", payload),
  openAppSettings: (section) => ipcRenderer.invoke("app:open-settings", section),
  openFreeApiTutorial: () => ipcRenderer.invoke("app:open-free-api-tutorial"),
  chatWithPlanner: (payload) => ipcRenderer.invoke("planner:chat", payload),
  openLongTasks: () => ipcRenderer.invoke("long-tasks:open"),
  listLongTasks: () => ipcRenderer.invoke("long-tasks:list"),
  saveLongTask: (task) => ipcRenderer.invoke("long-tasks:save", task),
  saveLongTaskImage: (payload) => ipcRenderer.invoke("long-tasks:save-image", payload),
  importLongTaskImage: (sourcePath) => ipcRenderer.invoke("long-tasks:import-image-path", sourcePath),
  readLongTaskImage: (id) => ipcRenderer.invoke("long-tasks:read-image", id),
  deleteLongTask: (id) => ipcRenderer.invoke("long-tasks:delete", id),
  completeLongTask: (id) => ipcRenderer.invoke("long-tasks:complete", id),
  undoLongTaskCompletion: (task) => ipcRenderer.invoke("long-tasks:undo-complete", task),
  setLongTaskDragPayload: (payload) => ipcRenderer.invoke("long-tasks:set-drag-payload", payload),
  getLongTaskDragPayload: () => ipcRenderer.invoke("long-tasks:get-drag-payload"),
  chatWithLongTasks: (payload) => ipcRenderer.invoke("long-tasks:chat", payload),
  getLongTaskAiConfig: () => ipcRenderer.invoke("long-tasks:get-config"),
  saveLongTaskAiConfig: (settings) => ipcRenderer.invoke("long-tasks:save-config", settings),
  deleteLongTaskApiProfile: (profileId) => ipcRenderer.invoke("long-tasks:delete-api-profile", profileId),
  applyLongTaskOperations: (operations) => ipcRenderer.invoke("long-tasks:apply-operations", operations),
  reorderLongTasks: (updates) => ipcRenderer.invoke("long-tasks:reorder", updates),
  moveLongTaskToDailyPlan: (payload) => ipcRenderer.invoke("long-tasks:move-to-daily-plan", payload),
  addTaskToDailyPlan: (payload) => ipcRenderer.invoke("daily-plan:add-task", payload),
  syncDailyPlan: (snapshot) => ipcRenderer.invoke("daily-plan:sync", snapshot),
  acknowledgeReminders: () => ipcRenderer.invoke("reminders:acknowledge"),
  openTimerWindow: (mode) => ipcRenderer.invoke("window:open-timer", mode),
  saveFile: (payload) => ipcRenderer.invoke("dialog:save-file", payload),
  listCustomNoise: () => ipcRenderer.invoke("noise:list"),
  addCustomNoise: (payload) => ipcRenderer.invoke("noise:add", payload),
  readCustomNoise: (id) => ipcRenderer.invoke("noise:read", id),
  deleteCustomNoise: (id) => ipcRenderer.invoke("noise:delete", id),
  onOpenDistraction: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("focus:open-distraction", listener);
    return () => ipcRenderer.removeListener("focus:open-distraction", listener);
  },
  onOpenAppSettings: (callback) => {
    const listener = (_event, section) => callback(section);
    ipcRenderer.on("app:open-settings", listener);
    return () => ipcRenderer.removeListener("app:open-settings", listener);
  },
  onAppPreferencesChanged: (callback) => {
    const listener = (_event, preferences) => callback(preferences);
    ipcRenderer.on("app:preferences-changed", listener);
    return () => ipcRenderer.removeListener("app:preferences-changed", listener);
  },
  onMinimizedChanged: (callback) => {
    const listener = (_event, minimized) => callback(minimized);
    ipcRenderer.on("window:minimized-changed", listener);
    return () => ipcRenderer.removeListener("window:minimized-changed", listener);
  },
  onLongTasksChanged: (callback) => {
    const listener = (_event, tasks) => callback(tasks);
    ipcRenderer.on("long-tasks:changed", listener);
    return () => ipcRenderer.removeListener("long-tasks:changed", listener);
  },
  onDailyPlanReplace: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("daily-plan:replace", listener);
    return () => ipcRenderer.removeListener("daily-plan:replace", listener);
  },
  onDailyPlanAdd: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("daily-plan:add-task", listener);
    return () => ipcRenderer.removeListener("daily-plan:add-task", listener);
  },
  onLongTaskCompleted: (callback) => {
    const listener = (_event, task) => callback(task);
    ipcRenderer.on("long-tasks:completed", listener);
    return () => ipcRenderer.removeListener("long-tasks:completed", listener);
  },
  onLongTaskCompletionUndone: (callback) => {
    const listener = (_event, task) => callback(task);
    ipcRenderer.on("long-tasks:completion-undone", listener);
    return () => ipcRenderer.removeListener("long-tasks:completion-undone", listener);
  },
  onRemindersDue: (callback) => {
    const listener = (_event, tasks) => callback(tasks);
    ipcRenderer.on("reminders:due", listener);
    return () => ipcRenderer.removeListener("reminders:due", listener);
  },
  onRemindersCleared: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("reminders:cleared", listener);
    return () => ipcRenderer.removeListener("reminders:cleared", listener);
  },
});
