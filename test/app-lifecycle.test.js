const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAppReadyRunner } = require("../renderer/app-lifecycle");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "renderer", "app.js"), "utf8");
const longTasksJs = fs.readFileSync(path.join(root, "renderer", "long-tasks.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "main.js"), "utf8");

test("defers macOS window restoration until Electron is ready", async () => {
  let ready = false;
  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
  const runWhenAppReady = createAppReadyRunner({
    isReady: () => ready,
    whenReady: () => readyPromise,
  });
  let windowCreated = false;

  const restoration = runWhenAppReady(() => { windowCreated = true; });
  await Promise.resolve();
  assert.equal(windowCreated, false);

  ready = true;
  resolveReady();
  await restoration;
  assert.equal(windowCreated, true);
});

test("runs window restoration on the next microtask after Electron is ready", async () => {
  const runWhenAppReady = createAppReadyRunner({
    isReady: () => true,
    whenReady: () => Promise.resolve(),
  });
  let restored = false;

  const restoration = runWhenAppReady(() => { restored = true; });
  assert.equal(restored, false);
  await restoration;
  assert.equal(restored, true);
});

test("initializes mode state before startup code can invoke switchMode", () => {
  assert.ok(
    appJs.indexOf('let activeMode = "focus";') < appJs.indexOf("const PlannerBridge"),
    "activeMode must be initialized before bridge/tutorial callbacks can call switchMode",
  );
});

test("window focus recovery preserves the user's always-on-top state", () => {
  assert.match(mainJs, /const wasAlwaysOnTop = mainWindow\.isAlwaysOnTop\(\)/);
  assert.match(mainJs, /setTimeout\(\(\) => \{\s*if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) return;\s*mainWindow\.setAlwaysOnTop\(wasAlwaysOnTop/s);
});

test("planner network errors report the configured API base URL", () => {
  assert.match(mainJs, /modelNetworkError\(error,\s*settings\.api\.baseUrl\)/);
  assert.doesNotMatch(mainJs, /modelNetworkError\(error,\s*api\.baseUrl\)/);
});

test("the API test path uses a dedicated Gemini-aware request", () => {
  assert.match(mainJs, /function testApiConfiguration\(input = \{\}\)/);
  assert.match(mainJs, /buildApiTestMessages/);
  assert.match(mainJs, /buildChatCompletionBody/);
  assert.match(mainJs, /reasoning_effort/);
  assert.match(mainJs, /gemini-3\.5-flash/);
});

test("long-task AI still has a structured request helper for the shared Gemini path", () => {
  assert.match(mainJs, /async function requestStructuredModel\(messages, signal, settingsOverride\)/);
  assert.match(mainJs, /requestStructuredModel\(messages, null, settings\)/);
  assert.match(mainJs, /buildChatCompletionBody\(messages, settings, \{\s*max_tokens:\s*700,\s*temperature:\s*0,\s*\}\)/s);
});

test("new API profiles clear stale fields before creating a blank config", () => {
  assert.match(appJs, /function startNewApiProfile\(\)[\s\S]*\$\("#api-base-url"\)\.value = ""/s);
  assert.match(appJs, /function startNewApiProfile\(\)[\s\S]*\$\("#api-model"\)\.value = ""/s);
  assert.match(appJs, /function startNewApiProfile\(\)[\s\S]*\$\("#api-model-preset"\)\.value = "custom"/s);
  assert.match(longTasksJs, /function startNewProfile\(\)[\s\S]*\$\("#long-api-base-url"\)\.value = ""/s);
  assert.match(longTasksJs, /function startNewProfile\(\)[\s\S]*\$\("#long-api-model"\)\.value = ""/s);
  assert.match(longTasksJs, /function startNewProfile\(\)[\s\S]*\$\("#long-api-model-preset"\)\.value = "custom"/s);
});

test("settings modals no longer close from backdrop clicks", () => {
  assert.doesNotMatch(appJs, /modal\.addEventListener\("click", \(event\) => \{\s*if \(event\.target === modal\) close\(\);\s*\}\);/s);
  assert.doesNotMatch(longTasksJs, /modal\.addEventListener\("click", \(event\) => \{ if \(event\.target === modal\) close\(\); \}\);/s);
});
