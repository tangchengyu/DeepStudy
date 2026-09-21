(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeepStudyContinuousSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function identity(record) {
    return `${record.entityType}\u0000${record.entityId}`;
  }

  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }

  function semanticallyEqual(left, right) {
    return Boolean(left && right)
      && left.deleted === right.deleted
      && left.legacySourceId === right.legacySourceId
      && canonical(left.payload) === canonical(right.payload);
  }

  function mutationId() {
    return `desktop:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`;
  }

  function* mutationBatches(mutations) {
    const encoder = new TextEncoder();
    let batch = [];
    let bytes = 32;
    for (const mutation of mutations) {
      const size = encoder.encode(JSON.stringify(mutation)).byteLength + 1;
      if (batch.length && (batch.length === 5 || bytes + size > 880000)) {
        yield batch;
        batch = [];
        bytes = 32;
      }
      batch.push(mutation);
      bytes += size;
    }
    if (batch.length) yield batch;
  }

  function referencedImageIds(records) {
    const ids = new Set();
    for (const record of records) {
      if (record.entityType !== "long_task" || record.deleted) continue;
      for (const match of String(record.payload?.notes || "").matchAll(/deepstudy-image:\/\/([^\s)]+)/g)) {
        if (match[1]) ids.add(match[1]);
      }
    }
    return ids;
  }

  function buildMutations(records, state) {
    const current = new Map(records.map((record) => [identity(record), record]));
    const known = new Map((state.records || []).map((record) => [identity(record), record]));
    const pending = new Map((state.outbox || []).map((mutation) => [identity(mutation.record), mutation]));
    const referencedImages = referencedImageIds(records);
    const mutations = [];
    for (const [key, record] of current) {
      if (pending.get(key)?.blocked) continue;
      const previous = pending.get(key)?.record || known.get(key);
      if (semanticallyEqual(record, previous)) continue;
      mutations.push({
        mutationId: mutationId(),
        baseRevision: Math.max(0, Number(pending.get(key)?.baseRevision ?? state.revisions?.[key] ?? 0) || 0),
        record: { ...record, revision: Math.max(0, Number(state.revisions?.[key]) || 0), serverUpdatedAt: null },
      });
    }
    const previousRecords = new Map(known);
    for (const [key, mutation] of pending) previousRecords.set(key, mutation.record);
    for (const [key, previous] of previousRecords) {
      if (previous.deleted || current.has(key) || pending.get(key)?.blocked) continue;
      if (previous.entityType === "long_task_image_chunk" && referencedImages.has(previous.payload?.imageId)) continue;
      mutations.push({
        mutationId: mutationId(),
        baseRevision: Math.max(0, Number(pending.get(key)?.baseRevision ?? state.revisions?.[key] ?? previous.revision ?? 0) || 0),
        record: {
          ...previous,
          payload: previous.payload || {},
          deleted: true,
          revision: Math.max(0, Number(state.revisions?.[key] ?? previous.revision ?? 0) || 0),
          serverUpdatedAt: null,
          clientUpdatedAt: Date.now(),
        },
      });
    }
    return mutations;
  }

  function createContinuousSync({ api, legacySync, storage, applyPulled = async () => {}, rollbackPulled = async () => {}, runExclusive = (work) => work(), intervalMs = 15000, idleIntervalMs = 60000, onError = () => {}, onStateChange = () => {}, timers = globalThis }) {
    let timer = null;
    let syncPromise = null;
    let enabled = false;
    let failures = 0;
    let changedDuringSync = false;
    let serverRetryNotBefore = 0;
    let lastSyncedAt = 0;
    const pollInterval = Math.max(5000, intervalMs);

    function publish(state) {
      onStateChange({ lastSyncedAt, ...state });
    }

    function schedule(delay) {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      if (!enabled) return;
      timer = timers.setTimeout(() => {
        timer = null;
        void syncOnce().catch(() => {});
      }, delay);
    }

    async function snapshot(deviceId) {
      return legacySync.collectConsistentSnapshot({
        storage,
        deviceId,
        captureLongTasks: () => api.syncCaptureLongTasks(),
        verifyLongTasks: (fingerprint) => api.syncVerifyLongTasks(fingerprint),
      });
    }

    async function applyResolvedDeferred(deviceId, binding, state) {
      const pending = Array.isArray(state.deferredPullRecords) ? state.deferredPullRecords : [];
      if (!pending.length || typeof api.syncCommitPull !== "function") return state;
      const blocked = new Set((state.outbox || [])
        .map((mutation) => identity(mutation.record)));
      const applicable = pending.filter((record) => !blocked.has(identity(record)));
      if (!applicable.length) return state;
      const stillDeferred = pending.filter((record) => blocked.has(identity(record)));
      let applied = null;
      try {
        await api.syncOutboxState(binding);
        applied = await applyPulled(applicable, deviceId);
        await api.syncOutboxState(binding);
        await api.syncCommitPull({
          ...binding,
          expectedOldCursor: state.cursor,
          newCursor: state.cursor,
          records: applicable,
          deferredPullRecords: stillDeferred,
        });
      } catch (error) {
        if (applied?.backupId) await rollbackPulled(applied.backupId);
        throw error;
      }
      return api.syncOutboxState(binding);
    }

    async function activateLocalProfile(deviceId, binding, state) {
      if (!binding.expectedScopeKey) return state;
      if (!state.localProfileScopeKey && !state.enrolled) return state;
      if (state.localProfileScopeKey === binding.expectedScopeKey) return state;
      const current = await snapshot(deviceId);
      const desired = new Map();
      for (const record of state.records || []) desired.set(identity(record), record);
      // A durable local mutation is the account's newest local version and must
      // survive switching away and back, including blocked conflicts.
      for (const mutation of state.outbox || []) {
        if (mutation?.record) desired.set(identity(mutation.record), mutation.record);
      }
      const switchRecords = [...desired.values()];
      for (const record of current.records || []) {
        if (!desired.has(identity(record))) {
          switchRecords.push({ ...record, deleted: true, clientUpdatedAt: Date.now() });
        }
      }
      let applied = null;
      try {
        await api.syncOutboxState(binding);
        if (switchRecords.length) applied = await applyPulled(switchRecords, deviceId, { profileReplace: true });
        await api.syncOutboxState(binding);
        await api.syncCommitPull({
          ...binding,
          expectedOldCursor: state.cursor,
          newCursor: state.cursor,
          records: [],
          deferredPullRecords: state.deferredPullRecords || [],
          markLocalProfileScope: true,
        });
      } catch (error) {
        if (applied?.backupId) await rollbackPulled(applied.backupId);
        throw error;
      }
      return api.syncOutboxState(binding);
    }

    async function pullAndMerge(deviceId, binding, state, beforeNetwork) {
      const expectedOldCursor = Math.max(0, Number(state.cursor) || 0);
      let cursor = expectedOldCursor;
      const pulledRecords = [];
      for (let page = 0; page < 10000; page += 1) {
        const result = await api.syncPull({ cursor, limit: 200, advanceCursor: false, ...binding });
        pulledRecords.push(...(Array.isArray(result.records) ? result.records : []));
        const previous = cursor;
        const next = Math.max(previous, Number(result.cursor) || previous);
        cursor = next;
        if (!result.hasMore) break;
        if (next === previous) throw new Error("同步服务返回了无进展的拉取游标。");
      }
      // A user can save while a network request is waiting. Capture those edits
      // before applying the response, so a remote version cannot overwrite them.
      const latest = await snapshot(deviceId);
      const before = new Map(beforeNetwork.map((record) => [identity(record), record]));
      const current = new Map(latest.records.map((record) => [identity(record), record]));
      const changed = new Set([...before.keys(), ...current.keys()].filter((key) => !semanticallyEqual(before.get(key), current.get(key))));
      const concurrentMutations = buildMutations(latest.records, state).filter((mutation) => changed.has(identity(mutation.record)));
      if (concurrentMutations.length) {
        await api.syncOutboxQueue(concurrentMutations, binding);
        state = await api.syncOutboxState(binding);
      }
      const blocked = new Set((state.outbox || []).map((mutation) => identity(mutation.record)));
      const combined = new Map();
      for (const record of [...(state.deferredPullRecords || []), ...pulledRecords]) {
        if (record?.entityType && record?.entityId) combined.set(identity(record), record);
      }
      const records = [...combined.values()];
      const applicable = records.filter((record) => !blocked.has(identity(record)));
      const deferredPullRecords = records.filter((record) => blocked.has(identity(record)));
      let applied = null;
      if (applicable.length) {
        await api.syncOutboxState(binding);
        applied = await applyPulled(applicable, deviceId);
      }
      try {
        // The binding check and durable commit are deliberately inside the same
        // rollback boundary as the local apply. An account switch at this point
        // must not leave the previous account's records in the renderer profile.
        await api.syncOutboxState(binding);
        if (typeof api.syncCommitPull === "function") {
          await api.syncCommitPull({
            ...binding,
            expectedOldCursor,
            newCursor: cursor,
            records: applicable,
            deferredPullRecords,
          });
        } else if (applicable.length) {
          await api.syncRememberRecords(applicable, binding.expectedScopeKey);
        }
      } catch (error) {
        if (applied?.backupId) await rollbackPulled(applied.backupId);
        throw error;
      }
      return records;
    }

    async function syncCore() {
      try {
        const status = await api.syncStatus();
        if (!status?.signedIn) return { skipped: "signed-out" };
        const binding = { expectedScopeKey: status.scopeKey, expectedAuthGeneration: status.authGeneration };
        let state = await api.syncOutboxState(binding);
        state = await activateLocalProfile(status.deviceId, binding, state);
        if (!state?.enrolled) return { skipped: "not-enrolled" };
        // A keep-remote conflict result must be installed before change
        // detection, otherwise the losing local payload would be queued again.
        state = await applyResolvedDeferred(status.deviceId, binding, state);
        const local = await snapshot(status.deviceId);
        const mutations = buildMutations(local.records, state);
        if (mutations.length) await api.syncOutboxQueue(mutations, binding);
        const durable = await api.syncOutboxState(binding);
        const outgoing = (durable.outbox || []).filter((mutation) => !mutation.blocked);
        let results = [];
        for (const batch of mutationBatches(outgoing)) {
          const pushed = await api.syncPush(batch, binding);
          const chunkResults = Array.isArray(pushed?.results) ? pushed.results : [];
          results.push(...chunkResults);
          if (chunkResults.length) await api.syncOutboxSettle(chunkResults, binding);
        }
        const afterPush = await api.syncOutboxState(binding);
        const records = await pullAndMerge(status.deviceId, binding, afterPush, local.records);
        const settled = await api.syncOutboxState(binding);
        return {
          mutations: mutations.length, results, records,
          pendingCount: (settled.outbox || []).filter((mutation) => !mutation.blocked).length,
          conflictCount: (settled.outbox || []).filter((mutation) => mutation.blocked).length,
        };
      } catch (error) {
        onError(error);
        throw error;
      }
    }

    function syncOnce() {
      if (syncPromise) return syncPromise;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      changedDuringSync = false;
      publish({ phase: "syncing" });
      const current = Promise.resolve().then(() => runExclusive(syncCore));
      syncPromise = current.then((result) => {
        failures = 0;
        serverRetryNotBefore = 0;
        if (result.skipped) {
          enabled = false;
          publish({ phase: result.skipped });
          return result;
        }
        lastSyncedAt = Date.now();
        publish({ phase: "synced", ...result });
        const active = result.mutations || result.results.length || result.records.length;
        schedule(changedDuringSync || result.pendingCount ? 2000 : active ? pollInterval : Math.max(pollInterval, idleIntervalMs));
        return result;
      }, (error) => {
        failures += 1;
        const serverDelay = Math.max(0, Number(error?.retryAfterSeconds ?? error?.details?.retryAfterSeconds) || 0) * 1000;
        serverRetryNotBefore = serverDelay ? Date.now() + serverDelay : 0;
        const retryDelayMs = Math.max(serverDelay, Math.min(300000, pollInterval * (2 ** Math.min(5, failures - 1))));
        publish({ phase: "retrying", error, retryDelayMs });
        schedule(retryDelayMs);
        throw error;
      }).finally(() => {
        if (syncPromise === wrapped) syncPromise = null;
      });
      const wrapped = syncPromise;
      return wrapped;
    }

    return {
      syncOnce,
      start() {
        if (enabled) return;
        enabled = true;
        void syncOnce().catch(() => {});
      },
      notifyLocalChange() {
        if (!enabled) return;
        if (syncPromise) { changedDuringSync = true; return; }
        if (!failures) schedule(2000);
      },
      wake() {
        if (!enabled || Date.now() < serverRetryNotBefore) return;
        void syncOnce().catch(() => {});
      },
      stop() {
        enabled = false;
        if (timer !== null) timers.clearTimeout(timer);
        timer = null;
      },
    };
  }

  return { buildMutations, createContinuousSync };
});
