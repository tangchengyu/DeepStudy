const test = require("node:test");
const assert = require("node:assert/strict");

const { createEnrollmentController } = require("../renderer/sync-enrollment");

function record(id, payload = { id, notes: "line 1\nline 2", plannedAt: 7 }) {
  return {
    entityType: "long_task",
    entityId: id,
    payload,
    deleted: false,
    revision: 0,
    clientUpdatedAt: 7,
    serverUpdatedAt: null,
    deviceId: "desktop-device-test",
    legacySourceId: "storage:long-tasks.json",
  };
}

test("first-import preview is read-only", async () => {
  const writes = [];
  const api = {
    syncStatus: async () => ({ deviceId: "desktop-device-test" }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "file-1" }),
    syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncPreviewImport: async (records) => ({
      importId: "import-1", snapshotHash: "hash-1", status: "previewed",
      counts: { local: records.length, additions: records.length, conflicts: 0 }, conflicts: [],
    }),
  };
  const legacySync = {
    collectConsistentSnapshot: async ({ deviceId }) => ({ records: [record("long-1")], deviceId }),
  };
  const controller = createEnrollmentController({
    api,
    legacySync,
    storage: { setItem: (...args) => writes.push(args) },
  });

  const preview = await controller.previewFirstImport();
  assert.equal(preview.snapshotHash, "hash-1");
  assert.equal(writes.length, 0);
});

test("first import rechecks the snapshot, commits every chunk, verifies cloud readback, then applies", async () => {
  const localRecord = record("long-1");
  const calls = [];
  let collected = 0;
  const api = {
    syncStatus: async () => ({ deviceId: "desktop-device-test" }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "file-1" }),
    syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncPreviewImport: async () => ({
      importId: "import-1", snapshotHash: "hash-1", status: "previewed",
      counts: { local: 1, additions: 1, conflicts: 0 }, conflicts: [],
    }),
    syncCommitImport: async (input) => {
      calls.push(["commit", input.expectedIndex]);
      return input.expectedIndex === 0
        ? { importId: "import-1", status: "applying", nextIndex: 1, totalItems: 2 }
        : { importId: "import-1", status: "committed", nextIndex: 2, totalItems: 2 };
    },
    syncPull: async (input) => {
      calls.push(["pull", input.cursor]);
      return input.cursor === 0
        ? { records: [{ ...localRecord, revision: 1, serverUpdatedAt: 8 }], cursor: 9, hasMore: false }
        : { records: [], cursor: input.cursor, hasMore: false };
    },
    syncCreateBackup: async () => ({ backupId: "backup-1" }),
    syncWriteLongTasks: async () => [],
    syncReadLongTasks: async () => [],
    syncRestoreBackup: async () => {},
  };
  const legacySync = {
    collectConsistentSnapshot: async () => { collected += 1; return { records: [localRecord] }; },
    applyPulledSnapshot: async (input) => {
      calls.push(["apply", input.records[0].payload.notes]);
      return { backupId: "backup-1", appliedRecords: input.records.length };
    },
  };
  const controller = createEnrollmentController({ api, legacySync, storage: {} });

  await controller.previewFirstImport();
  const result = await controller.commitFirstImport();
  assert.equal(collected, 3);
  assert.deepEqual(calls, [
    ["commit", 0],
    ["commit", 1],
    ["pull", 0],
    ["apply", "line 1\nline 2"],
  ]);
  assert.equal(result.import.status, "committed");
  assert.equal(result.apply.backupId, "backup-1");
});

test("changed data invalidates the old import confirmation before any commit", async () => {
  let snapshot = record("long-1");
  let commits = 0;
  const api = {
    syncStatus: async () => ({ deviceId: "desktop-device-test" }),
    syncPreviewImport: async () => ({
      importId: `import-${snapshot.entityId}`,
      snapshotHash: `hash-${snapshot.entityId}`,
      status: "previewed",
      counts: {},
      conflicts: [],
    }),
    syncCommitImport: async () => { commits += 1; },
  };
  const legacySync = {
    collectConsistentSnapshot: async () => ({ records: [snapshot] }),
  };
  const controller = createEnrollmentController({ api, legacySync, storage: {} });
  await controller.previewFirstImport();
  snapshot = record("long-2");

  await assert.rejects(controller.commitFirstImport(), /旧数据已经变化/);
  assert.equal(commits, 0);
  assert.equal(controller.pendingPreview().snapshotHash, "hash-long-2");
});

test("remote timer takeover always sends the explicit confirmation flag", async () => {
  let claim;
  const api = {
    syncCurrentTimer: async () => ({ timer: {
      mode: "rest", status: "running", leaseVersion: 5, plannedMs: 900000,
      remainingMs: 600000, targetEndAt: 50, sessionStartAt: 10,
      segmentStartAt: 20, accumulatedMs: 30, workType: "rest",
    } }),
    syncClaimTimer: async (input) => { claim = input; return { timer: { ...input, leaseVersion: 6 } }; },
  };
  const controller = createEnrollmentController({ api, legacySync: {}, storage: {} });
  await controller.takeOverAndContinue();
  assert.equal(claim.takeover, true);
  assert.equal(claim.expectedLeaseVersion, 5);
  assert.equal(claim.mode, "rest");
});

test("registration still returns the one-time recovery code when device registration must retry", async () => {
  const controller = createEnrollmentController({
    api: {
      syncRegister: async () => ({ recoveryCode: "save-this-once", user: { username: "alice" } }),
      syncRegisterDevice: async () => { throw new Error("temporary device failure"); },
    },
    legacySync: {},
    storage: {},
  });
  const result = await controller.register({ username: "alice" });
  assert.equal(result.recoveryCode, "save-this-once");
  assert.match(result.deviceRegistrationWarning, /temporary device failure/);
});

test("device registration can be retried without repeating authentication", async () => {
  let registrations = 0;
  const controller = createEnrollmentController({
    api: {
      syncRegisterDevice: async (input) => {
        registrations += 1;
        return { device: { id: "device-1", ...input } };
      },
    },
    legacySync: {},
    storage: {},
    deviceName: "Review desktop",
    platform: "windows",
  });
  const result = await controller.registerDevice();
  assert.equal(registrations, 1);
  assert.equal(result.device.name, "Review desktop");
  assert.equal(result.device.platform, "windows");
});

test("manual backup recovery restores all six exact LocalStorage values", async () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    getItem: (key) => values.get(key) ?? null,
  };
  const localStores = Object.fromEntries(Object.values(require("../renderer/legacy-sync").LEGACY_STORAGE_KEYS)
    .map((key, index) => [key, index === 0 ? null : JSON.stringify([{ id: `old-${index}` }])]));
  const controller = createEnrollmentController({
    api: { syncRestoreBackup: async () => ({ backupId: "backup-1", localStores }) },
    legacySync: require("../renderer/legacy-sync"),
    storage,
  });
  const result = await controller.restoreBackup("backup-1");
  assert.equal(result.backupId, "backup-1");
  for (const [key, raw] of Object.entries(localStores)) assert.equal(storage.getItem(key), raw);
});

test("gateway import re-preview requirement fails closed before pull or local apply", async () => {
  let pulled = false;
  let applied = false;
  const api = {
    syncStatus: async () => ({ deviceId: "desktop-device-test" }),
    syncPreviewImport: async () => ({
      importId: "import-blocked", snapshotHash: "stable-hash", status: "previewed",
      nextIndex: 0, totalItems: 1, counts: {}, conflicts: [],
    }),
    syncCommitImport: async (input) => {
      assert.equal(typeof input.expectedIndex, "number");
      const error = new Error("IMPORT_REPREVIEW_REQUIRED");
      error.code = "IMPORT_REPREVIEW_REQUIRED";
      throw error;
    },
    syncPull: async () => { pulled = true; },
  };
  const legacySync = {
    collectConsistentSnapshot: async () => ({ records: [record("long-blocked")] }),
    applyPulledSnapshot: async () => { applied = true; },
  };
  const controller = createEnrollmentController({ api, legacySync, storage: {} });
  await controller.previewFirstImport();
  await assert.rejects(controller.commitFirstImport(), /重新采集并预览/);
  assert.equal(controller.pendingPreview(), null);
  assert.equal(pulled, false);
  assert.equal(applied, false);
});

test("truncated import-conflict previews verify every fork from pull legacySourceId instead of the capped summary", async () => {
  const records = Array.from({ length: 201 }, (_, index) => record(`long-${index}`, { id: `long-${index}`, title: `local ${index}` }));
  const forks = records.map((local) => ({
    ...local,
    entityId: `fork-${local.entityId}`,
    legacySourceId: local.entityId,
    revision: 1,
    serverUpdatedAt: 8,
  }));
  let applied = 0;
  const controller = createEnrollmentController({
    api: {
      syncStatus: async () => ({ deviceId: "desktop-device-test" }),
      syncPreviewImport: async () => ({
        importId: "truncated-import", snapshotHash: "stable", status: "previewed", nextIndex: 0,
        counts: { conflicts: 201 }, summaryTruncated: true,
        conflicts: records.slice(0, 200).map((local) => ({ entityType: local.entityType, entityId: local.entityId, forkEntityId: `fork-${local.entityId}` })),
      }),
      syncCommitImport: async () => ({ importId: "truncated-import", status: "committed", nextIndex: 201 }),
      syncPull: async () => ({ records: forks, cursor: 1, hasMore: false }),
    },
    legacySync: {
      collectConsistentSnapshot: async () => ({ records }),
      applyPulledSnapshot: async ({ records: appliedRecords }) => { applied = appliedRecords.length; return { backupId: "backup-truncated", appliedRecords: applied }; },
    },
    storage: {},
  });
  await controller.previewFirstImport();
  const result = await controller.commitFirstImport();
  assert.equal(result.apply.appliedRecords, 201);
  assert.equal(applied, 201);
});

test("restart resumes the durable import cursor instead of creating a new device-locked preview", async () => {
  const local = record("long-resume");
  const persisted = {
    importId: "import-resume", snapshotHash: "resume-hash", status: "applying", nextIndex: 1, totalItems: 2,
    counts: {}, conflicts: [], snapshot: { records: [local] },
  };
  const saved = [];
  const controller = createEnrollmentController({
    api: {
      syncStatus: async () => ({ deviceId: "desktop-device-test" }),
      syncImportProgress: async () => persisted,
      syncSaveImportProgress: async (progress) => { saved.push(progress); },
      syncCommitImport: async (input) => {
        assert.equal(input.importId, "import-resume");
        assert.equal(input.expectedIndex, 1);
        return { importId: "import-resume", status: "committed", nextIndex: 2, totalItems: 2 };
      },
      syncPull: async () => ({ records: [{ ...local, revision: 1, serverUpdatedAt: 8 }], cursor: 2, hasMore: false }),
    },
    legacySync: {
      collectConsistentSnapshot: async () => ({ records: [local] }),
      applyPulledSnapshot: async () => ({ backupId: "backup-resume", appliedRecords: 1 }),
    },
    storage: {},
  });
  const result = await controller.commitFirstImport();
  assert.equal(result.import.status, "committed");
  assert.equal(saved.at(-1), null);
});

test("lost import-chunk acknowledgement adopts a matching durable server cursor", async () => {
  const local = record("lost-ack");
  const saved = [];
  let calls = 0;
  const controller = createEnrollmentController({
    api: {
      syncStatus: async () => ({ deviceId: "desktop-device-test" }),
      syncPreviewImport: async () => ({ importId: "import-lost", snapshotHash: "hash-lost", status: "previewed", nextIndex: 0, totalItems: 2, counts: {}, conflicts: [] }),
      syncSaveImportProgress: async (value) => { saved.push(value); },
      syncCommitImport: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("STALE_IMPORT_CURSOR"), { code: "STALE_IMPORT_CURSOR", details: { importId: "import-lost", snapshotHash: "hash-lost", status: "applying", nextIndex: 1, totalItems: 2 } });
        return { importId: "import-lost", snapshotHash: "hash-lost", status: "committed", nextIndex: 2, totalItems: 2 };
      },
      syncPull: async () => ({ records: [{ ...local, revision: 1, serverUpdatedAt: 2 }], cursor: 1, hasMore: false }),
    },
    legacySync: { collectConsistentSnapshot: async () => ({ records: [local] }), applyPulledSnapshot: async () => ({ backupId: "b", appliedRecords: 1 }) }, storage: {},
  });
  await controller.previewFirstImport();
  const result = await controller.commitFirstImport();
  assert.equal(result.import.status, "committed");
  assert.equal(saved.some((entry) => entry?.nextIndex === 1), true);
});

test("manual pull does not advance the cursor before apply and rolls local data back if commit fails", async () => {
  const legacy = require("../renderer/legacy-sync");
  const originalStores = Object.fromEntries(Object.values(legacy.LEGACY_STORAGE_KEYS)
    .map((key, index) => [key, index === 0
      ? JSON.stringify({ date: "2026-07-23", tasks: [{ id: "local" }] })
      : JSON.stringify([])]));
  const values = new Map(Object.entries(originalStores));
  let backupRestored = false;
  const controller = createEnrollmentController({
    api: {
      syncStatus: async () => ({ deviceId: "desktop-manual", scopeKey: "alice", authGeneration: 2, cursor: 7 }),
      syncPull: async (input) => {
        assert.equal(input.advanceCursor, false);
        assert.equal(input.expectedScopeKey, "alice");
        return { records: [record("remote")], cursor: 9, hasMore: false };
      },
      syncCommitPull: async (input) => {
        assert.equal(input.expectedOldCursor, 7);
        assert.equal(input.newCursor, 9);
        throw Object.assign(new Error("scope changed"), { code: "SCOPE_CHANGED" });
      },
      syncRestoreBackup: async () => { backupRestored = true; return { backupId: "manual-backup", localStores: originalStores }; },
    },
    legacySync: {
      ...legacy,
      applyPulledSnapshot: async () => {
        values.set(legacy.LEGACY_STORAGE_KEYS.dailyTask, JSON.stringify({ date: "2026-07-23", tasks: [{ id: "remote" }] }));
        return { backupId: "manual-backup", appliedRecords: 1 };
      },
    },
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  await assert.rejects(controller.pullAndApply(), (error) => error.code === "SCOPE_CHANGED");
  assert.equal(backupRestored, true);
  for (const [key, raw] of Object.entries(originalStores)) assert.equal(values.get(key), raw);
});
