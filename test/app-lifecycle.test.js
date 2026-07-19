const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppReadyRunner } = require("../renderer/app-lifecycle");

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
