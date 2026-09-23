(function () {
  if (!window.electronAPI || !window.DeepStudyLegacySync || !window.DeepStudySyncEnrollment) return;

  const byId = (id) => document.getElementById(id);
  const modal = byId("sync-modal");
  const status = byId("sync-status");
  const automaticStatus = byId("sync-auto-status");
  const recoveryCode = byId("sync-recovery-code");
  const recoveryWrap = byId("sync-recovery-code-wrap");
  const confirmImport = byId("sync-import-confirm");
  const previewResult = byId("sync-preview-result");
  const conflictList = byId("sync-conflict-list");
  const conflictToolbar = byId("sync-conflict-toolbar");
  const conflictProgress = byId("sync-conflict-progress");
  const keepAllRemote = byId("sync-conflicts-keep-remote");
  const keepAllLocal = byId("sync-conflicts-keep-local");
  const deviceRetry = byId("sync-device-retry");
  const timerSection = byId("sync-timer-section");
  const timerSummary = byId("sync-timer-summary");
  const recoverySaved = byId("sync-recovery-saved");
  const authSection = byId("sync-wizard-auth");
  const importSection = byId("sync-wizard-import");
  const manageSection = byId("sync-wizard-manage");
  const sessionBadge = byId("sync-session-badge");
  const turnstileStatus = byId("sync-turnstile-status");
  const turnstileOpen = byId("sync-turnstile-open");
  const ACCOUNT_TURNSTILE_ACTION = "account-sync";
  let profileOperation = Promise.resolve();
  let profileTransitioning = false;
  let gatewayConfig = { turnstileSiteKey: "", minimumPasswordLength: 10 };
  let gatewayConfigRequest = 0;
  let turnstileToken = "";
  let turnstileAction = ACCOUNT_TURNSTILE_ACTION;
  let gatewayConfigTimer = 0;
  let turnstileTokenTimer = 0;
  let sessionErrorVisible = false;
  let currentConflicts = [];
  let automaticConflictScan = null;

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
    onImportProgress: (event) => {
      if (event?.phase === "commit") {
        const done = Math.max(0, Number(event.nextIndex) || 0);
        const total = Math.max(done, Number(event.totalItems) || 0);
        setStatus(`正在上传本机旧数据到账号：已提交 ${done}/${total} 条，请保持窗口打开。`);
      } else if (event?.phase === "pull") {
        setStatus(`正在从账号读回校验：已读取 ${Math.max(0, Number(event.nextIndex) || 0)} 条。`);
      } else if (event?.phase === "apply") {
        setStatus(`正在写入本机并创建备份：已应用 ${Math.max(0, Number(event.nextIndex) || 0)} 条。`);
      } else if (event?.phase === "finish") {
        setStatus("首次同步已完成，正在进入日常同步管理。");
      }
    },
  });
  const continuousSync = window.DeepStudyContinuousSync.createContinuousSync({
    api: window.electronAPI,
    legacySync: window.DeepStudyLegacySync,
    storage: window.localStorage,
    applyPulled: async (records, _deviceId, options) => controller.applyRemoteRecords(records, options),
    rollbackPulled: async (backupId) => controller.restoreBackup(backupId),
    runExclusive: runProfileExclusive,
    onStateChange: renderAutomaticStatus,
  });
  const timerLease = window.DeepStudyTimerSync.createTimerLeaseManager({
    api: window.electronAPI,
    getStatus: () => controller.status(),
    onBlocked: (remote) => {
      window.dispatchEvent(new CustomEvent("deepstudy:before-sync-apply"));
      window.dispatchEvent(new CustomEvent("deepstudy:timer-blocked", { detail: { timer: remote } }));
      timerSection.hidden = false;
      timerSummary.textContent = "另一台设备正在计时；请明确点击“接管并继续”后再继续本机计时。";
    },
    onError: (error) => setStatus(`计时器同步未接管：${error?.message || error}`, true),
    onOffline: (error) => window.dispatchEvent(new CustomEvent("deepstudy:timer-offline", {
      detail: { message: error?.message || String(error) },
    })),
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
    sessionErrorVisible = false;
    status.textContent = String(message || "");
    status.classList.toggle("error", isError);
  }

  function renderConflictCount(value) {
    const count = Math.max(0, Number(value) || 0);
    const badge = byId("sync-conflict-count");
    const accountButton = byId("sync-account-open");
    badge.textContent = String(count);
    badge.hidden = count === 0;
    accountButton.classList.toggle("has-conflicts", count > 0);
    accountButton.setAttribute("aria-label", count > 0 ? `账号同步，${count} 条待处理冲突` : "账号同步");
  }

  function scheduleAutomaticConflictScan() {
    if (automaticConflictScan) return;
    automaticConflictScan = new Promise((resolve) => setTimeout(resolve, 0))
      .then(() => refreshConflicts({ autoResolve: true }))
      .catch((error) => setStatus(formatSyncError(error), true))
      .finally(() => { automaticConflictScan = null; });
  }

  function renderAutomaticStatus(state) {
    let message = "自动同步已开启，正在检查更新…";
    let isError = false;
    if (state.phase === "retrying") {
      const retryAt = new Date(Date.now() + state.retryDelayMs).toLocaleTimeString();
      message = `${formatSyncError(state.error)} 本机数据已保留，将于 ${retryAt} 自动重试。`;
      isError = true;
    } else if (state.phase === "synced") {
      const time = new Date(state.lastSyncedAt).toLocaleTimeString();
      message = `自动同步已开启 · 最近已同步 ${time}`;
      if (state.pendingCount) message += ` · ${state.pendingCount} 条修改等待上传`;
      if (state.conflictCount) message += ` · ${state.conflictCount} 条冲突需要在“查看冲突”中选择保留版本`;
      isError = Boolean(state.conflictCount);
      renderConflictCount(state.conflictCount);
      if (state.conflictCount) scheduleAutomaticConflictScan();
      if (state.records?.length) notifySyncApplied();
      if (sessionErrorVisible) setStatus("连接已恢复，账号正在自动同步。");
    } else if (state.phase === "signed-out") {
      message = "登录账号后可开启自动同步。";
      renderConflictCount(0);
      void refreshStatus();
    } else if (state.phase === "not-enrolled") {
      message = "完成一次首次同步后，将自动同步后续修改。";
    }
    automaticStatus.textContent = message;
    automaticStatus.classList.toggle("error", isError);
    byId("sync-account-open").title = message;
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  function setTurnstileStatus(message, isError = false) {
    turnstileStatus.textContent = String(message || "");
    turnstileStatus.classList.toggle("error", isError);
  }

  function passwordRuleText(prefix = "密码") {
    return `${prefix}需要 ${gatewayConfig.minimumPasswordLength}-128 个字符；可以使用字母、数字、符号或中文。`;
  }

  function updatePasswordGuidance() {
    const passwordRule = byId("sync-password-rule");
    const newPasswordRule = byId("sync-new-password-rule");
    if (passwordRule) passwordRule.textContent = passwordRuleText("密码");
    if (newPasswordRule) newPasswordRule.textContent = passwordRuleText("新密码");
  }

  function validateNewPassword(value, label = "密码") {
    const length = String(value || "").length;
    if (length < gatewayConfig.minimumPasswordLength || length > 128) {
      throw new Error(passwordRuleText(label));
    }
  }

  function formatSyncError(error) {
    const rawCode = String(error?.code || error?.details?.error || error?.message || "");
    const messages = {
      INVALID_PASSWORD: passwordRuleText("密码"),
      INVALID_RECOVERY_REQUEST: `恢复信息不符合要求：请检查用户名、恢复码和新密码。${passwordRuleText("新密码")}`,
      INVALID_USERNAME: "用户名格式不正确：请使用 3-30 位字母、数字或下划线。",
      INVALID_CREDENTIALS: "用户名或密码不正确，请检查后重试。",
      INVALID_RECOVERY_CODE: "恢复码不正确或已经使用过。",
      TURNSTILE_REJECTED: "人机验证已过期或未通过，请重新打开浏览器验证。",
      RATE_LIMITED: "操作太频繁，请稍后再试。",
      USERNAME_EXISTS: "这个用户名已经被注册，请换一个用户名或直接登录。",
      UNAUTHORIZED: "登录已过期，请重新登录，保存的本机数据会保留。",
      INTERNAL_ERROR: "同步服务暂时不可用，请稍后重试。",
      NETWORK_ERROR: "暂时无法连接同步服务，请检查网络连接。",
      NETWORK_TIMEOUT: "同步服务响应超时，请稍后重试。",
      SYNC_DAILY_READ_LIMIT: "同步服务今日读取额度已用完，额度恢复后会继续同步。",
      SYNC_DAILY_WRITE_LIMIT: "同步服务今日写入额度已用完，额度恢复后会继续同步。",
      SYNC_STORAGE_LIMIT: "同步服务存储空间已满，需要服务管理员处理后继续同步。本机资料仍然保留。",
      REQUEST_TOO_LARGE: "本次同步数据超过单次传输限制。本机资料仍然保留，请联系维护者处理，无需反复退出账号。",
    };
    const code = Object.keys(messages).find((key) => rawCode === key || new RegExp(`\\b${key}\\b`).test(rawCode));
    return messages[code] || error?.message || String(error);
  }

  function shouldResetTurnstileAfterAuthError(error) {
    const code = String(error?.code || error?.details?.error || "");
    return Boolean(code && ![
      "INVALID_PASSWORD",
      "INVALID_RECOVERY_REQUEST",
      "INVALID_USERNAME",
      "INVALID_CREDENTIALS",
      "INVALID_RECOVERY_CODE",
      "RATE_LIMITED",
    ].includes(code));
  }

  function rememberTurnstileToken(token) {
    clearTimeout(turnstileTokenTimer);
    turnstileToken = String(token || "");
    if (!turnstileToken) return;
    turnstileTokenTimer = setTimeout(() => {
      turnstileToken = "";
      setTurnstileStatus("人机验证已过期，请重新打开浏览器验证。", true);
    }, 270000);
  }

  function resetTurnstileToken(action = turnstileAction) {
    turnstileAction = action;
    rememberTurnstileToken("");
    if (!gatewayConfig.turnstileSiteKey) {
      setTurnstileStatus("同步服务未配置安全验证，已阻止登录和注册。", true);
      if (turnstileOpen) turnstileOpen.disabled = true;
      return;
    }
    if (turnstileOpen) turnstileOpen.disabled = false;
    setTurnstileStatus("每次打开 DeepStudy 只需要完成一次浏览器验证；完成后可继续登录、注册或恢复密码。");
  }

  async function loadGatewayConfig() {
    const requestId = ++gatewayConfigRequest;
    setTurnstileStatus("正在读取同步服务安全配置…");
    try {
      const config = await window.electronAPI.syncConfig({ gatewayUrl: byId("sync-gateway-url").value.trim() });
      if (requestId !== gatewayConfigRequest) return;
      gatewayConfig = {
        turnstileSiteKey: String(config?.turnstileSiteKey || ""),
        minimumPasswordLength: Math.max(10, Number(config?.minimumPasswordLength) || 10),
      };
      byId("sync-password").minLength = String(gatewayConfig.minimumPasswordLength);
      byId("sync-new-password").minLength = String(gatewayConfig.minimumPasswordLength);
      updatePasswordGuidance();
      resetTurnstileToken(turnstileAction);
    } catch (error) {
      if (requestId !== gatewayConfigRequest) return;
      gatewayConfig = { turnstileSiteKey: "", minimumPasswordLength: 10 };
      updatePasswordGuidance();
      rememberTurnstileToken("");
      if (turnstileOpen) turnstileOpen.disabled = true;
      setTurnstileStatus(error?.message || String(error), true);
    }
  }

  function scheduleGatewayConfigLoad() {
    clearTimeout(gatewayConfigTimer);
    gatewayConfigTimer = setTimeout(() => { void loadGatewayConfig(); }, 350);
  }

  function authInput() {
    if (!gatewayConfig.turnstileSiteKey) throw new Error("同步服务未配置安全验证，无法继续登录或注册。");
    if (!turnstileToken) throw new Error("请先完成人机验证。");
    return {
      gatewayUrl: byId("sync-gateway-url").value.trim(),
      username: byId("sync-username").value.trim(),
      password: byId("sync-password").value,
      turnstileToken,
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

  function notifySyncApplied({ closeModal = false } = {}) {
    window.dispatchEvent(new CustomEvent("deepstudy:sync-data-changed", {
      detail: { source: "account-sync" },
    }));
    if (closeModal && mayCloseRecoveryNotice()) modal.hidden = true;
  }

  async function action(button, work, successText, options = {}) {
    setBusy(button, true);
    setStatus(options.processingText || "处理中…");
    try {
      const result = await work();
      setStatus(successText);
      return result;
    } catch (error) {
      setStatus(formatSyncError(error), true);
      if (typeof options?.onError === "function") options.onError(error);
      return null;
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshStatus() {
    const local = await controller.status();
    renderConflictCount(local.blockedConflictCount);
    byId("sync-gateway-url").value ||= local.gatewayUrl || "";
    byId("sync-username").value ||= local.username || "";
    const storageNote = local.credentialStorage?.warning ? ` ${local.credentialStorage.warning}` : "";
    if (!local.signedIn) {
      authSection.hidden = false;
      importSection.hidden = true;
      manageSection.hidden = true;
      sessionBadge.textContent = "尚未登录";
      renderConflictCount(0);
      setStatus(`尚未登录。${storageNote}`);
      timerSection.hidden = true;
      return;
    }
    authSection.hidden = true;
    importSection.hidden = Boolean(local.enrollmentComplete);
    manageSection.hidden = !local.enrollmentComplete;
    sessionBadge.textContent = "已登录";
    let session;
    try {
      session = await controller.session();
      const nextStep = local.enrollmentComplete ? "" : "请先完成首次同步本机数据。";
      setStatus(`已登录${session.user?.username ? `：${session.user.username}` : ""}。${nextStep}${storageNote}`);
    } catch (error) {
      setStatus(formatSyncError(error), true);
      sessionErrorVisible = true;
      timerSection.hidden = true;
      return;
    }
    try {
      if (!local.enrollmentComplete) {
        timerSection.hidden = true;
        return;
      }
      const timerState = await reconcileTimer(local);
      const timer = timerState.timer;
      timerSection.hidden = timerState.kind !== "other-device";
      if (timerState.kind === "other-device") {
        timerSummary.textContent = `${timer.mode === "rest" ? "休息" : "专注"}模式 · ${Math.ceil(timer.remainingMs / 60000)} 分钟剩余`;
      } else if (timerState.kind === "expired" && !timerState.released) {
        setStatus("本机上次计时已结束，但云端租约暂未释放；联网后将自动重试。", true);
      }
    } catch (error) {
      setStatus(formatSyncError(error), true);
    }
  }

  function renderPreview(preview) {
    const counts = preview?.counts || {};
    const local = Math.max(0, Number(counts.local) || 0);
    const cloud = Math.max(0, Number(counts.cloud) || 0);
    const additions = Math.max(0, Number(counts.additions) || 0);
    const conflicts = Math.max(0, Number(counts.conflicts) || 0);
    const duplicates = Math.max(0, Number(counts.duplicates) || 0);
    const merged = Math.max(0, Number(counts.merged) || 0);
    const upload = additions + conflicts;
    const writeback = merged || Math.max(local, cloud);
    const deferred = Math.max(0, Number(preview?.deferredRecords) || 0);
    const deferredText = deferred > 0 ? `；图片分片 ${deferred} 条将在首次同步完成后自动分批上传` : "";
    previewResult.textContent = `本机旧数据 ${local} 条；账号已有 ${cloud} 条；将上传到账号 ${upload} 条；将写回本机 ${writeback} 条；重复 ${duplicates} 条；需要手动比较 ${conflicts} 条${deferredText}。`;
    confirmImport.textContent = previewConfirmLabel({ local, cloud, upload, writeback });
    confirmImport.disabled = false;
  }

  function previewConfirmLabel({ local, cloud, upload }) {
    if (local === 0 && cloud > 0) return "下载账号数据到本机";
    if (cloud === 0 && upload > 0) return "确认并合并到账号";
    if (local > 0 && cloud > 0) return "确认合并并同步";
    return "确认并完成首次同步";
  }

  function conflictButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function conflictValue(value) {
    if (value === undefined) return "（不存在）";
    if (value === null) return "null";
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function appendComparisonRows(container, rows, className = "") {
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = `sync-conflict-row is-different ${className}`.trim();
      const path = document.createElement("code");
      const local = document.createElement("pre");
      const remote = document.createElement("pre");
      path.textContent = row.path;
      local.textContent = conflictValue(row.local);
      remote.textContent = conflictValue(row.remote);
      line.append(path, local, remote);
      container.append(line);
    }
  }

  function appendFullRecord(container, label, record) {
    const section = document.createElement("section");
    const heading = document.createElement("strong");
    const content = document.createElement("pre");
    heading.textContent = label;
    content.textContent = JSON.stringify(record ?? null, null, 2);
    section.append(heading, content);
    container.append(section);
  }

  function resolveConflictRecord(conflict, resolution) {
    return controller.resolveConflict(
      conflict.id,
      window.DeepStudyConflictActions.resolutionInput(conflict, resolution),
    );
  }

  async function refreshConflicts({ autoResolve = true } = {}) {
    let result = await controller.conflicts();
    let conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    if (autoResolve) {
      const identical = conflicts.filter((conflict) => (
        window.DeepStudyConflictView.compareRecords(conflict.local, conflict.remote).contentEqual
      ));
      if (identical.length) {
        const settled = await window.DeepStudyConflictActions.resolveAllConflicts({
          conflicts: identical,
          resolution: "keep_remote",
          resolve: (conflict, resolution) => runProfileExclusive(() => resolveConflictRecord(conflict, resolution)),
        });
        if (settled.resolved.length) {
          await continuousSync.syncOnce();
          notifySyncApplied();
          result = await controller.conflicts();
          conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
        }
        if (settled.failed.length) {
          setStatus(`${settled.failed.length} 条内容相同的旧冲突暂未自动收敛，请稍后重试。`, true);
        }
      }
    }
    currentConflicts = conflicts;
    renderConflictCount(conflicts.length);
    conflictList.replaceChildren();
    conflictToolbar.hidden = conflicts.length === 0;
    conflictProgress.textContent = "";
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
      const comparison = window.DeepStudyConflictView.compareRecords(conflict.local, conflict.remote);
      const comparisonPanel = document.createElement("div");
      comparisonPanel.className = "sync-conflict-comparison";
      const labels = document.createElement("div");
      labels.className = "sync-conflict-row sync-conflict-labels";
      labels.append(document.createElement("span"));
      for (const label of ["本机版本", "云端版本"]) {
        const strong = document.createElement("strong");
        strong.textContent = label;
        labels.append(strong);
      }
      comparisonPanel.append(labels);
      if (comparison.contentEqual) {
        const notice = document.createElement("p");
        notice.className = "sync-conflict-equal";
        notice.textContent = "内容相同，仅同步版本信息不同；DeepStudy 会安全采用云端同步状态。";
        comparisonPanel.append(notice);
      } else {
        appendComparisonRows(comparisonPanel, comparison.rows);
      }
      const metadata = document.createElement("details");
      const metadataSummary = document.createElement("summary");
      const metadataRows = document.createElement("div");
      metadataSummary.textContent = `同步信息差异（${comparison.metadataRows.length}）`;
      appendComparisonRows(metadataRows, comparison.metadataRows, "is-metadata");
      metadata.append(metadataSummary, metadataRows);
      const full = document.createElement("details");
      const fullSummary = document.createElement("summary");
      const versions = document.createElement("div");
      fullSummary.textContent = "查看完整数据";
      versions.className = "sync-conflict-versions";
      appendFullRecord(versions, "本机版本", conflict.local);
      appendFullRecord(versions, "云端版本", conflict.remote);
      full.append(fullSummary, versions);
      const actions = document.createElement("div");
      actions.className = "sync-actions";
      actions.append(
        conflictButton("保留云端", "secondary-btn", async (event) => {
          const result = await action(event.currentTarget, () => runProfileExclusive(() => resolveConflictRecord(conflict, "keep_remote")), "冲突已解决。");
          if (result) { await continuousSync.syncOnce(); notifySyncApplied(); await refreshConflicts(); }
        }),
        conflictButton("保留本机", "primary-btn", async (event) => {
          const result = await action(event.currentTarget, () => runProfileExclusive(() => resolveConflictRecord(conflict, "keep_local")), "本机版本已保存到云端。");
          if (result) { await continuousSync.syncOnce(); notifySyncApplied(); await refreshConflicts(); }
        }),
      );
      item.append(summary, comparisonPanel, metadata, full, actions);
      conflictList.append(item);
    }
  }

  async function resolveAllConflicts(resolution) {
    if (!currentConflicts.length) return;
    if (resolution === "keep_remote" && !window.confirm(
      `全部保留云端会放弃 ${currentConflicts.length} 条记录尚未上传的本机修改，确认继续吗？`,
    )) return;
    setBusy(keepAllRemote, true);
    setBusy(keepAllLocal, true);
    const choice = resolution === "keep_local" ? "本机" : "云端";
    try {
      const settled = await window.DeepStudyConflictActions.resolveAllConflicts({
        conflicts: [...currentConflicts],
        resolution,
        resolve: (conflict, selected) => runProfileExclusive(() => resolveConflictRecord(conflict, selected)),
        onProgress: ({ completed, total }) => {
          conflictProgress.textContent = `正在处理 ${completed}/${total}…`;
        },
      });
      if (settled.resolved.length) {
        await continuousSync.syncOnce();
        notifySyncApplied();
      }
      await refreshConflicts({ autoResolve: false });
      if (settled.failed.length) {
        setStatus(`已保留 ${settled.resolved.length} 条${choice}版本；${settled.failed.length} 条处理失败并已保留在列表中。`, true);
      } else {
        setStatus(`已将 ${settled.resolved.length} 条冲突全部保留为${choice}版本。`);
      }
    } finally {
      setBusy(keepAllRemote, false);
      setBusy(keepAllLocal, false);
    }
  }

  byId("sync-account-open").addEventListener("click", async () => {
    modal.hidden = false;
    await refreshStatus();
    await loadGatewayConfig();
    if (!manageSection.hidden) await refreshConflicts();
  });
  byId("sync-close").addEventListener("click", () => { if (mayCloseRecoveryNotice()) modal.hidden = true; });
  byId("sync-gateway-url").addEventListener("input", scheduleGatewayConfigLoad);
  turnstileOpen?.addEventListener("click", async (event) => {
    rememberTurnstileToken("");
    if (!gatewayConfig.turnstileSiteKey) {
      setTurnstileStatus("同步服务未配置安全验证，无法打开浏览器验证。", true);
      return;
    }
    await action(event.currentTarget, async () => {
      setTurnstileStatus("已打开浏览器，请在浏览器中完成人机验证。");
      const token = await window.electronAPI.syncTurnstileVerify({
        gatewayUrl: byId("sync-gateway-url").value.trim(),
        action: turnstileAction,
      });
      rememberTurnstileToken(token);
      setTurnstileStatus("人机验证已完成，可以继续操作。");
      return token;
    }, "浏览器验证完成。");
  });
  recoverySaved.addEventListener("change", () => {
    if (recoverySaved.checked) setStatus("恢复码已确认保存。请妥善保管，它只显示这一次。");
  });
  byId("sync-register").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const result = await action(event.currentTarget, () => {
      const input = authInput();
      validateNewPassword(input.password, "密码");
      return runAuthTransition(() => controller.register(input));
    }, "注册成功；请立即保存恢复码。", {
      onError: (error) => { if (shouldResetTurnstileAfterAuthError(error)) resetTurnstileToken(); },
    });
    if (result?.recoveryCode) showRecoveryCode(result.recoveryCode);
    if (result) {
      byId("sync-password").value = "";
      resetTurnstileToken();
      await refreshStatus();
      const state = await controller.status();
      if (state.signedIn && state.enrollmentComplete) continuousSync.start();
      deviceRetry.hidden = !result.deviceRegistrationWarning;
      if (result.deviceRegistrationWarning) setStatus(`${result.deviceRegistrationWarning}；请点击“重试设备登记”。`, true);
    }
  });
  byId("sync-sign-in").addEventListener("click", async (event) => {
    if (!mayCloseRecoveryNotice()) return;
    const result = await action(event.currentTarget, () => runAuthTransition(() => controller.signIn(authInput())), "登录成功。", {
      onError: (error) => { if (shouldResetTurnstileAfterAuthError(error)) resetTurnstileToken(); },
    });
    if (result) {
      byId("sync-password").value = "";
      resetTurnstileToken();
      await refreshStatus();
      const state = await controller.status();
      if (state.signedIn && state.enrollmentComplete) continuousSync.start();
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
    const result = await action(event.currentTarget, () => runAuthTransition(() => {
      const input = authInput();
      const newPassword = byId("sync-new-password").value;
      validateNewPassword(newPassword, "新密码");
      return controller.recover({
        gatewayUrl: input.gatewayUrl,
        username: input.username,
        recoveryCode: byId("sync-recovery-input").value.trim(),
        newPassword,
        turnstileToken: input.turnstileToken,
      });
    }), "密码已重设；请保存新的恢复码后重新登录。", {
      onError: (error) => { if (shouldResetTurnstileAfterAuthError(error)) resetTurnstileToken(); },
    });
    if (result) {
      byId("sync-recovery-input").value = "";
      byId("sync-new-password").value = "";
      resetTurnstileToken();
    }
    if (result?.recoveryCode) showRecoveryCode(result.recoveryCode);
  });
  byId("sync-import-preview").addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.previewFirstImport()), "预览完成，本机和账号数据尚未改动。");
    if (result) renderPreview(result);
  });
  confirmImport.addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.commitFirstImport()), "首次同步、账号读回和本机校验均已完成。", {
      processingText: "正在开始首次同步：会分批提交本机旧数据、读回账号数据并写回本机，请保持窗口打开。",
    });
    if (result) {
      confirmImport.disabled = true;
      previewResult.textContent = `已应用 ${result.apply.appliedRecords} 条；本地备份编号：${result.apply.backupId}`;
      notifySyncApplied();
      await refreshStatus();
      continuousSync.start();
    }
  });
  byId("sync-pull").addEventListener("click", async (event) => {
    const result = await action(event.currentTarget, () => continuousSync.syncOnce(), "云端数据已安全同步、备份并验证写回。", {
      processingText: "正在同步：上传本地修改、拉取云端更新并写入本地。",
    });
    if (result) {
      previewResult.textContent = `同步完成：上传 ${result.mutations || 0} 条，拉取核对 ${result.records?.length || 0} 条。`;
      if (result.conflictCount || result.pendingCount) {
        setStatus(`本机仍有 ${result.pendingCount || 0} 条待上传修改、${result.conflictCount || 0} 条待处理冲突。请查看冲突并比较版本，尚未全部同步完成。`, true);
        notifySyncApplied();
      } else {
        notifySyncApplied({ closeModal: true });
      }
    }
  });
  byId("sync-conflicts").addEventListener("click", async (event) => {
    await action(event.currentTarget, refreshConflicts, "冲突列表已刷新。");
  });
  keepAllRemote.addEventListener("click", () => { void resolveAllConflicts("keep_remote"); });
  keepAllLocal.addEventListener("click", () => { void resolveAllConflicts("keep_local"); });
  byId("sync-backup-restore").addEventListener("click", async (event) => {
    const backupId = byId("sync-backup-id").value.trim();
    if (!backupId) return setStatus("请输入备份编号。", true);
    const result = await action(event.currentTarget, () => runProfileExclusive(() => controller.restoreBackup(backupId)), "备份已恢复并完成读取校验。");
    if (result) notifySyncApplied();
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
  const syncedStorageKeys = new Set(Object.values(window.DeepStudyLegacySync.LEGACY_STORAGE_KEYS));
  window.addEventListener("deepstudy:local-data-changed", (event) => {
    if (!profileTransitioning && syncedStorageKeys.has(event.detail?.key)) continuousSync.notifyLocalChange();
  });
  window.electronAPI.onLongTasksChanged?.(() => {
    if (!profileTransitioning) continuousSync.notifyLocalChange();
  });
  window.addEventListener("online", () => { if (!profileTransitioning) continuousSync.wake(); });
  let lastFocusSync = 0;
  window.addEventListener("focus", () => {
    if (!profileTransitioning && Date.now() - lastFocusSync >= 5000) {
      lastFocusSync = Date.now();
      continuousSync.wake();
    }
  });
  void controller.status().then(async (state) => {
    if (state.signedIn && state.enrollmentComplete) {
      continuousSync.start();
      await refreshStatus();
    }
  }).catch((error) => setStatus(error?.message || String(error), true));
})();
