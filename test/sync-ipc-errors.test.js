const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("preload preserves sync retry metadata across an IPC failure", async () => {
  let api;
  const failure = { message: "今日额度已用完", code: "SYNC_DAILY_READ_LIMIT", status: 503, retryAfterSeconds: 1200, details: { nextIndex: 5 } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../preload.js"), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld(_name, value) { api = value; } },
      ipcRenderer: { invoke: async () => ({ __deepStudySyncError: failure }) }
    })
  });
  await assert.rejects(api.syncSession(), (error) => {
    assert.equal(error.code, failure.code);
    assert.equal(error.status, 503);
    assert.equal(error.retryAfterSeconds, 1200);
    assert.equal(error.details.nextIndex, 5);
    return true;
  });
});

test("main sync error envelope contains retry details without stack internals", async () => {
  const { withSyncError } = require("../renderer/sync-ipc-result");
  const failure = Object.assign(new Error("temporary failure"), {
    code: "SYNC_DAILY_WRITE_LIMIT", status: 503, details: { retryAfterSeconds: 60, nextIndex: 5 }
  });
  const wrapped = withSyncError(async () => { throw failure; });
  const response = await wrapped();
  assert.equal(response.__deepStudySyncError.code, failure.code);
  assert.equal(response.__deepStudySyncError.retryAfterSeconds, 60);
  assert.equal(response.__deepStudySyncError.details.nextIndex, 5);
  assert.equal(response.__deepStudySyncError.stack, undefined);
  const successful = withSyncError(async (_event, value) => ({ value }));
  assert.deepEqual(await successful(null, 42), { value: 42 });
});
