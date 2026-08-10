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
  discardLongTaskImage: (id) => ipcRenderer.invoke("long-tasks:discard-image", id),
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
  syncRegister: (input) => ipcRenderer.invoke("sync:auth-register", input),
  syncSignIn: (input) => ipcRenderer.invoke("sync:auth-sign-in", input),
  syncRecover: (input) => ipcRenderer.invoke("sync:auth-recover", input),
  syncSignOut: () => ipcRenderer.invoke("sync:auth-sign-out"),
  syncSession: () => ipcRenderer.invoke("sync:session"),
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  syncRegisterDevice: (input) => ipcRenderer.invoke("sync:device-register", input),
  syncCaptureLongTasks: () => ipcRenderer.invoke("sync:snapshot-capture-long-tasks"),
  syncVerifyLongTasks: (fingerprint) => ipcRenderer.invoke("sync:snapshot-verify-long-tasks", fingerprint),
  syncPreviewImport: (records) => ipcRenderer.invoke("sync:import-preview", records),
  syncCommitImport: (input) => ipcRenderer.invoke("sync:import-commit", input),
  syncImportProgress: () => ipcRenderer.invoke("sync:import-progress"),
  syncSaveImportProgress: (progress) => ipcRenderer.invoke("sync:import-progress-save", progress),
  syncPush: (mutations, expected) => ipcRenderer.invoke("sync:push", mutations, expected),
  syncPull: (input) => ipcRenderer.invoke("sync:pull", input),
  syncCommitPull: (input) => ipcRenderer.invoke("sync:pull-commit", input),
  syncOutboxState: (expected) => ipcRenderer.invoke("sync:outbox-state", expected),
  syncOutboxQueue: (mutations, expected) => ipcRenderer.invoke("sync:outbox-queue", mutations, expected),
  syncOutboxSettle: (results, expected) => ipcRenderer.invoke("sync:outbox-settle", results, expected),
  syncRememberRecords: (records, expected) => ipcRenderer.invoke("sync:records-remember", records, expected),
  syncFinishEnrollment: (records) => ipcRenderer.invoke("sync:enrollment-finish", records),
  syncConflicts: () => ipcRenderer.invoke("sync:conflicts"),
  syncResolveConflict: (conflictId, input) => ipcRenderer.invoke("sync:conflict-resolve", conflictId, input),
  syncCurrentTimer: (expected) => ipcRenderer.invoke("sync:timer-current", expected),
  syncClaimTimer: (input, expected) => ipcRenderer.invoke("sync:timer-claim", input, expected),
  syncReleaseTimer: (input, expected) => ipcRenderer.invoke("sync:timer-release", input, expected),
  syncCreateBackup: (snapshot) => ipcRenderer.invoke("sync:backup-create", snapshot),
  syncWriteLongTasks: (tasks, backupId) => ipcRenderer.invoke("sync:backup-write-long-tasks", tasks, backupId),
  syncReadLongTasks: () => ipcRenderer.invoke("sync:backup-read-long-tasks"),
  syncRestoreBackup: (backupId) => ipcRenderer.invoke("sync:backup-restore", backupId),
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
