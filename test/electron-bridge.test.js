const test = require("node:test");
const assert = require("node:assert/strict");
const { createElectronBridge } = require("../renderer/electron-bridge");

test("reports a clear launch instruction when Electron preload is missing", async () => {
  const bridge = createElectronBridge(undefined);
  assert.equal(bridge.available, false);
  await assert.rejects(
    bridge.getPlannerConfig(),
    /deepstudy\.exe 或桌面快捷方式启动应用/,
  );
});

test("forwards planner calls when Electron preload is available", async () => {
  const calls = [];
  const electronAPI = {
    getPlannerConfig: async () => ({ mode: "api" }),
    savePlannerConfig: async (value) => (calls.push(value), value),
    deletePlannerApiProfile: async (id) => ({ deleted: id }),
    getLongTaskAiConfig: async () => ({ scope: "long" }),
    saveLongTaskAiConfig: async (value) => ({ savedLong: value }),
    getAppPreferences: async () => ({ language: "zh-CN" }),
    saveAppPreferences: async (value) => value,
    testApiConfig: async (value) => ({ ok: true, value }),
    getCurrentVersion: async () => "1.2.41",
    checkForUpdates: async () => ({ available: false }),
    installUpdate: async () => ({ opened: false }),
    openAppSettings: async (section) => ({ section }),
    openFreeApiTutorial: async () => true,
    chatWithPlanner: async () => ({ content: "ok" }),
  };
  const bridge = createElectronBridge(electronAPI);
  assert.equal(bridge.available, true);
  assert.deepEqual(await bridge.getPlannerConfig(), { mode: "api" });
  await bridge.savePlannerConfig({ mode: "api" });
  assert.deepEqual(await bridge.deletePlannerApiProfile("profile-1"), { deleted: "profile-1" });
  assert.deepEqual(await bridge.getLongTaskAiConfig(), { scope: "long" });
  assert.deepEqual(await bridge.saveLongTaskAiConfig({ mode: "api" }), { savedLong: { mode: "api" } });
  assert.deepEqual(await bridge.getAppPreferences(), { language: "zh-CN" });
  assert.deepEqual(await bridge.saveAppPreferences({ language: "en-US" }), { language: "en-US" });
  assert.deepEqual(await bridge.testApiConfig({ model: "test" }), { ok: true, value: { model: "test" } });
  assert.equal(await bridge.getCurrentVersion(), "1.2.41");
  assert.deepEqual(await bridge.checkForUpdates(), { available: false });
  assert.deepEqual(await bridge.installUpdate(), { opened: false });
  assert.deepEqual(await bridge.openAppSettings("long-ai"), { section: "long-ai" });
  assert.equal(await bridge.openFreeApiTutorial(), true);
  assert.deepEqual(calls, [{ mode: "api" }]);
});
