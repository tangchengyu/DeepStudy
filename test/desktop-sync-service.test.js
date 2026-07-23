const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MODULE_PATH = "../renderer/desktop-sync-service";

async function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepstudy-sync-test-"));
  try {
    return await run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("bearer persistence uses OS encryption and never writes the reusable token", async () => {
  const { createCredentialStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const safeStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "dpapi",
      encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
      decryptString: (value) => value.toString("utf8").replace(/^protected:/, ""),
    };
    const filePath = path.join(directory, "sync-session.json");
    const store = createCredentialStore({ fs, filePath, safeStorage, platform: "win32" });

    const result = store.saveToken("secret-bearer-token");
    assert.equal(result.persistence, "os-encrypted");
    assert.equal(store.loadToken(), "secret-bearer-token");
    assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /secret-bearer-token/);
  });
});

test("insecure or unavailable OS storage degrades to memory-only persistence", async () => {
  const { createCredentialStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const filePath = path.join(directory, "sync-session.json");
    const store = createCredentialStore({
      fs,
      filePath,
      platform: "linux",
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => "basic_text",
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString("utf8"),
      },
    });

    const result = store.saveToken("memory-secret");
    assert.equal(result.persistence, "memory-only");
    assert.equal(store.loadToken(), "memory-secret");
    assert.equal(fs.existsSync(filePath), false);
    assert.match(result.warning, /仅保留在本次运行的内存/);
  });
});

test("credential encryption availability is checked lazily after Electron becomes ready", async () => {
  const { createCredentialStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    let ready = false;
    const store = createCredentialStore({
      fs,
      filePath: path.join(directory, "sync-session.json"),
      platform: "win32",
      safeStorage: {
        isEncryptionAvailable: () => ready,
        encryptString: (value) => Buffer.from(`ready:${value}`),
        decryptString: (value) => value.toString().replace(/^ready:/, ""),
      },
    });
    ready = true;
    assert.equal(store.saveToken("after-ready").persistence, "os-encrypted");
    assert.equal(store.loadToken(), "after-ready");
  });
});

test("durable scoped outbox merges entity edits, retains tombstones, and survives a restart", async () => {
  const { createStateStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const filePath = path.join(directory, "sync-device.json");
    const first = createStateStore({ fs, filePath, createDeviceId: () => "desktop-durable-device" });
    const scope = first.activateScope({ gatewayUrl: "https://gateway.example/", username: "Alice" });
    first.queueMutations(scope.scopeKey, [{
      mutationId: "desktop:one",
      baseRevision: 4,
      record: { entityType: "long_task", entityId: "task-1", payload: { id: "task-1", title: "first" }, deleted: false },
    }]);
    first.queueMutations(scope.scopeKey, [{
      mutationId: "desktop:two",
      baseRevision: 4,
      record: { entityType: "long_task", entityId: "task-1", payload: { id: "task-1", title: "second" }, deleted: false },
    }]);
    first.queueMutations(scope.scopeKey, [{
      mutationId: "desktop:delete",
      baseRevision: 4,
      record: { entityType: "long_task", entityId: "task-1", payload: { id: "task-1" }, deleted: true },
    }]);

    const restarted = createStateStore({ fs, filePath, createDeviceId: () => "unexpected-device" });
    const state = restarted.readScope(scope.scopeKey);
    assert.equal(state.outbox.length, 1);
    assert.equal(state.outbox[0].mutationId, "desktop:delete");
    assert.equal(state.outbox[0].record.deleted, true);
    assert.equal(state.outbox[0].baseRevision, 4);
  });
});

test("outbox records and cursors are isolated by normalized gateway origin and account", async () => {
  const { createStateStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const store = createStateStore({ fs, filePath: path.join(directory, "sync-device.json"), createDeviceId: () => "desktop-isolated-device" });
    const alice = store.activateScope({ gatewayUrl: "https://gateway.example/", username: "Alice" });
    store.queueMutations(alice.scopeKey, [{
      mutationId: "desktop:alice",
      baseRevision: 0,
      record: { entityType: "reflection", entityId: "r1", payload: { id: "r1" }, deleted: false },
    }]);
    store.updateScope(alice.scopeKey, { cursor: 19 });
    const bob = store.activateScope({ gatewayUrl: "https://gateway.example", username: "Bob" });
    assert.notEqual(alice.scopeKey, bob.scopeKey);
    assert.equal(store.readScope(bob.scopeKey).outbox.length, 0);
    assert.equal(store.readScope(bob.scopeKey).cursor, 0);
    assert.equal(store.readScope(alice.scopeKey).outbox.length, 1);
    assert.equal(store.readScope(alice.scopeKey).cursor, 19);
  });
});

test("corrupt primary sync state restores complete scoped data from the verified backup", async () => {
  const { createStateStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const filePath = path.join(directory, "sync-device.json");
    const store = createStateStore({ fs, filePath, createDeviceId: () => "desktop-backup-device" });
    const scope = store.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    store.queueMutations(scope.scopeKey, [{ mutationId: "desktop:backup", baseRevision: 2, record: { entityType: "reflection", entityId: "r1", payload: { id: "r1" }, deleted: false } }]);
    store.updateScope(scope.scopeKey, { cursor: 9, pendingImport: { importId: "import-1", snapshotHash: "hash", nextIndex: 2 } });
    fs.writeFileSync(filePath, "{broken", "utf8");
    const restored = createStateStore({ fs, filePath, createDeviceId: () => "unexpected-device" });
    const recoveredScope = restored.readScope(scope.scopeKey);
    assert.equal(recoveredScope.cursor, 9);
    assert.equal(recoveredScope.outbox[0].mutationId, "desktop:backup");
    assert.equal(recoveredScope.pendingImport.nextIndex, 2);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(filePath, "utf8")));
  });
});

test("backup recovery keeps the verified backup and recovered state when primary promotion is interrupted", async () => {
  const { createStateStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const filePath = path.join(directory, "sync-device.json");
    const store = createStateStore({ fs, filePath, createDeviceId: () => "desktop-recovery-device" });
    const alice = store.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    store.updateScope(alice.scopeKey, { cursor: 17 });
    fs.writeFileSync(filePath, "{corrupt-primary", "utf8");
    const interruptedFs = Object.create(fs);
    interruptedFs.renameSync = () => { throw Object.assign(new Error("simulated crash"), { code: "EACCES" }); };
    const recovered = createStateStore({ fs: interruptedFs, filePath, createDeviceId: () => "unexpected-device" });
    assert.equal(recovered.readScope(alice.scopeKey).cursor, 17);
    assert.equal(JSON.parse(fs.readFileSync(`${filePath}.bak`, "utf8")).scopes[alice.scopeKey].cursor, 17);
  });
});

test("two-phase pull commits cursor and known records atomically only for the captured scope", async () => {
  const { createStateStore } = require(MODULE_PATH);
  await withTempDir((directory) => {
    const store = createStateStore({ fs, filePath: path.join(directory, "sync-device.json"), createDeviceId: () => "desktop-pull-device" });
    const alice = store.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    store.commitPull({ scopeKey: alice.scopeKey, expectedOldCursor: 0, newCursor: 4, records: [{ entityType: "reflection", entityId: "r1", payload: { id: "r1" }, deleted: false, revision: 3 }] });
    assert.equal(store.readScope(alice.scopeKey).cursor, 4);
    assert.equal(store.readScope(alice.scopeKey).revisions["reflection\u0000r1"], 3);
    store.activateScope({ gatewayUrl: "https://gateway.example", username: "bob" });
    assert.throws(() => store.commitPull({ scopeKey: alice.scopeKey, expectedOldCursor: 4, newCursor: 5, records: [] }), /账号已切换/);
  });
});

test("an in-flight account A push never commits through account B scope or token", async () => {
  const { createCredentialStore, createDesktopSyncService, createStateStore } = require(MODULE_PATH);
  await withTempDir(async (directory) => {
    const stateStore = createStateStore({ fs, filePath: path.join(directory, "state.json"), createDeviceId: () => "desktop-race-device" });
    const credentialStore = createCredentialStore({ fs, filePath: path.join(directory, "token.json"), platform: "linux", safeStorage: { isEncryptionAvailable: () => false } });
    const alice = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    credentialStore.saveToken("token-a", alice.scopeKey);
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let authorization;
    const service = createDesktopSyncService({
      credentialStore, stateStore,
      fetch: async (_url, init) => { authorization = init.headers.Authorization; await waiting; return Response.json({ results: [] }); },
    });
    const binding = { expectedScopeKey: alice.scopeKey, expectedAuthGeneration: stateStore.read().authGeneration };
    const request = service.push([], binding);
    await Promise.resolve();
    stateStore.update({ activeScopeKey: "", authGeneration: stateStore.read().authGeneration + 1 });
    credentialStore.clearToken();
    const bob = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "bob" });
    credentialStore.saveToken("token-b", bob.scopeKey);
    release();
    await assert.rejects(request, (error) => error.code === "SCOPE_CHANGED");
    assert.equal(authorization, "Bearer token-a");
  });
});

test("a late account A unauthorized response cannot clear account B credentials", async () => {
  const { createCredentialStore, createDesktopSyncService, createStateStore } = require(MODULE_PATH);
  await withTempDir(async (directory) => {
    const stateStore = createStateStore({ fs, filePath: path.join(directory, "state.json"), createDeviceId: () => "desktop-401-device" });
    const credentialStore = createCredentialStore({ fs, filePath: path.join(directory, "token.json"), platform: "linux", safeStorage: { isEncryptionAvailable: () => false } });
    const alice = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    credentialStore.saveToken("token-a", alice.scopeKey);
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const service = createDesktopSyncService({
      credentialStore, stateStore,
      fetch: async () => { await waiting; return Response.json({ error: "UNAUTHORIZED" }, { status: 401 }); },
    });
    const pending = service.session();
    await Promise.resolve();
    stateStore.update({ activeScopeKey: "", username: "", authGeneration: stateStore.read().authGeneration + 1 });
    credentialStore.clearToken();
    const bob = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "bob" });
    credentialStore.saveToken("token-b", bob.scopeKey);
    release();
    await assert.rejects(pending);
    assert.equal(stateStore.read().activeScopeKey, bob.scopeKey);
    assert.equal(credentialStore.loadToken(), "token-b");
  });
});

test("sign-out and a new sign-in are serialized so the older cleanup cannot erase the new session", async () => {
  const { createCredentialStore, createDesktopSyncService, createStateStore } = require(MODULE_PATH);
  await withTempDir(async (directory) => {
    const stateStore = createStateStore({ fs, filePath: path.join(directory, "state.json"), createDeviceId: () => "desktop-auth-lock" });
    const credentialStore = createCredentialStore({ fs, filePath: path.join(directory, "token.json"), platform: "linux", safeStorage: { isEncryptionAvailable: () => false } });
    const alice = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    credentialStore.saveToken("token-a", alice.scopeKey);
    let releaseSignOut;
    const waiting = new Promise((resolve) => { releaseSignOut = resolve; });
    const routes = [];
    const service = createDesktopSyncService({
      credentialStore, stateStore,
      fetch: async (url) => {
        const route = new URL(url).pathname;
        routes.push(route);
        if (route === "/api/auth/sign-out") { await waiting; return Response.json({ ok: true }); }
        if (route === "/v1/auth/sign-in") return new Response(JSON.stringify({ user: { username: "bob" } }), { headers: { "set-auth-token": "token-b" } });
        throw new Error(`unexpected ${route}`);
      },
    });
    const signingOut = service.signOut();
    await Promise.resolve();
    const signingIn = service.signIn({ gatewayUrl: "https://gateway.example", username: "bob", password: "long-enough-password", turnstileToken: "ok" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(routes, ["/api/auth/sign-out"]);
    releaseSignOut();
    await signingOut;
    await signingIn;
    assert.equal(stateStore.read().username, "bob");
    assert.equal(credentialStore.loadToken(), "token-b");
  });
});

test("gateway enrollment keeps bearer tokens behind the main-process interface", async () => {
  const { createDesktopSyncService } = require(MODULE_PATH);
  const requests = [];
  let storedToken = "";
  const credentialStore = {
    saveToken(value) { storedToken = value; return { persistence: "os-encrypted", warning: "" }; },
    loadToken() { return storedToken; },
    clearToken() { storedToken = ""; },
    securityStatus() { return { persistence: "os-encrypted", warning: "" }; },
  };
  const state = { gatewayUrl: "", deviceId: "desktop-test-device", username: "", cursor: 42 };
  const stateStore = {
    read: () => ({ ...state }),
    update: (patch) => Object.assign(state, patch),
  };
  const fakeFetch = async (url, init = {}) => {
    requests.push({ url, init });
    const pathname = new URL(url).pathname;
    if (pathname === "/v1/auth/register") {
      return new Response(JSON.stringify({ user: { username: "alice" }, recoveryCode: "recover-once" }), {
        status: 200,
        headers: { "content-type": "application/json", "set-auth-token": "server-bearer" },
      });
    }
    if (pathname === "/v1/auth/session") {
      return Response.json({ user: { id: "user-1", username: "alice", email: "hidden@example.invalid" } });
    }
    if (pathname === "/api/auth/sign-out") return Response.json({ success: true });
    throw new Error(`Unexpected request: ${pathname}`);
  };
  const service = createDesktopSyncService({ fetch: fakeFetch, credentialStore, stateStore });

  const registration = await service.register({
    gatewayUrl: "https://gateway.example",
    username: "alice",
    password: "correct horse battery staple",
    turnstileToken: "challenge",
  });
  assert.equal(registration.recoveryCode, "recover-once");
  assert.equal("token" in registration, false);
  assert.equal("email" in registration.user, false);
  assert.equal(storedToken, "server-bearer");

  const session = await service.session();
  assert.deepEqual(session.user, { id: "user-1", username: "alice" });
  assert.equal(requests[1].init.headers.Authorization, "Bearer server-bearer");
  assert.equal(requests[1].init.headers["X-Device-Id"], "desktop-test-device");
  assert.equal(JSON.stringify(session).includes("server-bearer"), false);

  await service.signOut();
  assert.equal(storedToken, "");
  assert.equal(state.cursor, 0);
});

test("gateway client requires an explicit takeover flag and uses the conflict-resolution contract", async () => {
  const { createDesktopSyncService } = require(MODULE_PATH);
  const requests = [];
  const service = createDesktopSyncService({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({ ok: true });
    },
    credentialStore: {
      loadToken: () => "token",
      saveToken: () => ({ persistence: "memory-only", warning: "" }),
      clearToken() {},
      securityStatus: () => ({ persistence: "memory-only", warning: "" }),
    },
    stateStore: {
      read: () => ({ gatewayUrl: "https://gateway.example", deviceId: "desktop-device-8", username: "alice" }),
      update() {},
    },
  });

  await assert.rejects(
    service.claimTimer({ mode: "focus", status: "running", plannedMs: 1500000, takeover: "yes" }),
    /“接管并继续”/,
  );
  await service.claimTimer({
    mode: "focus",
    status: "running",
    plannedMs: 1500000,
    remainingMs: 1200000,
    expectedLeaseVersion: 4,
    takeover: true,
  });
  await service.resolveConflict("conflict-1", {
    resolution: "keep_local",
    mutationId: "desktop:conflict:0001",
    expectedRemoteRevision: 3,
  });

  assert.deepEqual(JSON.parse(requests[0].init.body), {
    mode: "focus",
    status: "running",
    plannedMs: 1500000,
    remainingMs: 1200000,
    expectedLeaseVersion: 4,
    takeover: true,
  });
  assert.match(requests[1].url, /\/v1\/sync\/conflicts\/conflict-1\/resolve$/);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    resolution: "keep_local",
    mutationId: "desktop:conflict:0001",
    expectedRemoteRevision: 3,
  });
});

test("keeping a local conflict discards the deferred stale remote record", async () => {
  const { createCredentialStore, createDesktopSyncService, createStateStore } = require(MODULE_PATH);
  await withTempDir(async (directory) => {
    const stateStore = createStateStore({ fs, filePath: path.join(directory, "state.json"), createDeviceId: () => "desktop-conflict-device" });
    const credentialStore = createCredentialStore({ fs, filePath: path.join(directory, "token.json"), platform: "linux", safeStorage: { isEncryptionAvailable: () => false } });
    const account = stateStore.activateScope({ gatewayUrl: "https://gateway.example", username: "alice" });
    credentialStore.saveToken("token", account.scopeKey);
    const localRecord = { entityType: "long_task", entityId: "task-1", payload: { id: "task-1", title: "local" }, deleted: false, revision: 1 };
    stateStore.updateScope(account.scopeKey, {
      outbox: [{ mutationId: "local-mutation", baseRevision: 1, blocked: true, conflictId: "conflict-1", record: localRecord }],
      deferredPullRecords: [{ ...localRecord, payload: { id: "task-1", title: "stale remote" }, revision: 2 }],
    });
    const service = createDesktopSyncService({
      credentialStore, stateStore,
      fetch: async () => Response.json({ ok: true, resolution: "keep_local", result: { revision: 3, serverUpdatedAt: 20 } }),
    });
    await service.resolveConflict("conflict-1", {
      resolution: "keep_local", mutationId: "resolve-1", operationId: "resolve-1", expectedRemoteRevision: 2,
    });
    const scope = stateStore.readScope(account.scopeKey);
    assert.equal(scope.outbox.length, 0);
    assert.deepEqual(scope.deferredPullRecords, []);
    assert.equal(scope.records["long_task\u0000task-1"].payload.title, "local");
    assert.equal(scope.records["long_task\u0000task-1"].revision, 3);
  });
});

test("legacy backup stores original long-task bytes and can restore the test profile", async () => {
  const { createLegacyBackupStore } = require(MODULE_PATH);
  await withTempDir(async (directory) => {
    const longTasksFilePath = path.join(directory, "long-tasks.json");
    const original = '{\n  "version": 1,\n  "unknownTopLevel": "keep",\n  "tasks": [{"id":"old","notes":"a\\nb"}]\n}\n';
    fs.writeFileSync(longTasksFilePath, original, "utf8");
    const backups = createLegacyBackupStore({ fs, userDataPath: directory, longTasksFilePath });
    const captured = backups.captureLongTasks();

    const result = backups.createBackup({
      version: 1,
      localStores: { "mytimer.dailyPlan.v1": "{\"date\":\"2026-07-23\",\"tasks\":[]}" },
      longTasksFingerprint: captured.fingerprint,
    });
    assert.match(result.backupId, /^[A-Za-z0-9._-]+$/);
    const backupDirectory = path.join(directory, "sync-backups", result.backupId);
    assert.equal(fs.readFileSync(path.join(backupDirectory, "long-tasks.json"), "utf8"), original);

    assert.throws(() => backups.writeLongTasks([{ id: "unsafe" }]), /备份编号/);
    fs.writeFileSync(longTasksFilePath, JSON.stringify({ version: 1, tasks: [{ id: "edited-after-backup" }] }), "utf8");
    assert.throws(
      () => backups.writeLongTasks([{ id: "would-overwrite" }], result.backupId),
      /备份后发生变化/,
    );
    assert.equal(JSON.parse(fs.readFileSync(longTasksFilePath, "utf8")).tasks[0].id, "edited-after-backup");
    fs.writeFileSync(longTasksFilePath, original, "utf8");
    backups.writeLongTasks([{ id: "new", notes: "new\nline", plannedAt: 9 }], result.backupId);
    const changed = JSON.parse(fs.readFileSync(longTasksFilePath, "utf8"));
    assert.equal(changed.unknownTopLevel, "keep");
    assert.equal(changed.tasks[0].notes, "new\nline");

    const restored = backups.restoreBackup(result.backupId);
    assert.equal(restored.localStores["mytimer.dailyPlan.v1"], '{"date":"2026-07-23","tasks":[]}');
    assert.equal(fs.readFileSync(longTasksFilePath, "utf8"), original);
  });
});
