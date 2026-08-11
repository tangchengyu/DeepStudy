(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElectronBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const REQUIRED_METHODS = [
    "getPlannerConfig",
    "savePlannerConfig",
    "deletePlannerApiProfile",
    "getLongTaskAiConfig",
    "saveLongTaskAiConfig",
    "getAppPreferences",
    "saveAppPreferences",
    "testApiConfig",
    "getCurrentVersion",
    "checkForUpdates",
    "installUpdate",
    "openAppSettings",
    "openFreeApiTutorial",
    "chatWithPlanner",
  ];

  function createElectronBridge(electronAPI) {
    const available = REQUIRED_METHODS.every(
      (name) => typeof electronAPI?.[name] === "function",
    );
    const unavailable = () =>
      Promise.reject(
        new Error("请关闭当前页面，并从 deepstudy.exe 或桌面快捷方式启动应用。"),
      );
    const call = (name, ...args) =>
      available ? electronAPI[name](...args) : unavailable();

    return {
      available,
      getPlannerConfig: () => call("getPlannerConfig"),
      savePlannerConfig: (settings) => call("savePlannerConfig", settings),
      deletePlannerApiProfile: (profileId) => call("deletePlannerApiProfile", profileId),
      getLongTaskAiConfig: () => call("getLongTaskAiConfig"),
      saveLongTaskAiConfig: (settings) => call("saveLongTaskAiConfig", settings),
      getAppPreferences: () => call("getAppPreferences"),
      saveAppPreferences: (preferences) => call("saveAppPreferences", preferences),
      testApiConfig: (payload) => call("testApiConfig", payload),
      getCurrentVersion: () => call("getCurrentVersion"),
      checkForUpdates: () => call("checkForUpdates"),
      installUpdate: () => call("installUpdate"),
      openAppSettings: (section) => call("openAppSettings", section),
      openFreeApiTutorial: () => call("openFreeApiTutorial"),
      chatWithPlanner: (payload) => call("chatWithPlanner", payload),
    };
  }

  return { createElectronBridge };
});
