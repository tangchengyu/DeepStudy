(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeepStudySyncEnrollment = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }

  function createEnrollmentController({ api, legacySync, storage, deviceName, platform = "desktop", beforeApply = async () => {} }) {
    let pending = null;

    async function collect() {
      const status = await api.syncStatus();
      return legacySync.collectConsistentSnapshot({
        storage,
        deviceId: status.deviceId,
        captureLongTasks: () => api.syncCaptureLongTasks(),
        verifyLongTasks: (fingerprint) => api.syncVerifyLongTasks(fingerprint),
      });
    }

    async function enroll(method, input) {
      const result = await api[method](input);
      try {
        await registerDevice();
      } catch (error) {
        result.deviceRegistrationWarning = `设备登记稍后重试：${error?.message || error}`;
      }
      return result;
    }

    function registerDevice() {
      return api.syncRegisterDevice({
        name: deviceName || `${platform} desktop`,
        platform,
      });
    }

    async function previewFirstImport() {
      if (typeof api.syncImportProgress === "function") {
        const recovered = await api.syncImportProgress();
        if (recovered?.importId && recovered?.snapshot?.records) {
          pending = { snapshot: recovered.snapshot, preview: recovered };
          return recovered;
        }
      }
      const snapshot = await collect();
      const preview = await api.syncPreviewImport(snapshot.records);
      pending = { snapshot, preview };
      if (typeof api.syncSaveImportProgress === "function") {
        await api.syncSaveImportProgress({ ...preview, snapshot: { records: snapshot.records } });
      }
      return preview;
    }

    async function pullAll() {
      const status = await api.syncStatus();
      const binding = {
        expectedScopeKey: status.scopeKey,
        expectedAuthGeneration: status.authGeneration,
      };
      let cursor = 0;
      const byIdentity = new Map();
      for (let page = 0; page < 10000; page += 1) {
        const result = await api.syncPull({ cursor, limit: 500, advanceCursor: false, ...binding });
        for (const record of Array.isArray(result.records) ? result.records : []) {
          byIdentity.set(`${record.entityType}\u0000${record.entityId}`, record);
        }
        const nextCursor = Math.max(cursor, Number(result.cursor) || cursor);
        if (!result.hasMore) return { records: [...byIdentity.values()], cursor: nextCursor, status, binding };
        if (nextCursor === cursor) throw new Error("同步服务返回了无进展的拉取游标。");
        cursor = nextCursor;
      }
      throw new Error("同步记录分页过多，已停止以保护本地数据。");
    }

    function verifyCloudReadback(snapshot, preview, cloudRecords) {
      const cloudByIdentity = new Map(cloudRecords.map((record) => [
        `${record.entityType}\u0000${record.entityId}`,
        record,
      ]));
      const conflicts = new Map((preview.conflicts || []).map((conflict) => [
        `${conflict.entityType}\u0000${conflict.entityId}`,
        conflict.forkEntityId,
      ]));
      for (const local of snapshot.records) {
        const originalIdentity = `${local.entityType}\u0000${local.entityId}`;
        let expectedId = conflicts.get(originalIdentity) || local.entityId;
        // Preview summaries intentionally cap conflict details. When it is truncated,
        // resolve omitted forks from the committed pull instead of mistaking the
        // original remote record for the local copy or failing a correct import.
        if (!conflicts.has(originalIdentity) && preview.summaryTruncated) {
          const fork = cloudRecords.find((record) => record.entityType === local.entityType
            && record.legacySourceId === local.entityId
            && record.deleted === local.deleted
            && canonicalJson(record.payload) === canonicalJson(local.payload));
          if (fork) expectedId = fork.entityId;
        }
        const cloud = cloudByIdentity.get(`${local.entityType}\u0000${expectedId}`);
        if (!cloud
          || cloud.deleted !== local.deleted
          || canonicalJson(cloud.payload) !== canonicalJson(local.payload)) {
          throw new Error(`云端读取校验失败：${local.entityType}/${local.entityId} 尚未完整保存，本地数据未改动。`);
        }
      }
    }

    async function applyCloudRecords(records, options = {}) {
      return legacySync.applyPulledSnapshot({
        storage,
        records,
        captureLongTasks: () => api.syncCaptureLongTasks(),
        createBackup: (snapshot) => api.syncCreateBackup(snapshot),
        writeLongTasks: (tasks, backupId) => api.syncWriteLongTasks(tasks, backupId),
        readLongTasks: () => api.syncReadLongTasks(),
        restoreBackup: (backupId) => api.syncRestoreBackup(backupId),
        profileReplace: options.profileReplace === true,
      });
    }

    async function restoreBackupData(backupId) {
      const result = await api.syncRestoreBackup(backupId);
      const stores = result?.localStores;
      if (!stores || typeof stores !== "object") throw new Error("备份中缺少 LocalStorage 数据。");
      for (const key of Object.values(legacySync.LEGACY_STORAGE_KEYS)) {
        if (stores[key] == null) storage.removeItem(key);
        else storage.setItem(key, stores[key]);
      }
      for (const key of Object.values(legacySync.LEGACY_STORAGE_KEYS)) {
        if (storage.getItem(key) !== (stores[key] ?? null)) throw new Error(`备份恢复校验失败：${key}`);
      }
      return result;
    }

    return {
      register: (input) => enroll("syncRegister", input),
      signIn: (input) => enroll("syncSignIn", input),
      recover: (input) => api.syncRecover(input),
      signOut: () => api.syncSignOut(),
      session: () => api.syncSession(),
      status: () => api.syncStatus(),
      registerDevice,
      previewFirstImport,
      pendingPreview: () => pending?.preview || null,
      async commitFirstImport() {
        if (!pending && typeof api.syncImportProgress === "function") {
          const recovered = await api.syncImportProgress();
          if (recovered?.importId && recovered?.snapshot?.records) pending = { snapshot: recovered.snapshot, preview: recovered };
        }
        if (!pending) throw new Error("请先预览旧数据导入结果。");
        await beforeApply();
        const refreshedSnapshot = await collect();
        if (canonicalJson(refreshedSnapshot.records) !== canonicalJson(pending.snapshot.records)) {
          if (Math.max(0, Number(pending.preview.nextIndex) || 0) === 0) {
            pending = null;
            if (typeof api.syncSaveImportProgress === "function") await api.syncSaveImportProgress(null);
            await previewFirstImport();
          }
          throw new Error("确认前旧数据已经变化，预览已刷新；请检查后再次确认。");
        }
        let importResult = pending.preview;
        for (let chunk = 0; importResult.status !== "committed" && chunk < 10000; chunk += 1) {
          const expectedIndex = Math.max(0, Math.trunc(Number(importResult.nextIndex) || 0));
          let next;
          try {
            next = await api.syncCommitImport({ importId: importResult.importId, expectedIndex });
          } catch (error) {
            if (error?.code === "IMPORT_REPREVIEW_REQUIRED"
              || String(error?.message || "").includes("IMPORT_REPREVIEW_REQUIRED")) {
              pending = null;
              if (typeof api.syncSaveImportProgress === "function") await api.syncSaveImportProgress(null);
              throw new Error("云端数据在提交期间发生变化；请重新采集并预览后再确认。");
            }
            const details = error?.details;
            if (error?.code === "STALE_IMPORT_CURSOR"
              && details?.importId === importResult.importId
              && details?.snapshotHash === pending.preview.snapshotHash
              && Number(details.nextIndex) > expectedIndex) {
              next = details;
            } else {
              throw error;
            }
          }
          if (next?.status === "blocked" || next?.error === "IMPORT_REPREVIEW_REQUIRED") {
            pending = null;
            if (typeof api.syncSaveImportProgress === "function") await api.syncSaveImportProgress(null);
            throw new Error("云端数据在提交期间发生变化；请重新采集并预览后再确认。");
          }
          if (next?.error === "STALE_IMPORT_CURSOR"
            && (next.importId !== importResult.importId
              || next.snapshotHash !== pending.preview.snapshotHash
              || Number(next.nextIndex) <= expectedIndex)) {
            throw new Error("云端首次导入游标与本机记录不匹配，已停止续传。");
          }
          if (next.status !== "committed" && Number(next.nextIndex) <= expectedIndex) {
            throw new Error("首次导入没有取得进展，已停止以保护本地数据。");
          }
          importResult = next;
          pending.preview = { ...pending.preview, ...next };
          if (typeof api.syncSaveImportProgress === "function") {
            await api.syncSaveImportProgress({ ...pending.preview, snapshot: { records: pending.snapshot.records } });
          }
        }
        if (importResult.status !== "committed") throw new Error("首次导入分块过多，尚未完成。");

        const pulled = await pullAll();
        const cloudRecords = pulled.records;
        const finalSnapshot = await collect();
        if (canonicalJson(finalSnapshot.records) !== canonicalJson(pending.snapshot.records)) {
          throw new Error("云端提交后本地旧数据又发生变化；云端数据已安全保存，但尚未覆盖本地，请重新拉取。");
        }
        verifyCloudReadback(pending.snapshot, pending.preview, cloudRecords);
        const apply = await applyCloudRecords(cloudRecords);
        try {
          if (typeof api.syncFinishEnrollment === "function") await api.syncFinishEnrollment({
            records: cloudRecords,
            expectedOldCursor: Math.max(0, Number(pulled.status.cursor) || 0),
            newCursor: pulled.cursor,
            ...pulled.binding,
          });
        } catch (error) {
          if (apply?.backupId) await restoreBackupData(apply.backupId);
          throw error;
        }
        if (typeof api.syncSaveImportProgress === "function") await api.syncSaveImportProgress(null);
        pending = null;
        return { import: importResult, apply, cloudRecords };
      },
      async pullAndApply() {
        await beforeApply();
        const pulled = await pullAll();
        const apply = await applyCloudRecords(pulled.records);
        try {
          if (typeof api.syncCommitPull === "function") await api.syncCommitPull({
            expectedOldCursor: Math.max(0, Number(pulled.status.cursor) || 0),
            newCursor: pulled.cursor,
            records: pulled.records,
            deferredPullRecords: [],
            ...pulled.binding,
          });
        } catch (error) {
          if (apply?.backupId) await restoreBackupData(apply.backupId);
          throw error;
        }
        return { records: pulled.records, apply };
      },
      applyRemoteRecords: (records, options) => applyCloudRecords(records, options),
      conflicts: () => api.syncConflicts(),
      async resolveConflict(conflictId, input) {
        return api.syncResolveConflict(conflictId, input);
      },
      async restoreBackup(backupId) {
        await beforeApply();
        return restoreBackupData(backupId);
      },
      currentTimer: () => api.syncCurrentTimer(),
      async takeOverAndContinue() {
        const { timer } = await api.syncCurrentTimer();
        if (!timer) throw new Error("当前没有可接管的远端计时器。");
        return api.syncClaimTimer({
          mode: timer.mode,
          status: timer.status,
          expectedLeaseVersion: timer.leaseVersion,
          targetEndAt: timer.targetEndAt,
          remainingMs: timer.remainingMs,
          plannedMs: timer.plannedMs,
          sessionStartAt: timer.sessionStartAt,
          segmentStartAt: timer.segmentStartAt,
          accumulatedMs: timer.accumulatedMs,
          workType: timer.workType,
          takeover: true,
        });
      },
    };
  }

  return { canonicalJson, createEnrollmentController };
});
