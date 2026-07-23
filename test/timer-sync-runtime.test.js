const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSingleFlightGate,
  createTimerLeaseManager,
  reconcileSameDeviceTimer,
} = require("../renderer/timer-sync-runtime");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function timer(overrides = {}) {
  return {
    mode: "focus",
    status: "running",
    targetEndAt: 20_000,
    remainingMs: 10_000,
    plannedMs: 25_000,
    sessionStartAt: 1_000,
    segmentStartAt: 10_000,
    accumulatedMs: 5_000,
    workType: "core",
    ...overrides,
  };
}

function signedInStatus() {
  return {
    signedIn: true,
    enrollmentComplete: true,
    scopeKey: "scope-a",
    authGeneration: 4,
    deviceId: "desktop-a",
  };
}

test("single-flight start gate runs only one claim while the first start is pending", async () => {
  const gate = createSingleFlightGate();
  const waiting = deferred();
  let claims = 0;
  const start = () => gate.run(async () => {
    claims += 1;
    await waiting.promise;
    return "started";
  });

  const first = start();
  const second = start();
  await Promise.resolve();
  assert.equal(claims, 1);
  assert.equal(first, second);

  waiting.resolve();
  assert.equal(await first, "started");
  assert.equal(await second, "started");
});

test("claim accepts ownership only after current-timer readback matches owner, mode, status, and payload", async () => {
  const expected = timer();
  let current = { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 7, remainingMs: 9_999 };
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => ({ timer: { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 7 } }),
      syncReleaseTimer: async () => ({}),
    },
    schedule: () => {},
  });

  assert.equal(await manager.claim(expected), false);
  assert.equal(manager.getOwnedTimer().uncertain, true);

  current = { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 8 };
  assert.equal(await manager.claim(expected), true);
  assert.equal(manager.getOwnedTimer().leaseVersion, 8);
  assert.equal(manager.getOwnedTimer().uncertain, undefined);
});

test("claim rejects a successful response when readback changed owner, mode, or status", async () => {
  const expected = timer();
  for (const readback of [
    { ...expected, ownerDeviceId: "desktop-b", leaseVersion: 2 },
    { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 2, mode: "rest" },
    { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 2, status: "paused" },
  ]) {
    const manager = createTimerLeaseManager({
      getStatus: async () => signedInStatus(),
      api: {
        syncCurrentTimer: async () => ({ timer: readback }),
        syncClaimTimer: async () => ({ timer: { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 2 } }),
        syncReleaseTimer: async () => ({}),
      },
      schedule: () => {},
    });
    assert.equal(await manager.claim(expected), false);
  }
});

test("paused update is rejected when current-timer readback does not match its key payload", async () => {
  const running = timer({ ownerDeviceId: "desktop-a", leaseVersion: 3 });
  const paused = timer({
    status: "paused",
    targetEndAt: null,
    remainingMs: 8_000,
    segmentStartAt: null,
    accumulatedMs: 7_000,
  });
  let current = running;
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => {
        current = { ...paused, ownerDeviceId: "desktop-a", leaseVersion: 4, accumulatedMs: 6_999 };
        return { timer: current };
      },
      syncReleaseTimer: async () => ({}),
    },
    schedule: () => {},
  });
  manager.adopt(running, "scope-a");

  assert.equal(await manager.publish("update", paused), false);
  assert.equal(manager.getOwnedTimer().uncertain, true);
});

test("lost release acknowledgement retains uncertain ownership and retries until readback releases it", async () => {
  const expected = timer();
  const scheduled = [];
  let releaseCalls = 0;
  let current = { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 11 };
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => ({ timer: current }),
      syncReleaseTimer: async () => {
        releaseCalls += 1;
        if (releaseCalls === 1) throw new Error("response lost");
        current = null;
        return {};
      },
    },
    schedule: (work) => { scheduled.push(work); },
  });
  manager.adopt(current, "scope-a");

  assert.equal(await manager.release(expected), false);
  assert.equal(manager.getOwnedTimer().leaseVersion, 11);
  assert.equal(manager.getOwnedTimer().uncertainRelease, true);
  assert.equal(scheduled.length, 1);

  await scheduled.shift()();
  assert.equal(releaseCalls, 2);
  assert.equal(manager.getOwnedTimer(), null);
});

test("a retry for an uncertain old release never releases a newer claimed lease", async () => {
  const firstTimer = timer();
  const nextTimer = timer({ targetEndAt: 40_000, remainingMs: 30_000 });
  const scheduled = [];
  let releaseCalls = 0;
  let current = { ...firstTimer, ownerDeviceId: "desktop-a", leaseVersion: 11 };
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => {
        current = { ...nextTimer, ownerDeviceId: "desktop-a", leaseVersion: 12 };
        return { timer: current };
      },
      syncReleaseTimer: async () => {
        releaseCalls += 1;
        throw new Error("response lost");
      },
    },
    schedule: (work) => { scheduled.push(work); },
  });
  manager.adopt(current, "scope-a");

  assert.equal(await manager.release(firstTimer), false);
  assert.equal(await manager.claim(nextTimer), true);
  await scheduled.shift()();

  assert.equal(releaseCalls, 1);
  assert.equal(manager.getOwnedTimer().leaseVersion, 12);
  assert.equal(manager.getOwnedTimer().uncertainRelease, undefined);
});

test("lost old release response does not retry against a newer lease already visible in readback", async () => {
  const expected = timer();
  const scheduled = [];
  let current = { ...expected, ownerDeviceId: "desktop-a", leaseVersion: 21 };
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => ({ timer: current }),
      syncReleaseTimer: async () => {
        current = { ...timer({ mode: "rest", workType: "rest" }), ownerDeviceId: "desktop-a", leaseVersion: 22 };
        throw new Error("old response lost");
      },
    },
    schedule: (work) => { scheduled.push(work); },
  });
  manager.adopt(current, "scope-a");

  assert.equal(await manager.release(expected), true);
  assert.equal(manager.getOwnedTimer().leaseVersion, 22);
  assert.equal(manager.getOwnedTimer().uncertainRelease, undefined);
  assert.equal(scheduled.length, 0);
});

test("a lost paused update acknowledgement retries until local and cloud status converge", async () => {
  const running = { ...timer(), ownerDeviceId: "desktop-a", leaseVersion: 31 };
  const paused = timer({ status: "paused", targetEndAt: null, remainingMs: 8_000, segmentStartAt: null, accumulatedMs: 7_000 });
  const scheduled = [];
  let current = running;
  let claims = 0;
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => {
        claims += 1;
        if (claims === 1) throw new Error("paused update response lost");
        current = { ...paused, ownerDeviceId: "desktop-a", leaseVersion: 32 };
        return { timer: current };
      },
      syncReleaseTimer: async () => ({}),
    },
    schedule: (work) => { scheduled.push(work); },
  });
  manager.adopt(running, "scope-a");
  assert.equal(await manager.publish("update", paused), false);
  assert.equal(manager.getOwnedTimer().uncertainUpdate, true);
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.equal(claims, 2);
  assert.equal(manager.getOwnedTimer().status, "paused");
  assert.equal(manager.getOwnedTimer().remainingMs, 8_000);
  assert.equal(manager.getOwnedTimer().uncertainUpdate, undefined);
});

test("account transition queues pause acknowledgement before releasing the old account lease", async () => {
  const running = { ...timer(), ownerDeviceId: "desktop-a", leaseVersion: 41 };
  const paused = timer({ status: "paused", targetEndAt: null, remainingMs: 7_000, segmentStartAt: null, accumulatedMs: 8_000 });
  let current = running;
  const calls = [];
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => {
        calls.push("pause");
        current = { ...paused, ownerDeviceId: "desktop-a", leaseVersion: 42 };
        return { timer: current };
      },
      syncReleaseTimer: async ({ expectedLeaseVersion }) => {
        calls.push(`release:${expectedLeaseVersion}`);
        current = null;
        return {};
      },
    },
    schedule: () => {},
  });
  manager.adopt(running, "scope-a");
  const pause = manager.publish("update", paused);
  const release = manager.release();
  assert.equal(await pause, true);
  assert.equal(await release, true);
  assert.deepEqual(calls, ["pause", "release:42"]);
  assert.equal(manager.getOwnedTimer(), null);
});

test("same-device restart restores the cloud timer and a later sign-out releases its lease", async () => {
  const remote = { ...timer(), ownerDeviceId: "desktop-a", leaseVersion: 51 };
  let current = remote;
  const hydrated = [];
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => ({ timer: current }),
      syncReleaseTimer: async () => { current = null; return {}; },
    },
    schedule: () => {},
  });

  const result = await reconcileSameDeviceTimer({
    api: { syncCurrentTimer: async () => ({ timer: current }) },
    leaseManager: manager,
    local: signedInStatus(),
    hydrate: (value) => hydrated.push(value),
    now: () => 15_000,
  });

  assert.equal(result.kind, "same-device");
  assert.deepEqual(hydrated, [remote]);
  assert.equal(manager.getOwnedTimer().leaseVersion, 51);
  assert.equal(await manager.release(), true);
  assert.equal(current, null);
});

test("expired same-device timer is released without hydrating a finished session", async () => {
  const remote = { ...timer({ targetEndAt: 10_000 }), ownerDeviceId: "desktop-a", leaseVersion: 52 };
  let current = remote;
  let hydrated = false;
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: current }),
      syncClaimTimer: async () => ({ timer: current }),
      syncReleaseTimer: async () => { current = null; return {}; },
    },
    schedule: () => {},
  });

  const result = await reconcileSameDeviceTimer({
    api: { syncCurrentTimer: async () => ({ timer: current }) },
    leaseManager: manager,
    local: signedInStatus(),
    hydrate: () => { hydrated = true; },
    now: () => 10_001,
  });

  assert.equal(result.kind, "expired");
  assert.equal(result.released, true);
  assert.equal(hydrated, false);
  assert.equal(current, null);
});

test("another device timer remains unadopted and requires explicit takeover", async () => {
  const remote = { ...timer(), ownerDeviceId: "desktop-b", leaseVersion: 53 };
  let hydrated = false;
  const manager = createTimerLeaseManager({
    getStatus: async () => signedInStatus(),
    api: {
      syncCurrentTimer: async () => ({ timer: remote }),
      syncClaimTimer: async () => ({ timer: remote }),
      syncReleaseTimer: async () => ({}),
    },
    schedule: () => {},
  });

  const result = await reconcileSameDeviceTimer({
    api: { syncCurrentTimer: async () => ({ timer: remote }) },
    leaseManager: manager,
    local: signedInStatus(),
    hydrate: () => { hydrated = true; },
  });

  assert.equal(result.kind, "other-device");
  assert.equal(hydrated, false);
  assert.equal(manager.getOwnedTimer(), null);
});
