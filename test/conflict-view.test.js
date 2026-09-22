const test = require("node:test");
const assert = require("node:assert/strict");

const { compareRecords, sameUserContent } = require("../renderer/conflict-view");

function record(overrides = {}) {
  return {
    entityType: "reflection",
    entityId: "reflection-1",
    payload: {
      id: "reflection-1",
      content: "same note",
      sourceTaskIds: [],
      updatedAt: 100,
    },
    deleted: false,
    revision: 4,
    clientUpdatedAt: 100,
    serverUpdatedAt: 110,
    deviceId: "desktop-a",
    ...overrides,
  };
}

test("content-identical records ignore synchronization metadata and payload updatedAt", () => {
  const local = record();
  const remote = record({
    payload: { ...local.payload, updatedAt: 200 },
    revision: 9,
    clientUpdatedAt: 200,
    serverUpdatedAt: 220,
    deviceId: "desktop-b",
  });

  assert.equal(sameUserContent(local, remote), true);
  const comparison = compareRecords(local, remote);
  assert.equal(comparison.contentEqual, true);
  assert.deepEqual(comparison.rows, []);
  assert.deepEqual(comparison.metadataRows.map((row) => row.path), [
    "payload.updatedAt",
    "revision",
    "clientUpdatedAt",
    "serverUpdatedAt",
    "deviceId",
  ]);
});

test("nested payload differences are returned as explicit field paths", () => {
  const local = record({
    payload: { ...record().payload, content: "local note", details: { mood: "calm", score: 2 } },
  });
  const remote = record({
    payload: { ...record().payload, content: "cloud note", details: { mood: "calm", score: 3 } },
  });

  const comparison = compareRecords(local, remote);
  assert.equal(comparison.contentEqual, false);
  assert.deepEqual(comparison.rows, [
    { path: "content", local: "local note", remote: "cloud note" },
    { path: "details.score", local: 2, remote: 3 },
  ]);
});

test("deletion and legacy source identity remain meaningful content differences", () => {
  const local = record({ deleted: true, legacySourceId: "legacy-a" });
  const remote = record({ deleted: false, legacySourceId: "legacy-b" });

  assert.equal(sameUserContent(local, remote), false);
  assert.deepEqual(compareRecords(local, remote).rows, [
    { path: "deleted", local: true, remote: false },
    { path: "legacySourceId", local: "legacy-a", remote: "legacy-b" },
  ]);
});
