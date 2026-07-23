(function (root, factory) {
  const runtime = factory();
  if (typeof module === "object" && module.exports) module.exports = runtime;
  if (root) root.DeepStudyTimerSync = runtime;
})(typeof window !== "undefined" ? window : null, function () {
  const TIMER_MODES = new Set(["focus", "rest"]);
  const PAYLOAD_KEYS = [
    "targetEndAt",
    "remainingMs",
    "plannedMs",
    "sessionStartAt",
    "segmentStartAt",
    "accumulatedMs",
    "workType",
  ];

  function createSingleFlightGate() {
    let pending = null;
    return {
      run(work) {
        if (pending) return pending;
        const current = Promise.resolve().then(work);
        pending = current.finally(() => {
          if (pending === wrapped) pending = null;
        });
        const wrapped = pending;
        return wrapped;
      },
      isPending() {
        return Boolean(pending);
      },
    };
  }

  function timerMatches(actual, expected, deviceId) {
    if (!actual || actual.ownerDeviceId !== deviceId) return false;
    if (actual.mode !== expected.mode || actual.status !== expected.status) return false;
    return PAYLOAD_KEYS.every((key) => {
      if (!Object.prototype.hasOwnProperty.call(expected, key)) return true;
      return actual[key] === expected[key];
    });
  }

  async function reconcileSameDeviceTimer({
    api,
    leaseManager,
    local,
    hydrate = () => {},
    now = () => Date.now(),
  }) {
    if (!local?.signedIn || !local?.enrollmentComplete) return { kind: "unavailable", timer: null };
    const result = await api.syncCurrentTimer({
      expectedScopeKey: local.scopeKey,
      expectedAuthGeneration: local.authGeneration,
    });
    const remote = result?.timer || null;
    if (!remote) return { kind: "none", timer: null };
    if (remote.ownerDeviceId !== local.deviceId) return { kind: "other-device", timer: remote };

    leaseManager.adopt(remote, local.scopeKey);
    const targetEndAt = Number(remote.targetEndAt);
    if (remote.status === "running" && Number.isFinite(targetEndAt) && targetEndAt <= now()) {
      const released = await leaseManager.release();
      return { kind: "expired", timer: remote, released };
    }

    hydrate(remote);
    return { kind: "same-device", timer: remote };
  }

  function createTimerLeaseManager({
    api,
    getStatus,
    onBlocked = () => {},
    onError = () => {},
    now = () => Date.now(),
    schedule = (work, delay) => setTimeout(work, delay),
    heartbeatIntervalMs = 5000,
    releaseRetryMs = 1500,
  }) {
    let ownedTimer = null;
    let lastPublishAt = 0;
    let operation = Promise.resolve();
    let releaseRetryScheduled = false;
    let updateRetryScheduled = false;
    let pendingUpdate = null;

    function enqueue(work) {
      const result = operation.then(work, work);
      operation = result.catch(() => {});
      return result;
    }

    function expectedBinding(local) {
      return {
        expectedScopeKey: local.scopeKey,
        expectedAuthGeneration: local.authGeneration,
      };
    }

    function retainUncertain(remote, local, property) {
      if (remote?.ownerDeviceId !== local.deviceId) {
        ownedTimer = null;
        return;
      }
      ownedTimer = {
        ...remote,
        scopeKey: local.scopeKey,
        [property]: true,
      };
    }

    function scheduleReleaseRetry(scopeKey, leaseVersion) {
      if (releaseRetryScheduled) return;
      releaseRetryScheduled = true;
      schedule(() => {
        releaseRetryScheduled = false;
        if (
          !ownedTimer?.uncertainRelease
          || ownedTimer.scopeKey !== scopeKey
          || ownedTimer.leaseVersion !== leaseVersion
        ) return true;
        return enqueue(() => releaseOwned(scopeKey)).catch((error) => {
          onError(error);
          if (ownedTimer?.uncertainRelease) {
            scheduleReleaseRetry(ownedTimer.scopeKey, ownedTimer.leaseVersion);
          }
          return false;
        });
      }, releaseRetryMs);
    }

    function scheduleUpdateRetry(pending) {
      if (updateRetryScheduled) return;
      updateRetryScheduled = true;
      schedule(() => {
        updateRetryScheduled = false;
        if (pendingUpdate !== pending
          || !ownedTimer?.uncertainUpdate
          || ownedTimer.scopeKey !== pending.scopeKey
          || ownedTimer.leaseVersion !== pending.leaseVersion) return true;
        return enqueue(() => claimOrUpdate(pending.timer, "retry")).then((settled) => {
          if (!settled && pendingUpdate) scheduleUpdateRetry(pendingUpdate);
          return settled;
        }).catch((error) => {
          onError(error);
          if (pendingUpdate) scheduleUpdateRetry(pendingUpdate);
          return false;
        });
      }, releaseRetryMs);
    }

    async function currentTimer(local) {
      const result = await api.syncCurrentTimer(expectedBinding(local));
      return result?.timer || null;
    }

    async function claimOrUpdate(timer, action) {
      if (!timer || !TIMER_MODES.has(timer.mode)) return false;
      if (action !== "retry") pendingUpdate = null;
      const publishedAt = now();
      if (action === "heartbeat" && publishedAt - lastPublishAt < heartbeatIntervalMs) return true;
      const local = await getStatus();
      if (!local.signedIn || !local.enrollmentComplete) return true;

      let expectedLeaseVersion = ownedTimer?.scopeKey === local.scopeKey
        ? ownedTimer.leaseVersion
        : null;
      try {
        if (expectedLeaseVersion == null) {
          const remote = await currentTimer(local);
          if (remote && remote.ownerDeviceId !== local.deviceId) {
            ownedTimer = null;
            onBlocked(remote);
            return false;
          }
          expectedLeaseVersion = remote?.leaseVersion || 0;
        }

        let requestError = null;
        try {
          await api.syncClaimTimer(
            { ...timer, expectedLeaseVersion, takeover: false },
            expectedBinding(local),
          );
        } catch (error) {
          requestError = error;
        }

        const readback = await currentTimer(local);
        if (!timerMatches(readback, timer, local.deviceId)) {
          if (readback?.ownerDeviceId === local.deviceId) {
            retainUncertain(readback, local, "uncertainUpdate");
            ownedTimer.uncertain = true;
            pendingUpdate = { scopeKey: local.scopeKey, leaseVersion: readback.leaseVersion, timer: { ...timer } };
            scheduleUpdateRetry(pendingUpdate);
          } else {
            pendingUpdate = null;
            retainUncertain(readback, local, "uncertain");
            if (readback) onBlocked(readback);
          }
          onError(requestError || new Error("计时器回读与本次操作不一致"));
          return false;
        }

        pendingUpdate = null;
        ownedTimer = { ...readback, scopeKey: local.scopeKey };
        lastPublishAt = publishedAt;
        return true;
      } catch (error) {
        if (ownedTimer?.scopeKey === local.scopeKey) {
          ownedTimer = { ...ownedTimer, uncertainUpdate: true };
          pendingUpdate = { scopeKey: local.scopeKey, leaseVersion: ownedTimer.leaseVersion, timer: { ...timer } };
          scheduleUpdateRetry(pendingUpdate);
        }
        onError(error);
        return false;
      }
    }

    async function releaseOwned(expectedScopeKey) {
      const local = await getStatus();
      if (!ownedTimer || ownedTimer.scopeKey !== local.scopeKey || local.scopeKey !== expectedScopeKey) {
        if (ownedTimer?.scopeKey !== local.scopeKey) ownedTimer = null;
        return true;
      }
      if (!local.signedIn || !local.enrollmentComplete) {
        retainUncertain(ownedTimer, local, "uncertainRelease");
        scheduleReleaseRetry(expectedScopeKey, ownedTimer.leaseVersion);
        return false;
      }
      const releasingLeaseVersion = ownedTimer.leaseVersion;

      let requestError = null;
      try {
        await api.syncReleaseTimer(
          { expectedLeaseVersion: ownedTimer.leaseVersion },
          expectedBinding(local),
        );
      } catch (error) {
        requestError = error;
      }

      try {
        const readback = await currentTimer(local);
        if (!readback || readback.ownerDeviceId !== local.deviceId) {
          ownedTimer = null;
          return true;
        }
        if (readback.leaseVersion !== releasingLeaseVersion) {
          ownedTimer = { ...readback, scopeKey: local.scopeKey };
          return true;
        }
        retainUncertain(readback, local, "uncertainRelease");
      } catch (error) {
        retainUncertain(ownedTimer, local, "uncertainRelease");
        requestError ||= error;
      }
      if (requestError) onError(requestError);
      scheduleReleaseRetry(expectedScopeKey, ownedTimer.leaseVersion);
      return false;
    }

    return {
      claim(timer) {
        return enqueue(() => claimOrUpdate(timer, "claim"));
      },
      publish(action, timer) {
        if (action === "release") return this.release(timer);
        return enqueue(() => claimOrUpdate(timer, action));
      },
      release() {
        pendingUpdate = null;
        const scopeKey = ownedTimer?.scopeKey;
        if (!scopeKey) return Promise.resolve(true);
        return enqueue(() => releaseOwned(scopeKey));
      },
      adopt(timer, scopeKey) {
        pendingUpdate = null;
        ownedTimer = timer ? { ...timer, scopeKey } : null;
      },
      getOwnedTimer() {
        return ownedTimer ? { ...ownedTimer } : null;
      },
    };
  }

  return { createSingleFlightGate, createTimerLeaseManager, reconcileSameDeviceTimer, timerMatches };
});
