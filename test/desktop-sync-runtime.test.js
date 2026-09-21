const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadSyncUI() {
  const elements = new Map();
  const listeners = new Map();
  const dispatched = [];
  let continuousOptions;
  let wakes = 0;
  let saves = 0;
  let longTaskChange;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, value: "", textContent: "", checked: false,
      classList: { toggle() {} }, setAttribute() {},
      addEventListener(name, listener) { this[name] = listener; },
    });
    return elements.get(id);
  };
  const controller = {
    status: async () => ({ signedIn: false }),
    session: async () => ({}),
  };
  const window = {
    electronAPI: { onLongTasksChanged: (listener) => { longTaskChange = listener; } },
    DeepStudyLegacySync: { LEGACY_STORAGE_KEYS: { reflection: "mytimer.dailyReflection.v1" } },
    DeepStudySyncEnrollment: { createEnrollmentController: () => controller },
    DeepStudyContinuousSync: { createContinuousSync: (options) => {
      continuousOptions = options;
      return { start() {}, stop() {}, syncOnce: async () => ({}), wake() { wakes += 1; }, notifyLocalChange() { saves += 1; } };
    } },
    DeepStudyTimerSync: { createTimerLeaseManager: () => ({}) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: (event) => dispatched.push(event),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../renderer/sync-enrollment-ui.js"), "utf8"), {
    window, document: { getElementById: element }, navigator: { platform: "Win32" },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout, clearTimeout,
  });
  return { elements, listeners, dispatched, continuousOptions, controller, longTaskChanged: () => longTaskChange?.(), counts: () => ({ wakes, saves }) };
}

test("successful background pulls refresh visible data and show automatic sync completion", () => {
  const ui = loadSyncUI();
  ui.continuousOptions.onStateChange({ phase: "synced", records: [{ entityType: "reflection", entityId: "remote" }], lastSyncedAt: Date.now(), pendingCount: 0, conflictCount: 0 });
  assert.equal(ui.dispatched.at(-1)?.type, "deepstudy:sync-data-changed");
  assert.match(ui.elements.get("sync-auto-status").textContent, /自动同步已开启|已同步/);
});

test("quota errors remain actionable and successful retry removes their stale status", () => {
  const ui = loadSyncUI();
  ui.continuousOptions.onStateChange({ phase: "retrying", error: { code: "SYNC_DAILY_READ_LIMIT" }, retryDelayMs: 7200000 });
  assert.match(ui.elements.get("sync-auto-status").textContent, /额度/);
  assert.match(ui.elements.get("sync-auto-status").textContent, /自动重试/);
  assert.doesNotMatch(ui.elements.get("sync-auto-status").textContent, /INTERNAL_ERROR|GatewayRequestError/);
  ui.continuousOptions.onStateChange({ phase: "synced", records: [], lastSyncedAt: Date.now(), pendingCount: 0, conflictCount: 0 });
  assert.doesNotMatch(ui.elements.get("sync-auto-status").textContent, /额度/);
});

test("local saves, long task edits and return to the app drive automatic synchronization", () => {
  const ui = loadSyncUI();
  ui.listeners.get("deepstudy:local-data-changed")({ detail: { key: "mytimer.dailyReflection.v1" } });
  ui.listeners.get("deepstudy:local-data-changed")({ detail: { key: "unrelated.preferences" } });
  ui.longTaskChanged();
  ui.listeners.get("online")();
  ui.listeners.get("focus")();
  assert.deepEqual(ui.counts(), { saves: 2, wakes: 2 });
});
