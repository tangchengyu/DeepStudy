(function () {
  if (!window.electronAPI || !window.DeepStudyLegacySync || !window.DeepStudySyncEnrollment) return;

  const byId = (id) => document.getElementById(id);
  const modal = byId("sync-modal");
  const status = byId("sync-status");
  const recoveryCode = byId("sync-recovery-code");
  const recoveryWrap = byId("sync-recovery-code-wrap");
  const confirmImport = byId("sync-import-confirm");
  const previewResult = byId("sync-preview-result");
  const conflictList = byId("sync-conflict-list");
  const deviceRetry = byId("sync-device-retry");
  const timerSection = byId("sync-timer-section");
  const timerSummary = byId("sync-timer-summary");
  const recoverySaved = byId("sync-recovery-saved");
  let profileOperation = Promise.resolve();
  let profileTransitioning = false;

  function runProfileExclusive(work) {
    const result = profileOperation.then(work, work);
    profileOperation = result.catch(() => {});
    return result;
  }
  const controller = window.DeepStudySyncEnrollment.createEnrollmentController({
    api: window.electronAPI,
    legacySync: window.DeepStudyLegacySync,
    storage: window.localStorage,
    deviceName: navigator.userAgentData?.platform || navigator.platform || "DeepStudy desktop",
    platform: /Mac/i.test(navigator.platform) ? "macos" : /Win/i.test(navigator.platform) ? "windows" : "desktop",
    beforeApply: async () => window.dispatchEvent(new CustomEvent("deepstudy:before-sync-apply")),
  });
  const continuousSync = window.DeepStudyContinuousSync.createContinuousSync({
    api: window.electronAPI,
    legacySync: window.DeepStudyLegacySync,
    storage: window.localStorage,
    applyPulled: async (records, _deviceId, options) => controller.applyRemoteRecords(records, options),
    rollbackPulled: async (backupId) => controller.restoreBackup(backupId),
    runExclusive: runProfileExclusive,
    onError: (error) => setStatus(`后台同步失败：${error?.message || error}`, true),
  });
  const timerLease = window.DeepStudyTimerSync.createTimerLeaseManager({
    api: window.electronAPI,
    getStatus: () => controller.status(),
    onBlocked: () => {
      window.dispatchEvent(new CustomEvent("deepstudy:before-sync-apply"));
      timerSection.hidden = false;
      timerSummary.textContent = "另一台设备正在计时；请明确点击“接管并继续”后再继续本机计时。";
    },
    onError: (error) => setStatus(`计时器同步未接管：${error?.message || error}`, true),
  });
  window.DeepStudyTimerLease = {
    claim: (timer) => timerLease.claim(timer),
  };

  async function reconcileTimer(local) {
    return window.DeepStudyTimerSync.reconcileSameDeviceTimer({
      api: window.electronAPI,
      leaseManager: timerLease,
      local,
      hydrate: (timer) => window.dispatchEvent(new CustomEvent("deepstudy:timer-takeover", { detail: { timer } })),
    });
  }

  async function runAuthTransition(work) {
    profileTransitioning = true;
    continuousSync.stop();
    try {
      const before = await controller.status();
      if (before.signedIn && before.enrollmentComplete) {
        await reconcileTimer(before);
        window.dispatchEvent(new CustomEvent("deepstudy:before-sync-apply"));
        const timerReleased = await timerLease.release();
        if (!timerReleased) {
          throw new Error("当前账号的计时器租约尚未安全释放；已暂停账号切换，请联网后重试。");
        }
        await continuousSync.syncOnce();
        const settled = await controller.status();
        if (settled.outboxCount || settled.blockedConflictCount || settled.deferredPullCount) {
          throw new Error("当前账号仍有未上传修改或待处理冲突；请先完成同步和冲突处理，再切换账号。");
        }
      }
      return await runProfileExclusive(work);
    } finally {
      profileTransitioning = false;
      void controller.status().then((current) => {
        if (current.signedIn && current.enrollmentComplete) continuousSync.start();
      }).catch(() => {});
    }
  }

  function setStatus(message, isError = false) {
    status.textContent = String(message || "");
    status.classList.toggle("error", isError);
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  function authInput() {
    return {
      gatewayUrl: byId("sync-gateway-url").value.trim(),
      username: byId("sync-username").value.trim(),
      password: byId("sync-password").value,
      turnstileToken: byId("sync-turnstile-token").value.trim(),
    };
  }

  function showRecoveryCode(value) {
    recoveryCode.textContent = String(value || "");
    recoveryWrap.hidden = !value;
    recoverySaved.checked = false;
  }

  function mayCloseRecoveryNotice() {
    if (!recoveryWrap.hidden && !recoverySaved.checked) {
      setStatus("请先确认已离线保存恢复码。", true);
      return false;
    }
    return true;
  }

  function reloadAfterApply() {
    setTimeout(() => window.location.reload(), 800);
  }

  async function action(button, work, successText) {
    setBusy(button, true);
    setStatus("处理中…");
    try {
      const result = await work();
      setStatus(successText);
      return result;
    } catch (error) {
      setStatus(error?.message || String(error), true);
      return null;
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshStatus() {
    const local = await controller.status();
    byId("sync-gateway-url").value ||= local.gatewayUrl || "";
    byId("sync-username").value ||= local.username || "";
    const storageNote = local.credentialStorage?.warning ? ` ${local.credentialStorage.warning}` : "";
    if (!local.signedIn) {
      setStatus(`尚未登录。${storageNote}`);
      timerSection.hidden = true;
      return;
    }
    let session;
    try {
      session = await controller.session();
      setStatus(`已登录${session.user?.username ? `：${session.user.username}` : ""}。${storageNote}`);
    } catch (error) {
      setStatus(error?.message || String(error), true);
      timerSection.hidden = true;
      return;
    }
    try {
      const timerState = await reconcileTimer(local);
      const timer = timerState.timer;
      timerSection.hidden = timerState.kind !== "other-device";
      if (timerState.kind === "other-device") {
        timerSummary.textContent = `${timer.mode === "rest" ? "休息" : "专注"}模式 · ${Math.ceil(timer.remainingMs / 60000)} 分钟剩余`;
      } else if (timerState.kind === "expired" && !timerState.released) {
        setStatus("本机上次计时已结束，但云端租约暂未释放；联网后将自动重试。", true);
      }
    } catch (error) {
      setStatus(error?.message || String(error), true);
    }
  }

  function renderPreview(preview) {
    const counts = preview?.counts || {};
    previewResult.textContent = `本地 ${counts.local || 0} 条；新增 ${counts.additions || 0} 条；重复 ${counts.duplicates || 0} 条；分叉保留 ${counts.conflicts || 0} 条。`;
    confirmImport.disabled = false;
  }

  function conflictButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function refreshConflicts() {
    const result = await controller.conflicts();
    conflictList.replaceChildren();
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    if (!conflicts.length) {
      const empty = document.createElement("p");
      empty.textContent = "没有待处理冲突。";
      conflictList.append(empty);
      return;
    }
    for (const conflict of conflicts) {
      const item = document.createElement("article");
      item.className = "sync-conflict-item";
      const summary = document.createElement("p");
      summary.textContent = `${conflict.entityType} / ${conflict.entityId}`;
      const versions = document.createElement("div");
      versions.className = "sync-conflict-versions";
      for (const [label, record] of [["本机版本", conflict.local], ["云端版本", conflict.remote]]) {
        const section = document.createElement("section");
        const heading = document.createElement("strong");
        const content = document.createElement("pre");
        heading.textContent = label;
        content.textContent = JSON.stringify(record?.payload ?? record ?? null, null, 2);
        section.append(heading, content);
        versions.append(section);
      }
      const actions = document.createElement("div");
      actions.className = "sync-actions";
      actions.append(
        conflictButton("保留云端", "secondary-btn", async (event) => {
          const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.resolveConflict(conflict.id, {
            resolution: "keep_remote",
            operationId: `desktop:resolve:${conflict.id}:keep_remote`,
          })), "冲突已解决。");
          if (result) { await continuousSync.syncOnce(); await refreshConflicts(); }
        }),
        conflictButton("保留本机", "primary-btn", async (event) => {
          const mutationId = `desktop:resolve:${conflict.id}:keep_local`;
          const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.resolveConflict(conflict.id, {
            resolution: "keep_local",
            mutationId,
            operationId: mutationId,
            expectedRemoteRevision: Number(conflict.remote?.revision) || 0,
          })), "本机版本已保存到云端。");
          if (result) { await continuousSync.syncOnce(); await refreshConflicts(); }
        }),
      );
      item.append(summary, versions, actions);
      conflictList.append(item);
    }
  }

  byId("sync-account-open").addEventListener("click", async () => {
    modal.hidden = false;
    await refreshStatus();
  });
  byId("sync-close").addEventListener("click", () => { if (mayCloseRecoveryNotice()) modal.hidden = true; });
  modal.addEventListener("click", (event) => { if (event.target === modal && mayCloseRecoveryNotice()) modal.hidden = true; });
  recoverySaved.addEventListener("change", () => {
    if (recoverySaved.checked) setStatus("恢复码已确认保存。请妥善保管，它只显示这一次。");
  });

  byId("sync-register").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const result = await action(event.currentTarget, () => runAuthTransition(() => controller.register(authInput())), "注册成功；请立即保存恢复码。");
    if (result?.recoveryCode) showRecoveryCode(result.recoveryCode);
    byId("sync-password").value = "";
    byId("sync-turnstile-token").value = "";
    if (result) {
      await refreshStatus();
      continuousSync.start();
      deviceRetry.hidden = !result.deviceRegistrationWarning;
      if (result.deviceRegistrationWarning) setStatus(`${result.deviceRegistrationWarning}；请点击“重试设备登记”。`, true);
    }
  });
  byId("sync-sign-in").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const result = await action(event.currentTarget, () => runAuthTransition(() => controller.signIn(authInput())), "登录成功。");
    byId("sync-password").value = "";
    byId("sync-turnstile-token").value = "";
    if (result) {
      await refreshStatus();
      continuousSync.start();
      deviceRetry.hidden = !result.deviceRegistrationWarning;
      if (result.deviceRegistrationWarning) setStatus(`${result.deviceRegistrationWarning}；请点击“重试设备登记”。`, true);
    }
  });
  byId("sync-sign-out").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const result = await action(event.currentTarget, () => runAuthTransition(() => controller.signOut()), "已退出账号。");
    if (!result) return;
    showRecoveryCode("");
    deviceRetry.hidden = true;
    await refreshStatus();
  });
  deviceRetry.addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => controller.registerDevice(), "设备登记成功，可以继续同步。");
    if (result) deviceRetry.hidden = true;
  });
  byId("sync-recover").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const input = authInput();
    const result = await action(event.currentTarget, () => runAuthTransition(() => controller.recover({
      gatewayUrl: input.gatewayUrl,
      username: input.username,
      recoveryCode: byId("sync-recovery-input").value.trim(),
      newPassword: byId("sync-new-password").value,
      turnstileToken: input.turnstileToken,
    })), "密码已重设；请保存新的恢复码后重新登录。");
    byId("sync-recovery-input").value = "";
    byId("sync-new-password").value = "";
    byId("sync-turnstile-token").value = "";
    if (result?.recoveryCode) showRecoveryCode(result.recoveryCode);
  });
  byId("sync-import-preview").addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.previewFirstImport()), "预览完成，本地数据尚未写入云端。");
    if (result) renderPreview(result);
  });
  confirmImport.addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.commitFirstImport()), "首次导入、云端读回和本地校验均已完成。");
    if (result) {
      confirmImport.disabled = true;
      previewResult.textContent = `已应用 ${result.apply.appliedRecords} 条；本地备份编号：${result.apply.backupId}`;
      reloadAfterApply();
      continuousSync.start();
    }
  });
  byId("sync-pull").addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => continuousSync.syncOnce(), "云端数据已安全同步、备份并验证写回。");
    if (result) {
      previewResult.textContent = `同步完成：上传 ${result.mutations || 0} 条，拉取核对 ${result.records?.length || 0} 条。`;
      reloadAfterApply();
    }
  });
  byId("sync-conflicts").addEventListener("click", async (event) => {
    await action(event.currentTarget, refreshConflicts, "冲突列表已刷新。");
  });
  byId("sync-backup-restore").addEventListener("click", async (event) => {
    const backupId = byId("sync-backup-id").value.trim();
    if (!backupId) return setStatus("请输入备份编号。", true);
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.restoreBackup(backupId)), "备份已恢复并完成读取校验。");
    if (result) reloadAfterApply();
  });
  byId("sync-takeover").addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => controller.takeOverAndContinue(), "已接管远端计时器。");
    if (result?.timer) {
      const local = await controller.status();
      timerLease.adopt(result.timer, local.scopeKey);
      window.dispatchEvent(new CustomEvent("deepstudy:timer-takeover", { detail: { timer: result.timer } }));
      timerSection.hidden = true;
    }
  });
  window.addEventListener("deepstudy:timer-publish", (event) => { void timerLease.publish(event.detail?.action, event.detail?.timer); });
  window.addEventListener("online", () => { if (!profileTransitioning) void continuousSync.syncOnce().catch(() => {}); });
  void controller.status().then(async (state) => {
    if (state.signedIn && state.enrollmentComplete) {
      await refreshStatus();
      continuousSync.start();
    }
  }).catch((error) => setStatus(error?.message || String(error), true));
})();
