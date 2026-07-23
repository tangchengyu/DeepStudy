const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_STORAGE_KEYS,
  collectConsistentSnapshot,
  applyPulledSnapshot,
  buildLegacyRecords,
} = require("../renderer/legacy-sync");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem(key, value) { writes.push({ key, value }); values.set(key, value); },
    removeItem(key) { writes.push({ key, removed: true }); values.delete(key); },
    values,
    writes,
  };
}

function emptyStores() {
  return {
    [LEGACY_STORAGE_KEYS.dailyTask]: JSON.stringify({ date: "2026-07-23", tasks: [] }),
    [LEGACY_STORAGE_KEYS.focusSession]: "[]",
    [LEGACY_STORAGE_KEYS.modeEvent]: "[]",
    [LEGACY_STORAGE_KEYS.timeAudit]: "[]",
    [LEGACY_STORAGE_KEYS.distraction]: "[]",
    [LEGACY_STORAGE_KEYS.reflection]: "[]",
  };
}

test("consistent legacy snapshot retries concurrent changes and preserves every task field", async () => {
  const stores = emptyStores();
  stores[LEGACY_STORAGE_KEYS.dailyTask] = JSON.stringify({
    date: "2026-07-23",
    tasks: [{ id: "today-1", text: "Today", customToday: { keep: true } }],
  });
  const storage = memoryStorage(stores);
  let dailyReads = 0;
  const originalGet = storage.getItem;
  storage.getItem = (key) => {
    const value = originalGet(key);
    if (key === LEGACY_STORAGE_KEYS.dailyTask && ++dailyReads === 2) {
      const changed = JSON.stringify({ date: "2026-07-23", tasks: [{ id: "today-2", text: "Changed" }] });
      storage.values.set(key, changed);
      return changed;
    }
    return value;
  };
  let captures = 0;
  const longTask = {
    id: "long-旧-id",
    title: "长期目标",
    notes: "第一行\n第二行\n\n第四行",
    plannedAt: 1720000123456,
    unknownLegacyField: { nested: [1, "二", null] },
  };

  const snapshot = await collectConsistentSnapshot({
    storage,
    deviceId: "desktop-device-test",
    captureLongTasks: async () => ({ tasks: [longTask], fingerprint: `file-${++captures}` }),
    verifyLongTasks: async (fingerprint) => ({ unchanged: fingerprint === `file-${captures}` }),
    maxAttempts: 3,
  });

  assert.equal(captures, 2);
  assert.equal(storage.writes.length, 0);
  const savedLongTask = snapshot.records.find((record) => record.entityType === "long_task");
  assert.equal(savedLongTask.entityId, "long-旧-id");
  assert.deepEqual(savedLongTask.payload, longTask);
  assert.equal(savedLongTask.payload.notes, "第一行\n第二行\n\n第四行");
  assert.equal(savedLongTask.payload.plannedAt, 1720000123456);
  const daily = snapshot.records.find((record) => record.entityType === "daily_task");
  assert.equal(daily.entityId, "today-2");
  assert.deepEqual(daily.payload.customToday, undefined);
});

test("pulled records are backed up before writes, verified, and leave original keys intact", async () => {
  const stores = emptyStores();
  stores[LEGACY_STORAGE_KEYS.reflection] = JSON.stringify([
    { id: "reflection-local", content: "local", unknown: 7 },
  ]);
  const storage = memoryStorage(stores);
  const longTasks = [{ id: "long-1", title: "old", notes: "旧\n备注", plannedAt: 11 }];
  const events = [];
  let currentLongTasks = structuredClone(longTasks);
  const records = [
    {
      entityType: "long_task",
      entityId: "long-1",
      payload: { id: "long-1", title: "new", notes: "新\n备注", plannedAt: 22, unknown: { kept: true } },
      deleted: false,
      revision: 2,
      clientUpdatedAt: 22,
      serverUpdatedAt: 23,
      deviceId: "phone-1",
    },
    {
      entityType: "reflection",
      entityId: "reflection-remote",
      payload: { id: "reflection-remote", content: "remote\nline 2", extra: "kept" },
      deleted: false,
      revision: 1,
      clientUpdatedAt: 20,
      serverUpdatedAt: 21,
      deviceId: "phone-1",
    },
  ];

  const result = await applyPulledSnapshot({
    storage,
    records,
    captureLongTasks: async () => ({ tasks: structuredClone(currentLongTasks), fingerprint: "before" }),
    createBackup: async (snapshot) => {
      events.push("backup");
      assert.deepEqual(Object.keys(snapshot.localStores).sort(), Object.values(LEGACY_STORAGE_KEYS).sort());
      assert.deepEqual(snapshot.longTasks, longTasks);
      return { backupId: "backup-1" };
    },
    writeLongTasks: async (tasks) => { events.push("long-write"); currentLongTasks = structuredClone(tasks); },
    readLongTasks: async () => structuredClone(currentLongTasks),
    restoreBackup: async () => { events.push("restore"); },
  });

  assert.equal(result.backupId, "backup-1");
  assert.equal(events[0], "backup");
  assert.equal(storage.writes.length, 6);
  assert.deepEqual(currentLongTasks[0], records[0].payload);
  const reflections = JSON.parse(storage.getItem(LEGACY_STORAGE_KEYS.reflection));
  assert.deepEqual(reflections.find((item) => item.id === "reflection-local"), {
    id: "reflection-local", content: "local", unknown: 7,
  });
  assert.deepEqual(reflections.find((item) => item.id === "reflection-remote"), records[1].payload);
});

test("failed readback restores all LocalStorage values and the durable backup", async () => {
  const stores = emptyStores();
  const storage = memoryStorage(stores);
  let restored = false;
  await assert.rejects(applyPulledSnapshot({
    storage,
    records: [],
    captureLongTasks: async () => ({ tasks: [], fingerprint: "before" }),
    createBackup: async () => ({ backupId: "backup-rollback" }),
    writeLongTasks: async () => {},
    readLongTasks: async () => [{ id: "unexpected" }],
    restoreBackup: async (backupId) => { restored = backupId === "backup-rollback"; },
  }), /读取校验失败/);
  assert.equal(restored, true);
  for (const [key, raw] of Object.entries(stores)) assert.equal(storage.getItem(key), raw);
});

test("oversized legacy IDs remain in payload while their envelope IDs satisfy the shared contract", async () => {
  const originalId = `old-${"x".repeat(240)}`;
  const records = buildLegacyRecords({
    rawStores: emptyStores(),
    longTasks: [{ id: originalId, title: "old task", notes: "keep\nlines" }],
    deviceId: "desktop-device-test",
  });
  const { validateRecord, MAX_ENTITY_ID_LENGTH } = await import("../packages/sync-contract/index.js");
  assert.equal(records[0].payload.id, originalId);
  assert.ok(records[0].entityId.length <= MAX_ENTITY_ID_LENGTH);
  assert.notEqual(records[0].entityId, originalId);
  assert.equal(validateRecord(records[0]).valid, true);
});

test("oversized, missing, and duplicate legacy IDs round-trip without duplication or rewriting", async () => {
  const original = [
    { id: `old-${"x".repeat(240)}`, title: "oversized", notes: "a\nb" },
    { title: "missing id", unknown: true },
    { id: "same", title: "duplicate one" },
    { id: "same", title: "duplicate two" },
  ];
  const records = buildLegacyRecords({
    rawStores: emptyStores(),
    longTasks: original,
    deviceId: "desktop-device-test",
  }).filter((item) => item.entityType === "long_task");
  const storage = memoryStorage(emptyStores());
  let written;
  await applyPulledSnapshot({
    storage,
    records: records.map((item) => ({ ...item, revision: 1, serverUpdatedAt: 10 })),
    captureLongTasks: async () => ({ tasks: structuredClone(original), fingerprint: "same" }),
    createBackup: async () => ({ backupId: "backup-roundtrip" }),
    writeLongTasks: async (tasks) => { written = structuredClone(tasks); },
    readLongTasks: async () => structuredClone(written),
    restoreBackup: async () => {},
  });
  assert.deepEqual(written, original);
});

test("a LocalStorage change after backup aborts before any local value is overwritten", async () => {
  const stores = emptyStores();
  const storage = memoryStorage(stores);
  let restoreCalls = 0;
  await assert.rejects(applyPulledSnapshot({
    storage,
    records: [],
    captureLongTasks: async () => ({ tasks: [], fingerprint: "same" }),
    createBackup: async () => {
      storage.values.set(LEGACY_STORAGE_KEYS.reflection, JSON.stringify([{ id: "new-during-sync" }]));
      return { backupId: "backup-race" };
    },
    writeLongTasks: async () => [],
    readLongTasks: async () => [],
    restoreBackup: async () => { restoreCalls += 1; },
  }), /备份后发生变化/);
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_STORAGE_KEYS.reflection)), [{ id: "new-during-sync" }]);
  assert.equal(restoreCalls, 0);
});

test("account profile replacement adopts the target account daily date instead of filtering it through the previous account date", () => {
  const { planPulledWrites, LEGACY_STORAGE_KEYS } = require("../renderer/legacy-sync");
  const rawStores = Object.fromEntries(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, key === LEGACY_STORAGE_KEYS.dailyTask
    ? JSON.stringify({ date: "2026-07-23", tasks: [{ id: "alice-task", text: "Alice" }] })
    : JSON.stringify([])]));
  const bob = {
    entityType: "daily_task",
    entityId: "bob-task",
    payload: { id: "bob-task", text: "Bob", done: false },
    deleted: false,
    legacySourceId: `${LEGACY_STORAGE_KEYS.dailyTask}|date=2026-07-22`,
  };
  const planned = planPulledWrites({ rawStores, longTasks: [], records: [bob], profileReplace: true });
  const daily = JSON.parse(planned.localStores[LEGACY_STORAGE_KEYS.dailyTask]);
  assert.equal(daily.date, "2026-07-22");
  assert.deepEqual(daily.tasks, [bob.payload]);
});
