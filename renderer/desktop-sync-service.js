const path = require("node:path");
const crypto = require("node:crypto");

const MEMORY_ONLY_WARNING = "当前系统没有可用的安全凭据存储，登录令牌仅保留在本次运行的内存中，退出软件后需要重新登录。";
const DEFAULT_GATEWAY_URL = "https://deepstudy-gateway.jackbreese585.workers.dev";

function canPersistSecurely(safeStorage, platform) {
  if (!safeStorage?.isEncryptionAvailable?.()) return false;
  if (platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false;
  return typeof safeStorage.encryptString === "function"
    && typeof safeStorage.decryptString === "function";
}

function atomicWriteJson(fs, filePath, value, { preserveExistingBackup = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const backup = `${filePath}.bak`;
  const serialized = JSON.stringify(value, null, 2);
  if (!preserveExistingBackup && fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);
  fs.writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  if (fs.readFileSync(temporary, "utf8") !== serialized) throw new Error("同步状态临时写入读取校验失败。");
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporary, filePath);
    } catch (replacementError) {
      if (fs.existsSync(backup)) {
        try { fs.copyFileSync(backup, filePath); } catch {}
      }
      throw replacementError;
    }
  }
  if (fs.readFileSync(filePath, "utf8") !== serialized) {
    if (fs.existsSync(backup)) fs.copyFileSync(backup, filePath);
    throw new Error("同步状态写入读取校验失败，已恢复备份。");
  }
  fs.copyFileSync(filePath, backup);
}

function createCredentialStore({ fs, filePath, safeStorage, platform = process.platform }) {
  let memoryToken = "";
  let memoryScopeKey = "";
  const securePersistence = () => canPersistSecurely(safeStorage, platform);

  return {
    securityStatus() {
      return securePersistence()
        ? { persistence: "os-encrypted", warning: "" }
        : { persistence: "memory-only", warning: MEMORY_ONLY_WARNING };
    },
    saveToken(token, scopeKey = "") {
      memoryToken = typeof token === "string" ? token : "";
      memoryScopeKey = String(scopeKey || "");
      if (!memoryToken) throw new TypeError("Bearer token must be a non-empty string.");
      if (!securePersistence()) {
        fs.rmSync(filePath, { force: true });
        fs.rmSync(`${filePath}.bak`, { force: true });
        return { persistence: "memory-only", warning: MEMORY_ONLY_WARNING };
      }
      const encryptedToken = safeStorage.encryptString(memoryToken).toString("base64");
      atomicWriteJson(fs, filePath, { version: 2, encryptedToken, scopeKey: memoryScopeKey });
      return { persistence: "os-encrypted", warning: "" };
    },
    loadToken() {
      if (memoryToken) return memoryToken;
      if (!securePersistence()) return "";
      try {
        const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (![1, 2].includes(stored?.version) || typeof stored.encryptedToken !== "string") return "";
        memoryToken = safeStorage.decryptString(Buffer.from(stored.encryptedToken, "base64"));
        memoryScopeKey = stored.version === 2 ? String(stored.scopeKey || "") : "";
        return memoryToken;
      } catch {
        return "";
      }
    },
    clearToken() {
      memoryToken = "";
      memoryScopeKey = "";
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}.bak`, { force: true });
    },
    scopeKey() {
      this.loadToken();
      return memoryScopeKey;
    },
  };
}

function createStateStore({ fs, filePath, createDeviceId = () => `desktop-${crypto.randomUUID()}` }) {
  function defaults() {
    return {
      version: 2,
      gatewayUrl: DEFAULT_GATEWAY_URL,
      deviceId: createDeviceId(),
      username: "",
      cursor: 0,
      activeScopeKey: "",
      authGeneration: 0,
      localProfileScopeKey: "",
      scopes: {},
    };
  }
  function scopeKeyFor({ gatewayUrl, username }) {
    const gatewayOrigin = new URL(normalizeGatewayUrl(gatewayUrl)).origin;
    const account = String(username || "").trim().toLocaleLowerCase();
    if (!account) throw new TypeError("同步账号不能为空。");
    return `${gatewayOrigin}\u0000${account}`;
  }
  function defaultScope(scopeKey, gatewayUrl = "", username = "") {
    return {
      scopeKey,
      gatewayOrigin: gatewayUrl ? new URL(normalizeGatewayUrl(gatewayUrl)).origin : "",
      username: String(username || "").trim(),
      cursor: 0,
      enrolled: false,
      outbox: [],
      revisions: {},
      records: {},
      deferredPullRecords: [],
    };
  }
  function rebindPendingMutationDeviceIds(state) {
    const deviceId = typeof state?.deviceId === "string" ? state.deviceId : "";
    if (deviceId.length < 8 || !state?.scopes || typeof state.scopes !== "object") return state;
    let changed = false;
    const scopes = {};
    for (const [scopeKey, scope] of Object.entries(state.scopes)) {
      const outbox = Array.isArray(scope?.outbox) ? scope.outbox : null;
      if (!outbox) {
        scopes[scopeKey] = scope;
        continue;
      }
      const reboundOutbox = outbox.map((mutation) => {
        if (!mutation?.record || typeof mutation.record !== "object"
          || mutation.record.deviceId === deviceId) return mutation;
        changed = true;
        return { ...mutation, record: { ...mutation.record, deviceId } };
      });
      scopes[scopeKey] = changed ? { ...scope, outbox: reboundOutbox } : scope;
    }
    return changed ? { ...state, scopes } : state;
  }
  let cached;
  function parseState(target) {
    const stored = JSON.parse(fs.readFileSync(target, "utf8"));
    if (!stored || typeof stored !== "object" || Array.isArray(stored)
      || (stored.scopes != null && (typeof stored.scopes !== "object" || Array.isArray(stored.scopes)))) {
      throw new TypeError("Invalid sync state.");
    }
    const state = {
      ...defaults(),
      ...stored,
      scopes: stored.scopes || {},
      authGeneration: Math.max(0, Math.trunc(Number(stored.authGeneration) || 0)),
      deviceId: typeof stored.deviceId === "string" && stored.deviceId.length >= 8
        ? stored.deviceId
        : createDeviceId(),
    };
    if (!state.gatewayUrl) state.gatewayUrl = DEFAULT_GATEWAY_URL;
    return state;
  }
  function read() {
    if (cached) return { ...cached };
    try {
      const parsed = parseState(filePath);
      cached = rebindPendingMutationDeviceIds(parsed);
      if (cached !== parsed) atomicWriteJson(fs, filePath, cached);
    } catch {
      try {
        const parsed = parseState(`${filePath}.bak`);
        cached = rebindPendingMutationDeviceIds(parsed);
        // Promotion is best-effort. The verified backup remains authoritative if
        // the process or filesystem fails while replacing a corrupt primary.
        try { atomicWriteJson(fs, filePath, cached, { preserveExistingBackup: true }); } catch {}
      } catch {
        cached = defaults();
      }
    }
    return { ...cached };
  }
  function update(patch) {
    cached = { ...read(), ...patch };
    atomicWriteJson(fs, filePath, cached);
    return { ...cached };
  }
  function readScope(scopeKey) {
    const state = read();
    const scope = state.scopes?.[scopeKey];
    if (!scope) return defaultScope(scopeKey);
    return {
      ...defaultScope(scopeKey, scope.gatewayOrigin, scope.username),
      ...scope,
      outbox: Array.isArray(scope.outbox) ? scope.outbox : [],
      revisions: scope.revisions && typeof scope.revisions === "object" ? scope.revisions : {},
      records: scope.records && typeof scope.records === "object" ? scope.records : {},
      deferredPullRecords: Array.isArray(scope.deferredPullRecords) ? scope.deferredPullRecords : [],
    };
  }
  function updateScope(scopeKey, patch) {
    const state = read();
    const nextScope = { ...readScope(scopeKey), ...patch };
    const scopes = { ...(state.scopes || {}), [scopeKey]: nextScope };
    return update({ scopes });
  }
  function activateScope({ gatewayUrl, username }) {
    const normalizedGatewayUrl = normalizeGatewayUrl(gatewayUrl);
    const scopeKey = scopeKeyFor({ gatewayUrl: normalizedGatewayUrl, username });
    const scope = readScope(scopeKey);
    updateScope(scopeKey, {
      ...scope,
      scopeKey,
      gatewayOrigin: new URL(normalizedGatewayUrl).origin,
      username: String(username).trim(),
    });
    update({ gatewayUrl: normalizedGatewayUrl, username: String(username).trim(), cursor: scope.cursor, activeScopeKey: scopeKey });
    return { scopeKey, ...readScope(scopeKey) };
  }
  function queueMutations(scopeKey, mutations) {
    const scope = readScope(scopeKey);
    const byIdentity = new Map(scope.outbox.map((mutation) => [
      `${mutation?.record?.entityType}\u0000${mutation?.record?.entityId}`,
      mutation,
    ]));
    for (const mutation of Array.isArray(mutations) ? mutations : []) {
      if (!mutation?.mutationId || !mutation?.record?.entityType || !mutation?.record?.entityId) {
        throw new TypeError("同步变更格式无效。");
      }
      const identity = `${mutation.record.entityType}\u0000${mutation.record.entityId}`;
      const previous = byIdentity.get(identity);
      // An edit following an unsent edit keeps the original base revision; a deletion
      // replaces the edit rather than being accidentally discarded as a no-op.
      byIdentity.set(identity, {
        ...mutation,
        baseRevision: previous ? previous.baseRevision : mutation.baseRevision,
      });
    }
    updateScope(scopeKey, { outbox: [...byIdentity.values()] });
    return readScope(scopeKey).outbox;
  }
  function removeMutations(scopeKey, mutationIds) {
    const received = new Set(Array.isArray(mutationIds) ? mutationIds : []);
    const scope = readScope(scopeKey);
    updateScope(scopeKey, { outbox: scope.outbox.filter((item) => !received.has(item.mutationId)) });
    return readScope(scopeKey).outbox;
  }
  function rememberRecords(scopeKey, records) {
    const scope = readScope(scopeKey);
    const revisions = { ...scope.revisions };
    const knownRecords = { ...scope.records };
    for (const record of Array.isArray(records) ? records : []) {
      if (!record?.entityType || !record?.entityId) continue;
      const revision = Math.max(0, Number(record.revision) || 0);
      const identity = `${record.entityType}\u0000${record.entityId}`;
      revisions[identity] = revision;
      knownRecords[identity] = { ...record, revision };
    }
    updateScope(scopeKey, { revisions, records: knownRecords });
    return revisions;
  }
  function commitPull({ scopeKey, expectedOldCursor, newCursor, records, deferredPullRecords = [], markLocalProfileScope = false }) {
    const state = read();
    if (state.activeScopeKey !== scopeKey) throw Object.assign(new Error("同步账号已切换。"), { code: "SCOPE_CHANGED" });
    const scope = readScope(scopeKey);
    if (scope.cursor !== expectedOldCursor) throw Object.assign(new Error("同步游标已经变化。"), { code: "SCOPE_CHANGED" });
    const revisions = { ...scope.revisions };
    const knownRecords = { ...scope.records };
    for (const record of Array.isArray(records) ? records : []) {
      if (!record?.entityType || !record?.entityId) continue;
      const key = `${record.entityType}\u0000${record.entityId}`;
      revisions[key] = Math.max(0, Number(record.revision) || 0);
      knownRecords[key] = { ...record, revision: revisions[key] };
    }
    const cursor = Math.max(expectedOldCursor, Math.trunc(Number(newCursor) || expectedOldCursor));
    const nextScope = {
      ...scope,
      cursor,
      revisions,
      records: knownRecords,
      deferredPullRecords: Array.isArray(deferredPullRecords) ? deferredPullRecords : [],
    };
    update({
      cursor,
      scopes: { ...(state.scopes || {}), [scopeKey]: nextScope },
      ...(markLocalProfileScope ? { localProfileScopeKey: scopeKey } : {}),
    });
    return { cursor, remembered: records.length };
  }
  function finishEnrollment({ scopeKey, expectedOldCursor, newCursor, records }) {
    const state = read();
    if (state.activeScopeKey !== scopeKey) throw Object.assign(new Error("同步账号已切换。"), { code: "SCOPE_CHANGED" });
    const scope = readScope(scopeKey);
    if (scope.cursor !== expectedOldCursor) throw Object.assign(new Error("同步游标已经变化。"), { code: "SCOPE_CHANGED" });
    const revisions = { ...scope.revisions };
    const knownRecords = { ...scope.records };
    for (const record of Array.isArray(records) ? records : []) {
      if (!record?.entityType || !record?.entityId) continue;
      const key = `${record.entityType}\u0000${record.entityId}`;
      revisions[key] = Math.max(0, Number(record.revision) || 0);
      knownRecords[key] = { ...record, revision: revisions[key] };
    }
    const cursor = Math.max(expectedOldCursor, Math.trunc(Number(newCursor) || expectedOldCursor));
    const nextScope = { ...scope, cursor, revisions, records: knownRecords, enrolled: true, outbox: [] };
    update({
      cursor,
      localProfileScopeKey: scopeKey,
      scopes: { ...(state.scopes || {}), [scopeKey]: nextScope },
    });
    return { enrolled: true, scopeKey, cursor, remembered: records.length };
  }
  return {
    read,
    update,
    scopeKeyFor,
    readScope,
    updateScope,
    activateScope,
    queueMutations,
    removeMutations,
    rememberRecords,
    commitPull,
    finishEnrollment,
  };
}

function createLegacyBackupStore({ fs, userDataPath, longTasksFilePath }) {
  const backupRoot = path.join(userDataPath, "sync-backups");
  const longTaskImagesPath = path.join(userDataPath, "long-task-images");
  const imageChunkDataLength = 32 * 1024;
  const emptyDocument = { version: 1, tasks: [] };

  function readSource() {
    try {
      return { existed: true, bytes: fs.readFileSync(longTasksFilePath) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return { existed: false, bytes: Buffer.from(JSON.stringify(emptyDocument, null, 2), "utf8") };
    }
  }

  function fingerprint(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }

  function fingerprintProfile(sourceBytes, chunks = []) {
    const hash = crypto.createHash("sha256").update(sourceBytes);
    hash.update("\nlong-task-images\n");
    for (const chunk of chunks) hash.update(JSON.stringify(chunk));
    return hash.digest("hex");
  }

  function parseTasks(bytes) {
    const document = JSON.parse(bytes.toString("utf8"));
    if (!document || typeof document !== "object" || !Array.isArray(document.tasks)) {
      throw new TypeError("long-tasks.json must contain a tasks array.");
    }
    return document;
  }

  function imageExtension(name = "") {
    const extension = path.extname(String(name || "")).slice(1).toLowerCase();
    return new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]).has(extension)
      ? (extension === "jpeg" ? "jpg" : extension)
      : "";
  }

  function imageTypeFromId(id = "") {
    return {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    }[path.extname(String(id || "")).slice(1).toLowerCase()] || "application/octet-stream";
  }

  function safeImageName(id) {
    const fileName = String(id || "").trim();
    if (!fileName || path.basename(fileName) !== fileName || !imageExtension(fileName)) return "";
    return fileName;
  }

  function longTaskImageIds(tasks) {
    const ids = new Set();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      for (const match of String(task?.notes || "").matchAll(/deepstudy-image:\/\/([^\s)]+)/g)) {
        const id = safeImageName(match[1]);
        if (id) ids.add(id);
      }
    }
    return [...ids].sort();
  }

  function imageChunksForTasks(tasks) {
    const chunks = [];
    for (const imageId of longTaskImageIds(tasks)) {
      const target = path.join(longTaskImagesPath, imageId);
      let bytes;
      try {
        bytes = fs.readFileSync(target);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const data = bytes.toString("base64");
      const total = Math.max(1, Math.ceil(data.length / imageChunkDataLength));
      for (let index = 0; index < total; index += 1) {
        chunks.push({
          imageId,
          index,
          total,
          type: imageTypeFromId(imageId),
          size: bytes.length,
          data: data.slice(index * imageChunkDataLength, (index + 1) * imageChunkDataLength),
        });
      }
    }
    return chunks;
  }

  function copyDirectory(source, target) {
    fs.rmSync(target, { recursive: true, force: true });
    if (!fs.existsSync(source)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
    return true;
  }

  function writeImageChunks(chunks = []) {
    const byImage = new Map();
    for (const chunk of Array.isArray(chunks) ? chunks : []) {
      const imageId = safeImageName(chunk?.imageId);
      if (!imageId || typeof chunk.data !== "string") continue;
      const index = Number(chunk.index);
      const total = Number(chunk.total);
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(total) || total <= 0 || index >= total) continue;
      if (!byImage.has(imageId)) byImage.set(imageId, []);
      byImage.get(imageId)[index] = { ...chunk, imageId, index, total };
    }
    fs.mkdirSync(longTaskImagesPath, { recursive: true });
    for (const [imageId, imageChunks] of byImage) {
      const total = Number(imageChunks.find(Boolean)?.total) || 0;
      if (!total || imageChunks.length < total || imageChunks.slice(0, total).some((chunk) => !chunk || chunk.total !== total)) {
        continue;
      }
      const data = imageChunks.slice(0, total).map((chunk) => chunk.data).join("");
      const bytes = Buffer.from(data, "base64");
      if (Number(imageChunks[0].size) && bytes.length !== Number(imageChunks[0].size)) continue;
      const target = path.join(longTaskImagesPath, imageId);
      const temporary = `${target}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.rmSync(target, { force: true });
      fs.renameSync(temporary, target);
    }
  }

  function removeUnreferencedImages(tasks) {
    if (!fs.existsSync(longTaskImagesPath)) return;
    const referenced = new Set(longTaskImageIds(tasks));
    for (const entry of fs.readdirSync(longTaskImagesPath, { withFileTypes: true })) {
      if (!entry.isFile() || !safeImageName(entry.name) || referenced.has(entry.name)) continue;
      fs.rmSync(path.join(longTaskImagesPath, entry.name), { force: true });
    }
  }

  function captureLongTasks() {
    const source = readSource();
    const document = parseTasks(source.bytes);
    const longTaskImageChunks = imageChunksForTasks(document.tasks);
    return {
      tasks: document.tasks,
      longTaskImageChunks,
      fingerprint: fingerprintProfile(source.bytes, longTaskImageChunks),
      existed: source.existed,
    };
  }

  function resolveBackup(backupId) {
    if (!/^[A-Za-z0-9._-]+$/.test(String(backupId || ""))) throw new TypeError("Invalid backup ID.");
    const target = path.resolve(backupRoot, backupId);
    const resolvedRoot = path.resolve(backupRoot);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new TypeError("Invalid backup path.");
    return target;
  }

  function requireBackup(backupId) {
    if (!backupId) throw new Error("写入长期任务前必须提供有效的备份编号。");
    const directory = resolveBackup(backupId);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    if (manifest.backupId !== backupId) throw new Error("备份编号与清单不匹配。");
    return { directory, manifest };
  }

  return {
    captureLongTasks,
    verifyLongTasks(expectedFingerprint) {
      return { unchanged: captureLongTasks().fingerprint === expectedFingerprint };
    },
    createBackup(snapshot = {}) {
      const source = readSource();
      const current = parseTasks(source.bytes);
      const currentFingerprint = fingerprintProfile(source.bytes, imageChunksForTasks(current.tasks));
      if (snapshot.longTasksFingerprint !== currentFingerprint) {
        throw new Error("long-tasks.json changed before the backup was created.");
      }
      if (!snapshot.localStores || typeof snapshot.localStores !== "object") {
        throw new TypeError("LocalStorage backup data is required.");
      }
      const backupId = `${new Date().toISOString().replace(/[:]/g, "-")}-${crypto.randomUUID()}`;
      const directory = resolveBackup(backupId);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "long-tasks.json"), source.bytes, { mode: 0o600 });
      const imagesExisted = copyDirectory(longTaskImagesPath, path.join(directory, "long-task-images"));
      atomicWriteJson(fs, path.join(directory, "local-storage.json"), {
        version: 1,
        stores: snapshot.localStores,
      });
      atomicWriteJson(fs, path.join(directory, "manifest.json"), {
        version: 1,
        backupId,
        createdAt: Date.now(),
        longTasksExisted: source.existed,
        longTasksFingerprint: currentFingerprint,
        longTaskImagesExisted: imagesExisted,
        status: "ready",
      });
      return { backupId, path: directory };
    },
    readLongTasks() {
      return captureLongTasks().tasks;
    },
    writeLongTasks(tasks, backupId, longTaskImageChunks = []) {
      if (!Array.isArray(tasks)) throw new TypeError("Long tasks must be an array.");
      const { directory, manifest } = requireBackup(backupId);
      if (manifest.status && manifest.status !== "ready") throw new Error("该备份编号已经使用，不能重复写入。");
      const source = readSource();
      const current = parseTasks(source.bytes);
      if (fingerprintProfile(source.bytes, imageChunksForTasks(current.tasks)) !== manifest.longTasksFingerprint) {
        throw new Error("long-tasks.json 在备份后发生变化；已停止写入，请重新预览。");
      }
      atomicWriteJson(fs, path.join(directory, "manifest.json"), { ...manifest, status: "applying" });
      atomicWriteJson(fs, longTasksFilePath, { ...current, tasks });
      writeImageChunks(longTaskImageChunks);
      removeUnreferencedImages(tasks);
      atomicWriteJson(fs, path.join(directory, "manifest.json"), { ...manifest, status: "consumed", consumedAt: Date.now() });
      return tasks;
    },
    restoreBackup(backupId) {
      const { directory, manifest } = requireBackup(backupId);
      const localStorageBackup = JSON.parse(fs.readFileSync(path.join(directory, "local-storage.json"), "utf8"));
      if (localStorageBackup?.version !== 1 || !localStorageBackup.stores || typeof localStorageBackup.stores !== "object") {
        throw new Error("LocalStorage backup is invalid.");
      }
      if (manifest.longTasksExisted) {
        fs.mkdirSync(path.dirname(longTasksFilePath), { recursive: true });
        fs.copyFileSync(path.join(directory, "long-tasks.json"), longTasksFilePath);
      } else {
        fs.rmSync(longTasksFilePath, { force: true });
      }
      if (manifest.longTaskImagesExisted) {
        copyDirectory(path.join(directory, "long-task-images"), longTaskImagesPath);
      } else {
        fs.rmSync(longTaskImagesPath, { recursive: true, force: true });
      }
      return { restored: true, backupId, localStores: localStorageBackup.stores };
    },
  };
}

class GatewayRequestError extends Error {
  constructor(message, { status = 0, code = "GATEWAY_ERROR", details = null } = {}) {
    super(message);
    this.name = "GatewayRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeGatewayUrl(value) {
  const url = new URL(String(value || "").trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("同步服务地址必须使用 HTTPS；本机调试可使用 localhost HTTP。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("同步服务地址不能包含账号、查询参数或片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function publicUser(value) {
  if (!value || typeof value !== "object") return null;
  const user = {};
  for (const key of ["id", "username", "displayUsername", "name", "image", "createdAt", "updatedAt"]) {
    if (value[key] !== undefined) user[key] = value[key];
  }
  return user;
}

function publicAuthPayload(payload, credentialStatus) {
  const result = {};
  if (payload?.user) result.user = publicUser(payload.user);
  if (typeof payload?.recoveryCode === "string") result.recoveryCode = payload.recoveryCode;
  if (payload?.ok !== undefined) result.ok = Boolean(payload.ok);
  if (credentialStatus) result.credentialStorage = credentialStatus;
  return result;
}

function createDesktopSyncService({
  fetch: fetchImpl = globalThis.fetch,
  credentialStore,
  stateStore,
  hashSnapshot,
  requestTimeoutMs = 60000,
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!credentialStore || !stateStore) throw new TypeError("Credential and state stores are required.");
  let authTransition = Promise.resolve();

  function serializeAuthTransition(work) {
    const result = authTransition.then(work, work);
    authTransition = result.catch(() => {});
    return result;
  }

  function scopeChanged() {
    return new GatewayRequestError("同步账号在操作期间发生变化，已停止本次操作。", { status: 409, code: "SCOPE_CHANGED" });
  }

  function requireBinding(expected = {}, { requireScope = true } = {}) {
    const state = stateStore.read();
    if (expected.expectedAuthGeneration != null
      && Number(expected.expectedAuthGeneration) !== Number(state.authGeneration || 0)) throw scopeChanged();
    if (expected.expectedScopeKey != null && expected.expectedScopeKey !== state.activeScopeKey) throw scopeChanged();
    if (requireScope && typeof stateStore.readScope === "function" && !state.activeScopeKey) {
      throw new GatewayRequestError("请先登录 DeepStudy 账号。", { status: 401, code: "UNAUTHORIZED" });
    }
    return state;
  }

  function clearAuthIfCurrent(expected, capturedToken) {
    const current = stateStore.read();
    if (expected.expectedScopeKey !== current.activeScopeKey
      || Number(expected.expectedAuthGeneration) !== Number(current.authGeneration || 0)) return false;
    if (typeof credentialStore.scopeKey === "function" && credentialStore.scopeKey() !== current.activeScopeKey) return false;
    if (credentialStore.loadToken() !== capturedToken) return false;
    stateStore.update({ activeScopeKey: "", username: "", cursor: 0, authGeneration: Number(current.authGeneration || 0) + 1 });
    credentialStore.clearToken();
    return true;
  }

  async function request(route, {
    method = "GET",
    body,
    authenticated = true,
    gatewayUrl,
    expectedScopeKey,
    expectedAuthGeneration,
  } = {}) {
    const initialState = stateStore.read();
    const expected = {
      expectedScopeKey: expectedScopeKey ?? (authenticated ? initialState.activeScopeKey : undefined),
      expectedAuthGeneration: expectedAuthGeneration ?? (authenticated ? Number(initialState.authGeneration || 0) : undefined),
    };
    const state = requireBinding(expected, { requireScope: authenticated });
    const baseUrl = normalizeGatewayUrl(gatewayUrl || state.gatewayUrl);
    const headers = { Accept: "application/json", "X-Device-Id": state.deviceId };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let capturedToken = "";
    if (authenticated) {
      capturedToken = credentialStore.loadToken();
      if (!capturedToken) throw new GatewayRequestError("请先登录 DeepStudy 账号。", { status: 401, code: "UNAUTHORIZED" });
      if (typeof credentialStore.scopeKey === "function" && credentialStore.scopeKey() !== state.activeScopeKey) throw scopeChanged();
      headers.Authorization = `Bearer ${capturedToken}`;
    }
    let response;
    const timeoutMs = Math.max(1000, Number(requestTimeoutMs) || 60000);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        method,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (controller?.signal.aborted || error?.name === "AbortError") {
        throw new GatewayRequestError("同步服务请求超时，请检查网络后重试。", { code: "NETWORK_TIMEOUT" });
      }
      throw new GatewayRequestError(`无法连接同步服务：${error?.message || error}`, { code: "NETWORK_ERROR" });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { message: text.slice(0, 500) }; }
    }
    if (!response.ok) {
      if (response.status === 401 && authenticated) {
        clearAuthIfCurrent(expected, capturedToken);
      }
      throw new GatewayRequestError(
        payload?.message || payload?.error || `同步服务返回 HTTP ${response.status}`,
        { status: response.status, code: payload?.error || "GATEWAY_ERROR", details: payload },
      );
    }
    requireBinding(expected, { requireScope: authenticated });
    return { response, payload: payload || {} };
  }

  async function enroll(route, input) {
    const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl);
    const generation = Number(stateStore.read().authGeneration || 0);
    const { response, payload } = await request(route, {
      method: "POST",
      authenticated: false,
      gatewayUrl,
      expectedAuthGeneration: generation,
      body: {
        username: input.username,
        password: input.password,
        turnstileToken: input.turnstileToken,
      },
    });
    const token = response.headers.get("set-auth-token");
    if (!token) throw new GatewayRequestError("同步服务没有返回登录凭据。", { code: "MISSING_BEARER" });
    stateStore.update({ activeScopeKey: "", username: "", cursor: 0, authGeneration: generation + 1 });
    credentialStore.clearToken();
    const account = { gatewayUrl, username: String(payload?.user?.username || input.username || "").trim() };
    const scopeKey = typeof stateStore.scopeKeyFor === "function" ? stateStore.scopeKeyFor(account) : "";
    const credentialStatus = credentialStore.saveToken(token, scopeKey);
    if (typeof stateStore.activateScope === "function") stateStore.activateScope(account);
    else stateStore.update({ ...account, cursor: 0 });
    return publicAuthPayload(payload, credentialStatus);
  }

  function activeScope(expected = {}) {
    const state = requireBinding(expected);
    if (!state.activeScopeKey) throw new GatewayRequestError("请先登录 DeepStudy 账号。", { status: 401, code: "UNAUTHORIZED" });
    return stateStore.readScope(state.activeScopeKey);
  }

  return {
    async config(input = {}) {
      const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl || stateStore.read().gatewayUrl);
      const { payload } = await request("/v1/config", {
        authenticated: false,
        gatewayUrl,
      });
      return {
        turnstileSiteKey: String(payload.turnstileSiteKey || ""),
        minimumPasswordLength: Math.max(0, Number(payload.minimumPasswordLength) || 0),
      };
    },
    register(input = {}) { return serializeAuthTransition(() => enroll("/v1/auth/register", input)); },
    signIn(input = {}) { return serializeAuthTransition(() => enroll("/v1/auth/sign-in", input)); },
    recover(input = {}) { return serializeAuthTransition(async () => {
      const gatewayUrl = normalizeGatewayUrl(input.gatewayUrl || stateStore.read().gatewayUrl);
      const { payload } = await request("/v1/auth/recover", {
        method: "POST",
        authenticated: false,
        gatewayUrl,
        body: {
          username: input.username,
          recoveryCode: input.recoveryCode,
          newPassword: input.newPassword,
          turnstileToken: input.turnstileToken,
        },
      });
      const state = stateStore.read();
      stateStore.update({ gatewayUrl, username: String(input.username || "").trim(), cursor: 0, activeScopeKey: "", authGeneration: Number(state.authGeneration || 0) + 1 });
      credentialStore.clearToken();
      return publicAuthPayload(payload);
    }); },
    signOut() { return serializeAuthTransition(async () => {
      const stateAtStart = stateStore.read();
      const tokenAtStart = credentialStore.loadToken();
      const expected = {
        expectedScopeKey: stateAtStart.activeScopeKey,
        expectedAuthGeneration: Number(stateAtStart.authGeneration || 0),
      };
      try {
        if (tokenAtStart && stateAtStart.gatewayUrl) {
          await request("/api/auth/sign-out", { method: "POST", body: {}, ...expected });
        }
      } finally {
        if (tokenAtStart) {
          clearAuthIfCurrent(expected, tokenAtStart);
        } else {
          const current = stateStore.read();
          if (current.activeScopeKey === expected.expectedScopeKey
            && Number(current.authGeneration || 0) === expected.expectedAuthGeneration) {
            stateStore.update({ username: "", cursor: 0, activeScopeKey: "", authGeneration: expected.expectedAuthGeneration + 1 });
            credentialStore.clearToken();
          }
        }
      }
      return { signedIn: false };
    }); },
    async session() {
      const state = stateStore.read();
      if (!credentialStore.loadToken() || !state.gatewayUrl) {
        return { signedIn: false, user: null, deviceId: state.deviceId };
      }
      const { payload } = await request("/v1/auth/session");
      return { signedIn: true, user: publicUser(payload.user), deviceId: state.deviceId };
    },
    status() {
      const state = stateStore.read();
      const scope = state.activeScopeKey ? stateStore.readScope(state.activeScopeKey) : null;
      const token = credentialStore.loadToken();
      const tokenBound = typeof credentialStore.scopeKey !== "function" || credentialStore.scopeKey() === state.activeScopeKey;
      return {
        signedIn: Boolean(token && state.activeScopeKey && tokenBound),
        gatewayUrl: state.gatewayUrl,
        username: state.username,
        deviceId: state.deviceId,
        cursor: Number(state.cursor) || 0,
        scopeKey: state.activeScopeKey || "",
        authGeneration: Number(state.authGeneration || 0),
        enrollmentComplete: Boolean(scope?.enrolled),
        outboxCount: scope?.outbox?.filter((mutation) => !mutation.blocked).length || 0,
        blockedConflictCount: scope?.outbox?.filter((mutation) => mutation.blocked).length || 0,
        deferredPullCount: scope?.deferredPullRecords?.length || 0,
        localProfileScopeKey: state.localProfileScopeKey || "",
        credentialStorage: credentialStore.securityStatus(),
      };
    },
    async registerDevice(input = {}, expected = {}) {
      return (await request("/v1/devices", { method: "POST", body: input, ...expected })).payload;
    },
    async previewImport(records) {
      if (typeof hashSnapshot !== "function") throw new Error("Snapshot hashing is unavailable.");
      const snapshotHash = await hashSnapshot(records);
      return (await request("/v1/imports/preview", {
        method: "POST",
        body: { records, snapshotHash },
      })).payload;
    },
    async commitImport(input = {}, expected = {}) {
      try {
        return (await request("/v1/imports/commit", { method: "POST", body: input, ...expected })).payload;
      } catch (error) {
        if (["STALE_IMPORT_CURSOR", "IMPORT_REPREVIEW_REQUIRED"].includes(error?.code) && error.details) {
          return { ...error.details, error: error.code };
        }
        throw error;
      }
    },
    async push(mutations = [], expected = {}) {
      return (await request("/v1/sync/push", { method: "POST", body: { mutations }, ...expected })).payload;
    },
    async pull(input = {}) {
      const expected = { expectedScopeKey: input.expectedScopeKey, expectedAuthGeneration: input.expectedAuthGeneration };
      const state = requireBinding(expected);
      const scope = activeScope(expected);
      const cursor = Math.max(0, Number(input.cursor ?? scope?.cursor ?? state.cursor) || 0);
      const limit = Math.max(1, Math.min(500, Number(input.limit) || 200));
      const payload = (await request(`/v1/sync/pull?cursor=${cursor}&limit=${limit}`, expected)).payload;
      if (input.advanceCursor !== false && Number.isFinite(Number(payload.cursor))) {
        if (scope) stateStore.updateScope(scope.scopeKey, { cursor: Number(payload.cursor) });
        stateStore.update({ cursor: Number(payload.cursor) });
      }
      return payload;
    },
    outboxState(expected = {}) {
      const scope = activeScope(expected);
      return {
        scopeKey: scope.scopeKey,
        localProfileScopeKey: stateStore.read().localProfileScopeKey || "",
        enrolled: Boolean(scope.enrolled),
        cursor: scope.cursor,
        revisions: { ...scope.revisions },
        records: Object.values(scope.records).map((record) => ({ ...record })),
        outbox: scope.outbox.map((mutation) => ({ ...mutation, record: { ...mutation.record } })),
        deferredPullRecords: scope.deferredPullRecords.map((record) => ({ ...record })),
      };
    },
    queueOutbox(mutations = [], expected = {}) {
      const scope = activeScope(expected);
      const outbox = stateStore.queueMutations(scope.scopeKey, mutations);
      return { scopeKey: scope.scopeKey, outboxCount: outbox.filter((mutation) => !mutation.blocked).length };
    },
    recordPulled(records = [], expected = {}) {
      const scope = activeScope(expected);
      stateStore.rememberRecords(scope.scopeKey, records);
      return { remembered: Array.isArray(records) ? records.length : 0 };
    },
    commitPull(input = {}) {
      const expected = { expectedScopeKey: input.expectedScopeKey, expectedAuthGeneration: input.expectedAuthGeneration };
      const scope = activeScope(expected);
      return stateStore.commitPull({
        scopeKey: scope.scopeKey,
        expectedOldCursor: input.expectedOldCursor,
        newCursor: input.newCursor,
        records: input.records || [],
        deferredPullRecords: input.deferredPullRecords || [],
        markLocalProfileScope: input.markLocalProfileScope === true,
      });
    },
    finishEnrollment(input = []) {
      const expected = Array.isArray(input) ? {} : {
        expectedScopeKey: input.expectedScopeKey,
        expectedAuthGeneration: input.expectedAuthGeneration,
      };
      const scope = activeScope(expected);
      const records = Array.isArray(input) ? input : (input.records || []);
      const expectedOldCursor = Array.isArray(input) ? scope.cursor : Math.max(0, Number(input.expectedOldCursor) || 0);
      const newCursor = Array.isArray(input) ? scope.cursor : Math.max(expectedOldCursor, Number(input.newCursor) || expectedOldCursor);
      return stateStore.finishEnrollment({ scopeKey: scope.scopeKey, expectedOldCursor, newCursor, records });
    },
    importProgress() {
      return activeScope().pendingImport || null;
    },
    saveImportProgress(progress = null) {
      const scope = activeScope();
      if (progress == null) {
        stateStore.updateScope(scope.scopeKey, { pendingImport: null });
        return null;
      }
      if (!/^[A-Za-z0-9._:-]{1,200}$/.test(String(progress.importId || ""))
        || typeof progress.snapshotHash !== "string"
        || !Array.isArray(progress.snapshot?.records)) {
        throw new TypeError("首次导入进度无效。");
      }
      const saved = {
        importId: progress.importId,
        snapshotHash: progress.snapshotHash,
        status: String(progress.status || "previewed"),
        nextIndex: Math.max(0, Math.trunc(Number(progress.nextIndex) || 0)),
        totalItems: Math.max(0, Math.trunc(Number(progress.totalItems) || 0)),
        counts: progress.counts && typeof progress.counts === "object" ? progress.counts : {},
        conflicts: Array.isArray(progress.conflicts) ? progress.conflicts : [],
        summaryTruncated: Boolean(progress.summaryTruncated),
        snapshot: { records: progress.snapshot.records },
      };
      stateStore.updateScope(scope.scopeKey, { pendingImport: saved });
      return saved;
    },
    settleOutbox(results = [], expected = {}) {
      const scope = activeScope(expected);
      const applied = new Map();
      const conflicts = new Map();
      for (const result of Array.isArray(results) ? results : []) {
        if (result?.status === "applied" && result.mutationId) applied.set(result.mutationId, result);
        if (result?.status === "conflict" && result.mutationId) conflicts.set(result.mutationId, result);
      }
      stateStore.removeMutations(scope.scopeKey, [...applied.keys()]);
      const remaining = stateStore.readScope(scope.scopeKey).outbox.map((mutation) => {
        const conflict = conflicts.get(mutation.mutationId);
        return conflict ? { ...mutation, blocked: true, conflictId: conflict.conflictId } : mutation;
      });
      stateStore.updateScope(scope.scopeKey, { outbox: remaining });
      const mutationById = new Map(scope.outbox.map((mutation) => [mutation.mutationId, mutation]));
      stateStore.rememberRecords(scope.scopeKey, [...applied.values()].map((result) => ({
        ...(mutationById.get(result.mutationId)?.record || {}),
        entityType: result.entityType,
        entityId: result.entityId,
        revision: result.revision,
        serverUpdatedAt: result.serverUpdatedAt,
      })));
      return { applied: applied.size, conflicts: conflicts.size, outboxCount: remaining.filter((mutation) => !mutation.blocked).length };
    },
    async conflicts(expected = {}) {
      return (await request("/v1/sync/conflicts", expected)).payload;
    },
    async resolveConflict(conflictId, input = {}, expected = {}) {
      if (!/^[A-Za-z0-9._:-]{1,200}$/.test(String(conflictId || ""))) {
        throw new TypeError("冲突编号无效。");
      }
      const result = (await request(`/v1/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: "POST",
        body: input,
        ...expected,
      })).payload;
      if (typeof stateStore.readScope === "function") {
        const scope = activeScope(expected);
        const matching = scope.outbox.find((mutation) => mutation.conflictId === conflictId);
        if (matching && result?.ok) {
          stateStore.removeMutations(scope.scopeKey, [matching.mutationId]);
          if (input.resolution === "keep_local") {
            const matchingIdentity = `${matching.record.entityType}\u0000${matching.record.entityId}`;
            stateStore.updateScope(scope.scopeKey, {
              deferredPullRecords: scope.deferredPullRecords.filter((record) => (
                `${record?.entityType}\u0000${record?.entityId}` !== matchingIdentity
              )),
            });
          }
          if (result.result?.revision) stateStore.rememberRecords(scope.scopeKey, [{
            ...matching.record,
            revision: result.result.revision,
            serverUpdatedAt: result.result.serverUpdatedAt,
          }]);
        }
      }
      return result;
    },
    async currentTimer(expected = {}) {
      return (await request("/v1/timer", expected)).payload;
    },
    async claimTimer(input = {}, expected = {}) {
      if (Object.prototype.hasOwnProperty.call(input, "takeover") && typeof input.takeover !== "boolean") {
        throw new TypeError("远端计时器只能通过明确点击“接管并继续”来接管。");
      }
      return (await request("/v1/timer/claim", { method: "POST", body: { ...input, takeover: input.takeover === true }, ...expected })).payload;
    },
    async releaseTimer(input = {}, expected = {}) {
      return (await request("/v1/timer/release", { method: "POST", body: input, ...expected })).payload;
    },
  };
}

module.exports = {
  GatewayRequestError,
  DEFAULT_GATEWAY_URL,
  MEMORY_ONLY_WARNING,
  atomicWriteJson,
  canPersistSecurely,
  createCredentialStore,
  createDesktopSyncService,
  createLegacyBackupStore,
  createStateStore,
  normalizeGatewayUrl,
};
