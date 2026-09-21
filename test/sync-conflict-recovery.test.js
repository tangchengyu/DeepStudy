const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStateStore, createDesktopSyncService } = require("../renderer/desktop-sync-service");
const { createContinuousSync } = require("../renderer/continuous-sync");
const legacySync = require("../renderer/legacy-sync");

function harness(t, status = "resolved_keep_remote") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepstudy-conflict-recovery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStateStore({ fs, filePath: path.join(directory, "state.json"), createDeviceId: () => "desktop-recovery-test" });
  const scope = store.activateScope({ gatewayUrl: "https://gateway.test", username: "recovery" });
  store.update({ localProfileScopeKey: scope.scopeKey });
  const original = { entityType: "long_task", entityId: "recovery-note", payload: { id: "recovery-note", notes: "old notes", updatedAt: 1 }, deleted: false, revision: 29, clientUpdatedAt: 1, serverUpdatedAt: 1, deviceId: "desktop-recovery-test" };
  const remote = { ...original, payload: { ...original.payload, notes: "old notes\nnew line one\nnew line two", updatedAt: 2 }, revision: 68 };
  store.updateScope(scope.scopeKey, { enrolled: true, cursor: 200, records: { "long_task\u0000recovery-note": original }, revisions: { "long_task\u0000recovery-note": 29 }, outbox: [{ mutationId: "old-conflict-mutation", baseRevision: 29, record: original, blocked: true, conflictId: "resolved-on-another-device" }], deferredPullRecords: [remote] });
  let local = structuredClone(original);
  let afterStatus = () => {};
  let failApply = false;
  const pushes = [];
  const service = createDesktopSyncService({
    stateStore: store,
    credentialStore: { loadToken: () => "test-only", securityStatus: () => ({}) },
    fetch: async (url, options) => {
      const route = new URL(url).pathname;
      if (route.endsWith("/conflicts/resolved-on-another-device")) {
        afterStatus();
        return Response.json({ id: "resolved-on-another-device", status, record: remote });
      }
      if (route.endsWith("/push")) {
        const mutations = JSON.parse(options.body).mutations;
        pushes.push(...mutations);
        return Response.json({ results: mutations.map(m => ({ mutationId: m.mutationId, status: "conflict", conflictId: "new-local-content-conflict", remote })) });
      }
      if (route.endsWith("/pull")) return Response.json({ records: [], cursor: 200, hasMore: false });
      throw new Error(`Unexpected route ${route}`);
    },
  });
  const api = Object.fromEntries(Object.entries({ syncStatus: "status", syncOutboxState: "outboxState", syncOutboxQueue: "queueOutbox", syncOutboxSettle: "settleOutbox", syncPush: "push", syncPull: "pull", syncCommitPull: "commitPull", syncConflictStatus: "conflictStatus", syncReconcileConflict: "reconcileConflict" }).map(([name, method]) => [name, (...args) => service[method](...args)]));
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const localTasks = () => local && !local.deleted ? [structuredClone(local.payload)] : [];
  const captureLongTasks = async () => ({ tasks: localTasks(), fingerprint: JSON.stringify(localTasks()) });
  const createSync = () => createContinuousSync({ api, legacySync: { collectConsistentSnapshot: async () => ({
    records: local ? [structuredClone(local)] : [],
    fingerprint: JSON.stringify(localTasks()),
    rawStores: Object.fromEntries(Object.values(legacySync.LEGACY_STORAGE_KEYS).map(key => [key, storage.getItem(key)])),
  }) }, applyPulled: async (records, _deviceId, options) => legacySync.applyPulledSnapshot({
    ...options,
    storage, records, captureLongTasks,
    createBackup: async () => ({ backupId: "test-backup" }),
    writeLongTasks: async tasks => {
      if (failApply) throw new Error("simulated write failure");
      const record = records.find(r => r.entityId === original.entityId) || local;
      local = tasks.length ? { ...structuredClone(record), payload: structuredClone(tasks[0]) } : null;
    },
    readLongTasks: async () => localTasks(),
    restoreBackup: async () => {},
  }) });
  return { api, createSync, original, remote, pushes, state: () => service.outboxState(), local: () => local, edit: value => { local = value; }, onStatus: callback => { afterStatus = callback; }, failApply: value => { failApply = value; } };
}

test("a conflict resolved on another device releases the old blocked note even after its cursor passed the update", async t => {
  const h = harness(t);
  const result = await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, h.remote.payload.notes);
  assert.equal(result.conflictCount, 0);
  assert.equal(h.state().outbox.length, 0);
  assert.equal(h.state().deferredPullRecords.length, 0);
  assert.equal(h.pushes.length, 0);
});

test("later local notes are preserved and submitted as a new conflict instead of discarded", async t => {
  const h = harness(t);
  h.edit({ ...h.original, payload: { ...h.original.payload, notes: "new local draft" } });
  const result = await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, "new local draft");
  assert.equal(h.pushes.length, 1);
  assert.notEqual(h.pushes[0].mutationId, "old-conflict-mutation");
  assert.equal(h.pushes[0].baseRevision, 29);
  assert.equal(result.conflictCount, 1);
});

test("a local deletion after the old conflict is preserved as a new tombstone", async t => {
  const h = harness(t);
  h.edit(null);
  await h.createSync().syncOnce();
  assert.equal(h.local(), null);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].record.deleted, true);
  assert.equal(h.pushes[0].baseRevision, 29);
});

test("a keep-local decision made elsewhere also installs the authoritative latest record", async t => {
  const h = harness(t, "resolved_keep_local");
  const result = await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, h.remote.payload.notes);
  assert.equal(result.conflictCount, 0);
  assert.equal(h.state().resolutionGuards.length, 0);
});

test("an edit during the status lookup is not replaced by the resolved remote note", async t => {
  const h = harness(t);
  h.onStatus(() => h.edit({ ...h.original, payload: { ...h.original.payload, notes: "typed during lookup" } }));
  await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, "typed during lookup");
});

test("unchanged content with a newer local timestamp accepts the resolved cloud version", async t => {
  const h = harness(t);
  h.edit({ ...h.original, payload: { ...h.original.payload, updatedAt: 99 } });
  await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, h.remote.payload.notes);
  assert.equal(h.pushes.length, 0);
});

test("failed writeback keeps durable recovery data and protects edits before retry", async t => {
  const h = harness(t);
  h.failApply(true);
  await assert.rejects(h.createSync().syncOnce(), /simulated write failure/);
  assert.equal(h.state().deferredPullRecords.length, 1);
  h.edit({ ...h.original, payload: { ...h.original.payload, notes: "edited after failed recovery" } });
  h.failApply(false);
  await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, "edited after failed recovery");
});

test("an edit after the resolution guard check survives the final binding check before writeback", async t => {
  const h = harness(t);
  const readState = h.api.syncOutboxState;
  let reads = 0;
  h.api.syncOutboxState = async (...args) => {
    const state = await readState(...args);
    reads += 1;
    if (reads === 3) h.edit({ ...h.original, payload: { ...h.original.payload, notes: "typed after the guard snapshot" } });
    return state;
  };
  await assert.rejects(h.createSync().syncOnce(), /changed|变化/);
  assert.equal(h.local().payload.notes, "typed after the guard snapshot");
  await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, "typed after the guard snapshot");
});

test("retrying durable recovery recognizes content already matching its deferred cloud record", async t => {
  const h = harness(t);
  h.failApply(true);
  await assert.rejects(h.createSync().syncOnce(), /simulated write failure/);
  h.edit(structuredClone(h.remote));
  h.failApply(false);
  const result = await h.createSync().syncOnce();
  assert.equal(h.local().payload.notes, h.remote.payload.notes);
  assert.equal(h.pushes.length, 0);
  assert.equal(result.conflictCount, 0);
});

for (const status of ["open", "resolving", "unknown"]) test(`${status} conflict status never unblocks or overwrites local data`, async t => {
  const h = harness(t, status);
  const result = await h.createSync().syncOnce();
  assert.equal(result.conflictCount, 1);
  assert.equal(h.local().payload.notes, "old notes");
  assert.equal(h.pushes.length, 0);
});
