(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeepStudyLegacySync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const LEGACY_STORAGE_KEYS = Object.freeze({
    dailyTask: "mytimer.dailyPlan.v1",
    focusSession: "mytimer.focusSessions.v1",
    modeEvent: "mytimer.focusTracker.v1",
    timeAudit: "mytimer.timeAudit.v1",
    distraction: "mytimer.distractionList.v1",
    reflection: "mytimer.dailyReflection.v1",
    soulQuote: "deepstudy.soulQuotes.v1",
  });

  const ARRAY_STORES = Object.freeze([
    { key: LEGACY_STORAGE_KEYS.focusSession, entityType: "focus_session" },
    { key: LEGACY_STORAGE_KEYS.modeEvent, entityType: "mode_event" },
    { key: LEGACY_STORAGE_KEYS.timeAudit, entityType: "time_audit" },
    { key: LEGACY_STORAGE_KEYS.distraction, entityType: "distraction" },
    { key: LEGACY_STORAGE_KEYS.reflection, entityType: "reflection" },
    { key: LEGACY_STORAGE_KEYS.soulQuote, entityType: "soul_quote" },
  ]);

  class LegacySnapshotError extends Error {
    constructor(message, code = "LEGACY_SNAPSHOT_ERROR") {
      super(message);
      this.name = "LegacySnapshotError";
      this.code = code;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseStore(key, raw, fallback) {
    if (raw == null) return clone(fallback);
    try { return JSON.parse(raw); }
    catch { throw new LegacySnapshotError(`旧数据 ${key} 不是有效 JSON；为避免丢失，已停止导入。`, "INVALID_LEGACY_JSON"); }
  }

  function readRawStores(storage) {
    return Object.fromEntries(Object.values(LEGACY_STORAGE_KEYS).map((key) => [key, storage.getItem(key)]));
  }

  function sameRawStores(left, right) {
    return Object.values(LEGACY_STORAGE_KEYS).every((key) => left[key] === right[key]);
  }

  function itemTimestamp(item) {
    for (const key of ["updatedAt", "timestamp", "end", "start", "createdAt", "plannedAt", "completedAt"]) {
      const value = Number(item?.[key]);
      if (Number.isFinite(value) && value >= 0) return Math.round(value);
    }
    return 0;
  }

  function stableIdDigest(value) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code ^ index, 0x85ebca6b) >>> 0;
    }
    return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
  }

  function appendWithinIdLimit(value, suffix = "") {
    return `${value.slice(0, Math.max(0, 200 - suffix.length))}${suffix}`;
  }

  function entityIdFor(item, entityType, index, occupied) {
    const original = typeof item?.id === "string" && item.id.trim() ? item.id : `legacy-${entityType}-${index}`;
    let candidate = original.length <= 200
      ? original
      : appendWithinIdLimit(original, `~legacy~${stableIdDigest(original)}`);
    let suffix = 1;
    const base = candidate;
    while (occupied.has(candidate)) candidate = appendWithinIdLimit(base, `~duplicate~${suffix++}`);
    occupied.add(candidate);
    return candidate;
  }

  function recordsForArray(items, { entityType, key }, deviceId, sourceSuffix = "") {
    if (!Array.isArray(items)) {
      throw new LegacySnapshotError(`旧数据 ${key} 的结构无效；为避免丢失，已停止导入。`, "INVALID_LEGACY_SHAPE");
    }
    const occupied = new Set();
    return items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new LegacySnapshotError(`旧数据 ${key} 第 ${index + 1} 项结构无效。`, "INVALID_LEGACY_SHAPE");
      }
      return {
        entityType,
        entityId: entityIdFor(item, entityType, index, occupied),
        payload: clone(item),
        deleted: false,
        revision: 0,
        clientUpdatedAt: itemTimestamp(item),
        serverUpdatedAt: null,
        deviceId,
        legacySourceId: `storage:${key}${sourceSuffix}`,
      };
    });
  }

  function buildLegacyRecords({ rawStores, longTasks, deviceId }) {
    if (typeof deviceId !== "string" || deviceId.length < 8) {
      throw new LegacySnapshotError("桌面设备编号无效。", "INVALID_DEVICE_ID");
    }
    if (!Array.isArray(longTasks)) {
      throw new LegacySnapshotError("long-tasks.json 的 tasks 结构无效。", "INVALID_LEGACY_SHAPE");
    }
    const records = recordsForArray(longTasks, {
      entityType: "long_task",
      key: "long-tasks.json",
    }, deviceId);
    const daily = parseStore(
      LEGACY_STORAGE_KEYS.dailyTask,
      rawStores[LEGACY_STORAGE_KEYS.dailyTask],
      { date: "", tasks: [] },
    );
    if (!daily || typeof daily !== "object" || Array.isArray(daily) || !Array.isArray(daily.tasks)) {
      throw new LegacySnapshotError("每日计划旧数据结构无效；为避免丢失，已停止导入。", "INVALID_LEGACY_SHAPE");
    }
    records.push(...recordsForArray(daily.tasks, {
      entityType: "daily_task",
      key: LEGACY_STORAGE_KEYS.dailyTask,
    }, deviceId, `|date=${encodeURIComponent(typeof daily.date === "string" ? daily.date : "")}`));
    for (const descriptor of ARRAY_STORES) {
      records.push(...recordsForArray(
        parseStore(descriptor.key, rawStores[descriptor.key], []),
        descriptor,
        deviceId,
      ));
    }
    return records;
  }

  async function collectConsistentSnapshot({
    storage,
    deviceId,
    captureLongTasks,
    verifyLongTasks,
    maxAttempts = 3,
  }) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const before = readRawStores(storage);
      const captured = await captureLongTasks();
      const after = readRawStores(storage);
      const verification = await verifyLongTasks(captured.fingerprint);
      const longTasksUnchanged = verification === true || verification?.unchanged === true;
      if (!sameRawStores(before, after) || !longTasksUnchanged) continue;
      return {
        version: 1,
        capturedAt: Date.now(),
        attempts: attempt,
        fingerprint: captured.fingerprint,
        rawStores: after,
        records: buildLegacyRecords({ rawStores: after, longTasks: captured.tasks, deviceId }),
      };
    }
    throw new LegacySnapshotError(
      "采集期间旧数据仍在变化，请暂停编辑后重试；尚未写入任何数据。",
      "SNAPSHOT_CHANGED",
    );
  }

  function recordDate(record) {
    const match = typeof record.legacySourceId === "string"
      ? record.legacySourceId.match(/\|date=([^|]*)/)
      : null;
    return match ? decodeURIComponent(match[1]) : "";
  }

  function materialize(record, existingIds, replaceExisting = false) {
    const item = clone(record.payload);
    if (replaceExisting) return item;
    const payloadId = typeof item.id === "string" ? item.id : "";
    if (!payloadId) item.id = record.entityId;
    else if (payloadId !== record.entityId && existingIds.has(payloadId)) {
      if (item._legacyOriginalId === undefined) item._legacyOriginalId = payloadId;
      item.id = record.entityId;
    }
    return item;
  }

  function mergeArray(current, records, descriptor) {
    const items = Array.isArray(current) ? clone(current) : [];
    const currentRecords = recordsForArray(items, descriptor, "desktop-merge-device");
    const byId = new Map(currentRecords.map((record, index) => [record.entityId, items[index]]));
    for (const record of records) {
      const payloadId = typeof record.payload?.id === "string" ? record.payload.id : record.entityId;
      if (record.deleted) {
        byId.delete(record.entityId);
        if (payloadId === record.entityId) byId.delete(payloadId);
        continue;
      }
      const replaceExisting = byId.has(record.entityId);
      const existingPayloadIds = new Set([...byId.values()].map((item) => item?.id).filter((id) => typeof id === "string"));
      byId.set(record.entityId, materialize(record, existingPayloadIds, replaceExisting));
    }
    return [...byId.values()];
  }

  function planPulledWrites({ rawStores, longTasks, records, profileReplace = false }) {
    const validRecords = Array.isArray(records) ? records.filter((record) => record && typeof record === "object") : [];
    const longRecords = validRecords.filter((record) => record.entityType === "long_task");
    const plannedLongTasks = mergeArray(profileReplace ? [] : longTasks, longRecords, {
      entityType: "long_task",
      key: "long-tasks.json",
    });
    const localStores = {};

    const daily = parseStore(
      LEGACY_STORAGE_KEYS.dailyTask,
      rawStores[LEGACY_STORAGE_KEYS.dailyTask],
      { date: "", tasks: [] },
    );
    if (!daily || typeof daily !== "object" || !Array.isArray(daily.tasks)) {
      throw new LegacySnapshotError("每日计划旧数据结构无效。", "INVALID_LEGACY_SHAPE");
    }
    const availableDailyDates = validRecords
      .filter((record) => record.entityType === "daily_task" && !record.deleted)
      .map(recordDate)
      .filter(Boolean)
      .sort();
    const targetDailyDate = profileReplace && availableDailyDates.length
      ? availableDailyDates.at(-1)
      : daily.date;
    const dailyRecords = validRecords.filter((record) => {
      if (record.entityType !== "daily_task") return false;
      const date = recordDate(record);
      return !date || !targetDailyDate || date === targetDailyDate;
    });
    localStores[LEGACY_STORAGE_KEYS.dailyTask] = JSON.stringify({
      ...daily,
      ...(profileReplace ? { date: targetDailyDate || "" } : {}),
      tasks: mergeArray(profileReplace ? [] : daily.tasks, dailyRecords, {
        entityType: "daily_task",
        key: LEGACY_STORAGE_KEYS.dailyTask,
      }),
    });

    for (const descriptor of ARRAY_STORES) {
      const current = parseStore(descriptor.key, rawStores[descriptor.key], []);
      if (!Array.isArray(current)) throw new LegacySnapshotError(`旧数据 ${descriptor.key} 结构无效。`, "INVALID_LEGACY_SHAPE");
      localStores[descriptor.key] = JSON.stringify(mergeArray(
        profileReplace ? [] : current,
        validRecords.filter((record) => record.entityType === descriptor.entityType),
        descriptor,
      ));
    }
    return { longTasks: plannedLongTasks, localStores };
  }

  async function applyPulledSnapshot({
    storage,
    records,
    captureLongTasks,
    createBackup,
    writeLongTasks,
    readLongTasks,
    restoreBackup,
    profileReplace = false,
  }) {
    const originalStores = readRawStores(storage);
    const captured = await captureLongTasks();
    const backup = await createBackup({
      version: 1,
      createdAt: Date.now(),
      localStores: originalStores,
      longTasks: clone(captured.tasks),
      longTasksFingerprint: captured.fingerprint,
    });
    if (!backup?.backupId) throw new LegacySnapshotError("无法创建同步前备份，已停止写入。", "BACKUP_FAILED");
    const planned = planPulledWrites({ rawStores: originalStores, longTasks: captured.tasks, records, profileReplace });
    if (!sameRawStores(originalStores, readRawStores(storage))) {
      throw new LegacySnapshotError("LocalStorage 在备份后发生变化；尚未覆盖任何本地数据，请重试。", "LOCAL_CHANGED_AFTER_BACKUP");
    }
    let longTasksWritten = false;
    let localWritesStarted = false;
    try {
      await writeLongTasks(planned.longTasks, backup.backupId);
      longTasksWritten = true;
      if (!sameRawStores(originalStores, readRawStores(storage))) {
        await restoreBackup(backup.backupId);
        longTasksWritten = false;
        throw new LegacySnapshotError("LocalStorage 在备份后发生变化；长期任务已恢复，请重试。", "LOCAL_CHANGED_AFTER_BACKUP");
      }
      localWritesStarted = true;
      for (const key of Object.values(LEGACY_STORAGE_KEYS)) storage.setItem(key, planned.localStores[key]);

      const readbackLongTasks = await readLongTasks();
      const storesMatch = Object.values(LEGACY_STORAGE_KEYS)
        .every((key) => storage.getItem(key) === planned.localStores[key]);
      if (JSON.stringify(readbackLongTasks) !== JSON.stringify(planned.longTasks) || !storesMatch) {
        throw new LegacySnapshotError("同步写入后的读取校验失败。", "READBACK_MISMATCH");
      }
      return { backupId: backup.backupId, appliedRecords: records.length };
    } catch (error) {
      let rollbackError = null;
      if (localWritesStarted) {
        for (const key of Object.values(LEGACY_STORAGE_KEYS)) {
          try {
            if (originalStores[key] == null) storage.removeItem(key);
            else storage.setItem(key, originalStores[key]);
          } catch (restoreError) {
            rollbackError ||= restoreError;
          }
        }
      }
      if (longTasksWritten) {
        try { await restoreBackup(backup.backupId); }
        catch (restoreError) { rollbackError ||= restoreError; }
      }
      if (rollbackError) error.rollbackError = rollbackError;
      throw error;
    }
  }

  return {
    ARRAY_STORES,
    LEGACY_STORAGE_KEYS,
    LegacySnapshotError,
    applyPulledSnapshot,
    buildLegacyRecords,
    collectConsistentSnapshot,
    planPulledWrites,
    readRawStores,
  };
});
