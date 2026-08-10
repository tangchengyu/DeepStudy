const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.resolve(__dirname, "..", "renderer");
const html = fs.readFileSync(path.join(renderer, "index.html"), "utf8");
const script = fs.readFileSync(path.join(renderer, "sync-enrollment-ui.js"), "utf8");
const css = fs.readFileSync(path.join(renderer, "styles.css"), "utf8");
const appScript = fs.readFileSync(path.join(renderer, "app.js"), "utf8");
const timerScript = fs.readFileSync(path.join(renderer, "timer-sync-runtime.js"), "utf8");
const tutorialScript = fs.readFileSync(path.join(renderer, "tutorial.js"), "utf8");
const allRendererScripts = fs.readdirSync(renderer)
  .filter((name) => name.endsWith(".js"))
  .map((name) => fs.readFileSync(path.join(renderer, name), "utf8"))
  .join("\n");

test("desktop account panel includes enrollment, recovery, preview, conflicts, and explicit takeover", () => {
  for (const id of [
    "sync-account-open", "sync-modal", "sync-register", "sync-sign-in",
    "sync-device-retry",
    "sync-recovery-saved",
    "sync-recover", "sync-import-preview", "sync-import-confirm",
    "sync-pull", "sync-conflicts", "sync-takeover",
    "sync-wizard-auth", "sync-wizard-import", "sync-wizard-manage",
    "sync-turnstile-host", "sync-turnstile-status",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, />接管并继续</);
  assert.match(html, /id="sync-password"[^>]*autocomplete="current-password"/);
  assert.match(html, /id="sync-new-password"[^>]*autocomplete="new-password"/);
  assert.doesNotMatch(html, /sync-turnstile-token/);
  assert.doesNotMatch(html, /人机验证令牌/);
  assert.ok(html.indexOf('src="legacy-sync.js"') < html.indexOf('src="sync-enrollment.js"'));
  assert.ok(html.indexOf('src="desktop-turnstile.js"') < html.indexOf('src="sync-enrollment-ui.js"'));
  assert.ok(html.indexOf('src="sync-enrollment.js"') < html.indexOf('src="sync-enrollment-ui.js"'));
});

test("sync UI renders server text safely and never clears all legacy LocalStorage", () => {
  assert.match(script, /recoveryCode\.textContent\s*=/);
  assert.match(script, /status\.textContent\s*=/);
  assert.doesNotMatch(script, /innerHTML\s*=/);
  assert.doesNotMatch(allRendererScripts, /localStorage\.clear\s*\(/);
});

test("desktop account panel uses Turnstile config before auth and does not close from backdrop clicks", () => {
  assert.match(script, /syncConfig/);
  assert.match(script, /syncTurnstileVerify/);
  assert.match(script, /turnstileToken/);
  assert.match(script, /同步服务未配置安全验证/);
  assert.match(script, /resetTurnstileToken/);
  assert.doesNotMatch(script, /sync-turnstile-token/);
  assert.doesNotMatch(html, /src="desktop-turnstile\.js"/);
  assert.doesNotMatch(script, /turnstile\.render/);
  assert.doesNotMatch(script, /event\.target === modal[\s\S]*modal\.hidden = true/);
});

test("desktop account panel explains password rules and reuses one browser verification per launch", () => {
  assert.match(html, /id="sync-password-rule"/);
  assert.match(html, /10-128 个字符/);
  assert.match(html, /每次打开 DeepStudy 只需要完成一次/);
  assert.match(script, /ACCOUNT_TURNSTILE_ACTION\s*=\s*"account-sync"/);
  assert.match(script, /formatSyncError/);
  assert.match(script, /INVALID_PASSWORD/);
  assert.match(script, /shouldResetTurnstileAfterAuthError/);
  assert.doesNotMatch(script, /for \(const \[id, actionName\] of \[\["sync-sign-in", "sign-in"\]/);
});

test("desktop first sync explains upload, download, writeback, and hides advanced sync until enrollment completes", () => {
  assert.match(html, /首次同步本机数据/);
  assert.match(script, /本机旧数据/);
  assert.match(script, /将上传到账号/);
  assert.match(script, /将写回本机/);
  assert.match(script, /manageSection\.hidden = !local\.enrollmentComplete/);
  assert.match(script, /请先完成首次同步本机数据/);
  assert.match(script, /confirmImport\.textContent = previewConfirmLabel/);
});

test("desktop Turnstile challenge has enough modal width and cannot be clipped by the host layout", () => {
  assert.match(html, /id="sync-turnstile-open"/);
  assert.match(html, />打开浏览器验证</);
  assert.match(css, /\.modal-card\.sync-card\s*\{[\s\S]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\)/);
  assert.match(css, /\.sync-turnstile-panel\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.sync-turnstile-host\s*\{[\s\S]*justify-content:\s*center/s);
  assert.doesNotMatch(css, /\.sync-turnstile-host\s*\{[^}]*overflow:\s*hidden/s);
});

test("tutorial explains account sync safety, first import, conflicts, and backup recovery", () => {
  assert.match(tutorialScript, /账号同步/);
  assert.match(tutorialScript, /人机验证/);
  assert.match(tutorialScript, /首次同步/);
  assert.match(tutorialScript, /灵魂按摩间/);
  assert.match(tutorialScript, /冲突/);
  assert.match(tutorialScript, /备份/);
});

test("successful timer takeover hydrates and continues the matching local timer engine", () => {
  assert.match(script, /deepstudy:timer-takeover/);
  assert.match(script, /reconcileSameDeviceTimer/);
  assert.match(appScript, /function adoptRemoteTimer\(remote\)/);
  assert.match(appScript, /FocusMode\.adoptRemoteTimer\(timer\)/);
  assert.match(appScript, /RestMode\.adoptRemoteTimer\(timer\)/);
});

test("recovery-code success requires explicit saved acknowledgement before the dialog closes", () => {
  assert.match(html, /id="sync-recovery-saved"/);
  assert.match(script, /请先确认已离线保存恢复码/);
  assert.match(script, /recoverySaved\.checked/);
  assert.ok((script.match(/if \(!mayCloseRecoveryNotice\(\)\) return;/g) || []).length >= 4);
});

test("renderer loads the durable continuous synchronization runtime", () => {
  assert.match(html, /src="continuous-sync\.js"/);
  assert.match(script, /createContinuousSync/);
});

test("focus and rest timers publish claim, throttled updates, and release without implicit takeover", () => {
  assert.ok(html.indexOf('src="timer-sync-runtime.js"') < html.indexOf('src="app.js"'));
  assert.match(appScript, /deepstudy:timer-publish/);
  assert.match(appScript, /await claimActiveTimer/);
  assert.match(appScript, /publishTimer\("release"\)/);
  assert.match(appScript, /createSingleFlightGate/);
  assert.match(script, /createTimerLeaseManager/);
  assert.match(timerScript, /takeover: false/);
  assert.match(timerScript, /syncReleaseTimer/);
  assert.match(timerScript, /action === "heartbeat"/);
});

test("losing a timer lease pauses the old device before showing explicit takeover", () => {
  const blockedStart = script.indexOf("onBlocked: () =>");
  const blockedEnd = script.indexOf("onError:", blockedStart);
  const blocked = script.slice(blockedStart, blockedEnd);
  assert.match(blocked, /deepstudy:before-sync-apply/);
  assert.match(blocked, /另一台设备正在计时/);
  assert.match(appScript, /deepstudy:before-sync-apply[\s\S]*FocusMode\.pauseForSync\(\)[\s\S]*RestMode\.pauseForSync\(\)/);
});

test("account transition pauses the engine and releases the old timer lease before changing auth", () => {
  const transitionStart = script.indexOf("async function runAuthTransition");
  const transitionEnd = script.indexOf("function setStatus", transitionStart);
  const transition = script.slice(transitionStart, transitionEnd);
  assert.ok(transition.indexOf('deepstudy:before-sync-apply') >= 0);
  assert.ok(transition.indexOf("await timerLease.release()") > transition.indexOf('deepstudy:before-sync-apply'));
  assert.ok(transition.indexOf("runProfileExclusive(work)") > transition.indexOf("await timerLease.release()"));
  assert.match(transition, /计时器租约尚未安全释放/);
});

test("conflicts safely render both complete payloads and use stable receipt operation IDs", () => {
  assert.match(script, /content\.textContent = JSON\.stringify/);
  assert.match(script, /本机版本/);
  assert.match(script, /云端版本/);
  assert.match(script, /operationId: `desktop:resolve:\$\{conflict\.id\}:keep_remote`/);
  assert.match(script, /const mutationId = `desktop:resolve:\$\{conflict\.id\}:keep_local`/);
});
