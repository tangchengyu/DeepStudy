const test = require("node:test");
const assert = require("node:assert/strict");

const { resolutionInput, resolveAllConflicts } = require("../renderer/conflict-actions");

test("resolution inputs use stable operation IDs for local and cloud choices", () => {
  const conflict = { id: "conflict-1", remote: { revision: 8 } };
  assert.deepEqual(resolutionInput(conflict, "keep_remote"), {
    resolution: "keep_remote",
    operationId: "desktop:resolve:conflict-1:keep_remote",
  });
  assert.deepEqual(resolutionInput(conflict, "keep_local"), {
    resolution: "keep_local",
    mutationId: "desktop:resolve:conflict-1:keep_local",
    operationId: "desktop:resolve:conflict-1:keep_local",
    expectedRemoteRevision: 8,
  });
});

test("bulk conflict resolution is sequential and keeps partial failures", async () => {
  const conflicts = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const calls = [];
  const progress = [];
  const result = await resolveAllConflicts({
    conflicts,
    resolution: "keep_remote",
    resolve: async (conflict, resolution) => {
      calls.push(`${conflict.id}:start`);
      if (conflict.id === "two") throw new Error("network unavailable");
      calls.push(`${conflict.id}:done`);
      return resolution;
    },
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(calls, ["one:start", "one:done", "two:start", "three:start", "three:done"]);
  assert.deepEqual(result.resolved.map((conflict) => conflict.id), ["one", "three"]);
  assert.deepEqual(result.failed.map(({ conflict, error }) => [conflict.id, error.message]), [["two", "network unavailable"]]);
  assert.deepEqual(progress.map(({ completed, total }) => [completed, total]), [[1, 3], [2, 3], [3, 3]]);
});
