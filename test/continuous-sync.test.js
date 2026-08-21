const test = require("node:test");
const assert = require("node:assert/strict");

const { createContinuousSync } = require("../renderer/continuous-sync");
const { buildLegacyRecords, LEGACY_STORAGE_KEYS } = require("../renderer/legacy-sync");

function storageWithFocusSession(session) {
  const values = new Map(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, key === LEGACY_STORAGE_KEYS.focusSession && session ? JSON.stringify([session]) : null]));
  return { getItem: (key) => values.get(key) ?? null };
}

test("continuous sync creates a durable mutation with the known server revision and settles it", async () => {
  const deviceId = "desktop-continuous-device";
  const first = { id: "session-1", start: 1, end: 2, focusedMs: 1 };
  const second = { ...first, focusedMs: 5, end: 6 };
  const initial = buildLegacyRecords({ rawStores: Object.fromEntries(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, key === LEGACY_STORAGE_KEYS.focusSession ? JSON.stringify([first]) : null])), longTasks: [], deviceId });
  const storage = storageWithFocusSession(second);
  const calls = [];
  let durableOutbox = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId }),
    syncOutboxState: async () => ({ enrolled: true, cursor: 0, revisions: { "focus_session\u0000session-1": 7 }, records: initial.map((record) => ({ ...record, revision: record.entityId === "session-1" ? 7 : 0 })), outbox: durableOutbox }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }),
    syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (mutations) => { durableOutbox = mutations; calls.push(["queue", mutations]); },
    syncPush: async (mutations) => ({ results: mutations.map((mutation) => ({ mutationId: mutation.mutationId, status: "applied", entityType: mutation.record.entityType, entityId: mutation.record.entityId, revision: 8, serverUpdatedAt: 9 })) }),
    syncOutboxSettle: async (results) => { durableOutbox = []; calls.push(["settle", results]); },
    syncPull: async () => ({ records: [], cursor: 0, hasMore: false }),
    syncRememberRecords: async () => {},
  };
  const sync = createContinuousSync({ api, legacySync: require("../renderer/legacy-sync"), storage, intervalMs: 999999 });
  await sync.syncOnce();
  assert.equal(calls[0][0], "queue");
  assert.equal(calls[0][1].length, 1);
  assert.equal(calls[0][1][0].baseRevision, 7);
  assert.equal(calls[0][1][0].record.payload.focusedMs, 5);
  assert.equal(calls[1][0], "settle");
});

test("continuous sync preserves a deletion as a tombstone instead of dropping it", async () => {
  const deviceId = "desktop-tombstone-device";
  const known = { id: "session-gone", start: 1, end: 2 };
  const initial = buildLegacyRecords({ rawStores: Object.fromEntries(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, key === LEGACY_STORAGE_KEYS.focusSession ? JSON.stringify([known]) : null])), longTasks: [], deviceId });
  const queued = [];
  const sync = createContinuousSync({
    api: {
      syncStatus: async () => ({ signedIn: true, deviceId }),
      syncOutboxState: async () => ({ enrolled: true, revisions: { "focus_session\u0000session-gone": 3 }, records: initial.map((record) => ({ ...record, revision: 3 })), outbox: [] }),
      syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }),
      syncVerifyLongTasks: async () => ({ unchanged: true }),
      syncOutboxQueue: async (mutations) => queued.push(...mutations),
      syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
      syncPull: async () => ({ records: [], cursor: 0, hasMore: false }), syncRememberRecords: async () => {},
    },
    legacySync: require("../renderer/legacy-sync"), storage: storageWithFocusSession(null), intervalMs: 999999,
  });
  await sync.syncOnce();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].record.deleted, true);
  assert.equal(queued[0].baseRevision, 3);
});

test("an unrelated local mutation does not prevent a remote record from being applied before cursor commit", async () => {
  const deviceId = "desktop-two-phase-device";
  const local = { id: "local-1", start: 1, end: 2 };
  const initial = buildLegacyRecords({ rawStores: Object.fromEntries(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, key === LEGACY_STORAGE_KEYS.focusSession ? JSON.stringify([{ ...local, end: 1 }]) : null])), longTasks: [], deviceId });
  const applied = [];
  const commits = [];
  const remote = { entityType: "reflection", entityId: "remote-1", payload: { id: "remote-1", notes: "cloud\ntext" }, deleted: false, revision: 3, clientUpdatedAt: 3, serverUpdatedAt: 4, deviceId: "mobile-device" };
  let durableOutbox = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId, scopeKey: "scope-a", authGeneration: 4 }),
    syncOutboxState: async () => ({ scopeKey: "scope-a", localProfileScopeKey: "scope-a", enrolled: true, cursor: 5, revisions: {}, records: initial, outbox: durableOutbox }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }), syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (mutations) => { durableOutbox = mutations; },
    syncPush: async (mutations) => ({ results: mutations.map((mutation) => ({ mutationId: mutation.mutationId, status: "applied", entityType: mutation.record.entityType, entityId: mutation.record.entityId, revision: 1 })) }),
    syncOutboxSettle: async () => { durableOutbox = []; },
    syncPull: async () => ({ records: [remote], cursor: 6, hasMore: false }),
    syncCommitPull: async (input) => commits.push(input),
  };
  const sync = createContinuousSync({ api, legacySync: require("../renderer/legacy-sync"), storage: storageWithFocusSession(local), applyPulled: async (records) => applied.push(...records) });
  await sync.syncOnce();
  assert.deepEqual(applied, [remote]);
  assert.equal(commits[0].expectedOldCursor, 5);
  assert.equal(commits[0].newCursor, 6);
  assert.deepEqual(commits[0].records, [remote]);
});

test("failed remote apply leaves cursor and known records uncommitted and does not invent a tombstone next round", async () => {
  const deviceId = "desktop-apply-fail-device";
  const remote = { entityType: "reflection", entityId: "remote-fail", payload: { id: "remote-fail" }, deleted: false, revision: 1, clientUpdatedAt: 1, serverUpdatedAt: 2, deviceId: "mobile-device" };
  let commits = 0;
  let queued = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId, scopeKey: "scope-a", authGeneration: 1 }),
    syncOutboxState: async () => ({ scopeKey: "scope-a", localProfileScopeKey: "scope-a", enrolled: true, cursor: 0, revisions: {}, records: [], outbox: [] }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }), syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (mutations) => { queued.push(...mutations); }, syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [remote], cursor: 1, hasMore: false }), syncCommitPull: async () => { commits += 1; },
  };
  const sync = createContinuousSync({ api, legacySync: require("../renderer/legacy-sync"), storage: storageWithFocusSession(null), applyPulled: async () => { throw new Error("readback failed"); } });
  await assert.rejects(sync.syncOnce(), /readback failed/);
  assert.equal(commits, 0);
  assert.equal(queued.some((mutation) => mutation.record.entityId === "remote-fail" && mutation.record.deleted), false);
});

test("requeue rereads durable outbox and pushes only the canonical replacement", async () => {
  const deviceId = "desktop-requeue-device";
  const oldMutation = { mutationId: "desktop:old", baseRevision: 0, record: { entityType: "focus_session", entityId: "session-1", payload: { id: "session-1", end: 1 }, deleted: false, revision: 0, clientUpdatedAt: 1, serverUpdatedAt: null, deviceId } };
  let durable = [oldMutation];
  let pushed = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId, scopeKey: "scope-a", authGeneration: 1 }),
    syncOutboxState: async () => ({ scopeKey: "scope-a", localProfileScopeKey: "scope-a", enrolled: true, cursor: 0, revisions: {}, records: [], outbox: durable }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }), syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (mutations) => { durable = mutations; },
    syncPush: async (mutations) => { pushed.push(...mutations); return { results: [] }; }, syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [], cursor: 0, hasMore: false }), syncCommitPull: async () => {},
  };
  const sync = createContinuousSync({ api, legacySync: require("../renderer/legacy-sync"), storage: storageWithFocusSession({ id: "session-1", end: 2 }) });
  await sync.syncOnce();
  assert.equal(pushed.length, 1);
  assert.notEqual(pushed[0].mutationId, "desktop:old");
  assert.equal(pushed[0].record.payload.end, 2);
});

test("an already-known tombstone does not generate another tombstone forever", () => {
  const known = { entityType: "reflection", entityId: "gone", payload: { id: "gone" }, deleted: true, revision: 2 };
  const mutations = require("../renderer/continuous-sync").buildMutations([], { records: [known], revisions: { "reflection\u0000gone": 2 }, outbox: [] });
  assert.deepEqual(mutations, []);
});

test("missing local image files do not tombstone chunks that are still referenced by notes", () => {
  const knownTask = {
    entityType: "long_task",
    entityId: "task-with-image",
    payload: { id: "task-with-image", notes: "![粘贴的图片](deepstudy-image://pasted.png)" },
    deleted: false,
    revision: 2,
  };
  const knownChunk = {
    entityType: "long_task_image_chunk",
    entityId: "pasted.png:0",
    payload: { imageId: "pasted.png", index: 0, total: 1, data: "aW1n" },
    deleted: false,
    revision: 2,
  };

  const mutations = require("../renderer/continuous-sync").buildMutations([knownTask], {
    records: [knownTask, knownChunk],
    revisions: {
      "long_task\u0000task-with-image": 2,
      "long_task_image_chunk\u0000pasted.png:0": 2,
    },
    outbox: [],
  });

  assert.equal(mutations.some((mutation) => mutation.record.entityType === "long_task_image_chunk"), false);
});

test("unreferenced image chunks are tombstoned after the task no longer references them", () => {
  const knownChunk = {
    entityType: "long_task_image_chunk",
    entityId: "stale.png:0",
    payload: { imageId: "stale.png", index: 0, total: 1, data: "aW1n" },
    deleted: false,
    revision: 2,
  };

  const mutations = require("../renderer/continuous-sync").buildMutations([], {
    records: [knownChunk],
    revisions: { "long_task_image_chunk\u0000stale.png:0": 2 },
    outbox: [],
  });

  assert.deepEqual(mutations.map((mutation) => ({
    entityType: mutation.record.entityType,
    entityId: mutation.record.entityId,
    deleted: mutation.record.deleted,
  })), [{
    entityType: "long_task_image_chunk",
    entityId: "stale.png:0",
    deleted: true,
  }]);
});

test("a scope switch after local apply rolls the old account data back when pull commit is rejected", async () => {
  const remote = { entityType: "reflection", entityId: "alice-only", payload: { id: "alice-only", notes: "private" }, deleted: false, revision: 1 };
  const rolledBack = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId: "desktop-race", scopeKey: "alice", authGeneration: 3 }),
    syncOutboxState: async () => ({ scopeKey: "alice", localProfileScopeKey: "alice", enrolled: true, cursor: 0, revisions: {}, records: [], outbox: [], deferredPullRecords: [] }),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }), syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async () => {}, syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [remote], cursor: 1, hasMore: false }),
    syncCommitPull: async () => { throw Object.assign(new Error("account switched"), { code: "SCOPE_CHANGED" }); },
  };
  const sync = createContinuousSync({
    api,
    legacySync: require("../renderer/legacy-sync"),
    storage: storageWithFocusSession(null),
    applyPulled: async () => ({ backupId: "alice-backup" }),
    rollbackPulled: async (backupId) => rolledBack.push(backupId),
  });
  await assert.rejects(sync.syncOnce(), (error) => error.code === "SCOPE_CHANGED");
  assert.deepEqual(rolledBack, ["alice-backup"]);
});

test("blocked pull records are durably deferred while safe records advance the cursor", async () => {
  const blocked = { entityType: "long_task", entityId: "conflicted", payload: { id: "conflicted", title: "cloud" }, deleted: false, revision: 2 };
  const safe = { entityType: "reflection", entityId: "safe", payload: { id: "safe", notes: "cloud" }, deleted: false, revision: 4 };
  let scope = {
    scopeKey: "alice", localProfileScopeKey: "alice", enrolled: true, cursor: 0, revisions: {}, records: [],
    outbox: [{ mutationId: "blocked-local", baseRevision: 1, blocked: true, record: { ...blocked, payload: { id: "conflicted", title: "local" }, revision: 1 } }],
    deferredPullRecords: [],
  };
  let localRecords = [];
  const queued = [];
  const appliedBatches = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId: "desktop-deferred", scopeKey: "alice", authGeneration: 1 }),
    syncOutboxState: async () => structuredClone(scope),
    syncCaptureLongTasks: async () => ({ tasks: [], fingerprint: "same" }), syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (items) => queued.push(...items), syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async ({ cursor }) => cursor === 0 ? { records: [blocked, safe], cursor: 2, hasMore: false } : { records: [], cursor: 2, hasMore: false },
    syncCommitPull: async (input) => {
      scope = { ...scope, cursor: input.newCursor, records: [...scope.records, ...input.records], deferredPullRecords: input.deferredPullRecords };
    },
  };
  const sync = createContinuousSync({
    api,
    legacySync: { collectConsistentSnapshot: async () => ({ records: structuredClone(localRecords) }) },
    storage: {},
    applyPulled: async (records) => { appliedBatches.push(records.map((record) => record.entityId)); localRecords.push(...records); return { backupId: `backup-${appliedBatches.length}` }; },
  });
  await sync.syncOnce();
  assert.equal(scope.cursor, 2);
  assert.deepEqual(appliedBatches, [["safe"]]);
  assert.deepEqual(scope.deferredPullRecords.map((record) => record.entityId), ["conflicted"]);
  await sync.syncOnce();
  assert.equal(queued.some((mutation) => mutation.record.entityId === "safe"), false);
  scope.outbox = [];
  await sync.syncOnce();
  assert.deepEqual(appliedBatches, [["safe"], ["conflicted"]]);
  assert.deepEqual(scope.deferredPullRecords, []);
});

test("a keep-remote deferred record is applied before local change detection can requeue the loser", async () => {
  const remote = { entityType: "long_task", entityId: "task-1", payload: { id: "task-1", title: "remote wins" }, deleted: false, revision: 2 };
  let localRecords = [{ ...remote, payload: { id: "task-1", title: "old local loser" }, revision: 1 }];
  let scope = {
    scopeKey: "alice", localProfileScopeKey: "alice", enrolled: true, cursor: 8, revisions: { "long_task\u0000task-1": 1 },
    records: [{ ...remote, payload: { id: "task-1", title: "remote base" }, revision: 1 }], outbox: [], deferredPullRecords: [remote],
  };
  const queued = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId: "desktop-keep-remote", scopeKey: "alice", authGeneration: 1 }),
    syncOutboxState: async () => structuredClone(scope),
    syncOutboxQueue: async (mutations) => queued.push(...mutations), syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [], cursor: 8, hasMore: false }),
    syncCommitPull: async (input) => { scope = { ...scope, records: input.records, revisions: { "long_task\u0000task-1": 2 }, deferredPullRecords: input.deferredPullRecords }; },
  };
  const sync = createContinuousSync({
    api,
    legacySync: { collectConsistentSnapshot: async () => ({ records: structuredClone(localRecords) }) },
    storage: {},
    applyPulled: async (records) => { localRecords = structuredClone(records); return { backupId: "keep-remote-backup" }; },
  });
  await sync.syncOnce();
  assert.equal(queued.length, 0);
  assert.equal(localRecords[0].payload.title, "remote wins");
  assert.deepEqual(scope.deferredPullRecords, []);
});

test("switching from account A to enrolled account B hydrates B before detecting local mutations", async () => {
  const accountA = { entityType: "reflection", entityId: "alice-note", payload: { id: "alice-note", notes: "Alice private" }, deleted: false, revision: 3 };
  const accountB = { entityType: "reflection", entityId: "bob-note", payload: { id: "bob-note", notes: "Bob private" }, deleted: false, revision: 5 };
  let localRecords = [accountA];
  let state = {
    scopeKey: "bob", localProfileScopeKey: "alice", enrolled: true, cursor: 9,
    revisions: { "reflection\u0000bob-note": 5 }, records: [accountB], outbox: [], deferredPullRecords: [],
  };
  const events = [];
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId: "desktop-switch", scopeKey: "bob", authGeneration: 8 }),
    syncOutboxState: async () => structuredClone(state),
    syncOutboxQueue: async (mutations) => events.push(["queue", mutations]),
    syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [], cursor: 9, hasMore: false }),
    syncCommitPull: async (input) => {
      events.push(["commit", input]);
      if (input.markLocalProfileScope) state = { ...state, localProfileScopeKey: "bob" };
    },
  };
  const sync = createContinuousSync({
    api,
    legacySync: { collectConsistentSnapshot: async () => ({ records: structuredClone(localRecords) }) },
    storage: {},
    applyPulled: async (records) => {
      events.push(["apply", records]);
      const byId = new Map(localRecords.map((record) => [identityForTest(record), record]));
      for (const record of records) {
        if (record.deleted) byId.delete(identityForTest(record));
        else byId.set(identityForTest(record), record);
      }
      localRecords = [...byId.values()];
      return { backupId: "account-a-backup" };
    },
  });
  await sync.syncOnce();
  assert.equal(events[0][0], "apply");
  assert.deepEqual(events[0][1].map((record) => [record.entityId, record.deleted]), [["bob-note", false], ["alice-note", true]]);
  assert.equal(events.some(([kind, mutations]) => kind === "queue" && mutations.length), false);
  assert.deepEqual(localRecords.map((record) => record.entityId), ["bob-note"]);
  assert.equal(state.localProfileScopeKey, "bob");
});

function identityForTest(record) {
  return `${record.entityType}\u0000${record.entityId}`;
}

test("real legacy profile replacement switches from Alice daily date to Bob without uploading a tombstone", async () => {
  const legacy = require("../renderer/legacy-sync");
  const emptyStores = Object.fromEntries(Object.values(legacy.LEGACY_STORAGE_KEYS).map((key) => [key, JSON.stringify([])]));
  const aliceRaw = {
    ...emptyStores,
    [legacy.LEGACY_STORAGE_KEYS.dailyTask]: JSON.stringify({ date: "2026-07-23", tasks: [{ id: "alice-task", text: "Alice private", done: false }] }),
  };
  const bobRaw = {
    ...emptyStores,
    [legacy.LEGACY_STORAGE_KEYS.dailyTask]: JSON.stringify({ date: "2026-07-22", tasks: [{ id: "bob-task", text: "Bob private", done: false }] }),
  };
  const bobRecords = legacy.buildLegacyRecords({ rawStores: bobRaw, longTasks: [], deviceId: "bob-device" });
  const values = new Map(Object.entries(aliceRaw));
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  let longTasks = [];
  let state = {
    scopeKey: "bob", localProfileScopeKey: "alice", enrolled: true, cursor: 4,
    revisions: Object.fromEntries(bobRecords.map((record) => [identityForTest(record), 1])),
    records: bobRecords.map((record) => ({ ...record, revision: 1 })), outbox: [], deferredPullRecords: [],
  };
  const queued = [];
  const backups = new Map();
  const api = {
    syncStatus: async () => ({ signedIn: true, deviceId: "desktop-switch-real", scopeKey: "bob", authGeneration: 2 }),
    syncOutboxState: async () => structuredClone(state),
    syncCaptureLongTasks: async () => ({ tasks: structuredClone(longTasks), fingerprint: JSON.stringify(longTasks) }),
    syncVerifyLongTasks: async () => ({ unchanged: true }),
    syncOutboxQueue: async (mutations) => queued.push(...mutations), syncPush: async () => ({ results: [] }), syncOutboxSettle: async () => {},
    syncPull: async () => ({ records: [], cursor: 4, hasMore: false }),
    syncCommitPull: async (input) => { if (input.markLocalProfileScope) state = { ...state, localProfileScopeKey: "bob" }; },
  };
  const sync = createContinuousSync({
    api, legacySync: legacy, storage,
    applyPulled: async (records, _deviceId, options) => legacy.applyPulledSnapshot({
      storage, records, profileReplace: options?.profileReplace,
      captureLongTasks: async () => ({ tasks: structuredClone(longTasks), fingerprint: JSON.stringify(longTasks) }),
      createBackup: async (snapshot) => { backups.set("profile-backup", snapshot); return { backupId: "profile-backup" }; },
      writeLongTasks: async (tasks) => { longTasks = structuredClone(tasks); },
      readLongTasks: async () => structuredClone(longTasks),
      restoreBackup: async () => {},
    }),
  });
  await sync.syncOnce();
  const daily = JSON.parse(storage.getItem(legacy.LEGACY_STORAGE_KEYS.dailyTask));
  assert.equal(daily.date, "2026-07-22");
  assert.deepEqual(daily.tasks.map((task) => task.id), ["bob-task"]);
  assert.equal(queued.some((mutation) => mutation.record.entityId === "bob-task" && mutation.record.deleted), false);
  assert.equal(state.localProfileScopeKey, "bob");
  assert.equal(backups.has("profile-backup"), true);
});
