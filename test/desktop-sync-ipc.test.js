const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const channels = [
  "sync:config",
  "sync:turnstile-verify",
  "sync:auth-register",
  "sync:auth-sign-in",
  "sync:auth-recover",
  "sync:auth-sign-out",
  "sync:session",
  "sync:status",
  "sync:device-register",
  "sync:snapshot-capture-long-tasks",
  "sync:snapshot-verify-long-tasks",
  "sync:import-preview",
  "sync:import-commit",
  "sync:import-progress",
  "sync:import-progress-save",
  "sync:push",
  "sync:pull",
  "sync:pull-commit",
  "sync:outbox-state",
  "sync:outbox-queue",
  "sync:outbox-settle",
  "sync:records-remember",
  "sync:enrollment-finish",
  "sync:conflicts",
  "sync:conflict-resolve",
  "sync:timer-current",
  "sync:timer-claim",
  "sync:timer-release",
  "sync:backup-create",
  "sync:backup-write-long-tasks",
  "sync:backup-read-long-tasks",
  "sync:backup-restore",
];

test("desktop sync exposes only named enrollment and synchronization IPC channels", () => {
  for (const channel of channels) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\(\\s*["']${channel}["']`), `main handler ${channel}`);
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*["']${channel}["']`), `preload invocation ${channel}`);
  }
  assert.doesNotMatch(preload, /get(?:Bearer|Auth)?Token|credentialStore|sync:request|gateway:fetch/i);
  assert.doesNotMatch(preload, /Authorization\s*:/);
});

test("desktop Turnstile browser verification uses a loopback callback and external browser only", () => {
  assert.match(main, /createServer\(/);
  assert.match(main, /127\.0\.0\.1/);
  assert.match(main, /shell\.openExternal/);
  assert.match(main, /\/v1\/turnstile\/desktop/);
  assert.match(main, /sync:turnstile-verify/);
  assert.doesNotMatch(preload, /sync:request|gateway:fetch/i);
});

test("packaged desktop includes the shared sync contract used for snapshot hashing", () => {
  assert.ok(packageJson.build.files.includes("packages/sync-contract/**"));
});

test("Electron smoke tests can use an explicit isolated userData path", () => {
  assert.match(main, /process\.env\.DEEPSTUDY_TEST_USER_DATA/);
  assert.match(main, /process\.env\.DEEPSTUDY_TEST_MODE/);
  assert.match(main, /descendant of the OS temporary directory/);
  assert.match(main, /production DeepStudy profile/);
  assert.match(main, /Refusing to use a filesystem root as test userData/);
  assert.match(main, /process\.env\.DEEPSTUDY_TEST_EXIT_AFTER_MS/);
});
