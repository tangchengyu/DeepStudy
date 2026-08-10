import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { allowedOrigins } from "./auth";
import { consumeAccountActionLimit } from "./account-limit";
import {
  constantTimeEqualHex,
  deriveRecoveryCode,
  internalEmailForUsername,
  normalizeRecoveryCode,
  normalizeUsername,
  recoveryCodeDigest,
  validateUsername
} from "./crypto";
import {
  clientIp,
  readJsonObject,
  RequestBodyTooLargeError
} from "./http";
import {
  FirebaseAuthError,
  firebaseRegister,
  firebaseSignIn,
  firebaseUpdatePassword
} from "./firebase-auth";
import { verifyTurnstile } from "./turnstile";
import {
  createSession,
  getSessionFromRequest,
  requireSession,
  revokeRequestSession,
  revokeUserSessions
} from "./session";
import { syncRoutes } from "./sync";
import { timerRoutes } from "./timer";
import { importRoutes } from "./imports";
import { cleanupGatewayData } from "./cleanup";

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

app.use("*", async (c, next) => {
  const origins = allowedOrigins(c.env);
  return cors({
    origin: (origin) => origins.includes(origin) ? origin : origins[0] || "",
    allowHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length", "set-auth-token"],
    credentials: true,
    maxAge: 600
  })(c, next);
});

app.get("/health", (c) => c.json({
  ok: true,
  service: "deepstudy-gateway",
  environment: c.env.ENVIRONMENT
}));

app.get("/v1/config", (c) => c.json({
  turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
  minimumPasswordLength: 10
}));

const DESKTOP_TURNSTILE_ACTIONS = new Set(["account-sync", "sign-in", "register", "recover", "regenerate-recovery"]);
const REGISTER_TURNSTILE_ACTIONS = ["register", "account-sync"];
const SIGN_IN_TURNSTILE_ACTIONS = ["sign-in", "account-sync"];
const RECOVER_TURNSTILE_ACTIONS = ["recover", "account-sync"];
const LOOPBACK_CALLBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLoopbackCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_CALLBACK_HOSTS.has(url.hostname) && Boolean(url.port);
  } catch {
    return false;
  }
}

function desktopTurnstilePage(input: { siteKey: string; action: string; callback: string; state: string }) {
  const config = JSON.stringify(input).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>DeepStudy 安全验证</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
    <style>
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #30433b; background: #f3f7f2; }
      main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #d6e4d8; border-radius: 18px; background: #fffdf9; box-shadow: 0 18px 52px rgba(50, 68, 59, 0.14); text-align: center; }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0 0 18px; color: #6d8578; line-height: 1.7; }
      #turnstile-widget { min-height: 78px; display: flex; justify-content: center; align-items: center; }
      #status { margin-top: 14px; font-weight: 700; }
      button { margin-top: 14px; min-height: 42px; padding: 0 18px; border: 1px solid #d6e4d8; border-radius: 10px; background: #fffdf9; color: #568f7c; font: inherit; font-weight: 800; cursor: pointer; }
      .error { color: #c57779; }
    </style>
  </head>
  <body>
    <main>
      <h1>DeepStudy 安全验证</h1>
      <p>请在浏览器中完成人机验证。完成后会自动回到 DeepStudy。</p>
      <div
        id="turnstile-widget"
        class="cf-turnstile"
        data-sitekey="${escapeHtml(input.siteKey)}"
        data-action="${escapeHtml(input.action)}"
        data-theme="light"
        data-callback="onTurnstileSuccess"
        data-expired-callback="onTurnstileExpired"
        data-error-callback="onTurnstileError"
      ></div>
      <p id="status">正在加载验证组件…</p>
      <button id="reload" type="button" hidden>重新加载验证</button>
    </main>
    <script>
      const config = ${config};
      const status = document.getElementById("status");
      const reload = document.getElementById("reload");
      const startedAt = Date.now();
      reload.addEventListener("click", () => location.reload());
      function finish(key, value) {
        const callback = new URL(config.callback);
        callback.searchParams.set("state", config.state);
        callback.searchParams.set(key, value);
        location.replace(callback.toString());
      }
      function showLoadFailure() {
        status.textContent = "验证组件加载超时。请检查网络是否能访问 challenges.cloudflare.com，或点击重新加载验证。";
        status.className = "error";
        reload.hidden = false;
      }
      window.onTurnstileSuccess = (token) => {
        status.textContent = "验证完成，正在返回 DeepStudy…";
        finish("token", token || "");
      };
      window.onTurnstileExpired = () => {
        status.textContent = "验证已过期，请重新加载验证。";
        status.className = "error";
        reload.hidden = false;
      };
      window.onTurnstileError = () => {
        status.textContent = "验证失败，请回到 DeepStudy 重新打开浏览器验证。";
        status.className = "error";
        finish("error", "人机验证失败，请重试。");
      };
      function renderTurnstile() {
        if (!window.turnstile || typeof window.turnstile.render !== "function") {
          if (Date.now() - startedAt > 15000) {
            showLoadFailure();
            return;
          }
          setTimeout(renderTurnstile, 120);
          return;
        }
        try {
          window.turnstile.render("#turnstile-widget", {
            sitekey: config.siteKey,
            action: config.action,
            theme: "light",
            callback: window.onTurnstileSuccess,
            "expired-callback": window.onTurnstileExpired,
            "error-callback": window.onTurnstileError
          });
          status.textContent = "请完成验证。";
        } catch (error) {
          status.textContent = error && error.message ? error.message : "验证组件初始化失败，请重新加载验证。";
          status.className = "error";
          reload.hidden = false;
        }
      }
      function waitForWidgetResult() {
        if (document.querySelector("#turnstile-widget iframe") || document.querySelector("input[name='cf-turnstile-response']")) {
          if (status.textContent === "正在加载验证组件…") status.textContent = "请完成验证。";
        }
        if (Date.now() - startedAt > 15000) {
          if (status.textContent === "正在加载验证组件…") showLoadFailure();
          return;
        }
        setTimeout(waitForWidgetResult, 120);
      }
      renderTurnstile();
      waitForWidgetResult();
    </script>
  </body>
</html>`;
}

app.get("/v1/turnstile/desktop", (c) => {
  const action = String(c.req.query("action") || "");
  const callback = String(c.req.query("callback") || "");
  const state = String(c.req.query("state") || "");
  if (!DESKTOP_TURNSTILE_ACTIONS.has(action)) return c.text("Invalid Turnstile action.", 400);
  if (!state || state.length > 128) return c.text("Invalid Turnstile state.", 400);
  if (!isLoopbackCallback(callback)) return c.text("Invalid Turnstile callback.", 400);
  if (!c.env.TURNSTILE_SITE_KEY) return c.text("Turnstile site key is not configured.", 503);
  return c.html(desktopTurnstilePage({
    siteKey: c.env.TURNSTILE_SITE_KEY,
    action: escapeHtml(action),
    callback,
    state: escapeHtml(state)
  }), 200, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"
  });
});

function publicUser(user: { id: string; username?: string | null; name?: string | null }) {
  return { id: user.id, username: user.username ?? null, name: user.name ?? user.username ?? null };
}

async function upsertFirebaseUser(
  env: Env,
  input: { id: string; username: string; email: string }
) {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, username, displayUsername)
    VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      updatedAt = excluded.updatedAt,
      username = excluded.username,
      displayUsername = excluded.displayUsername
  `).bind(input.id, input.username, input.email, now, now, input.username, input.username).run();
  return { id: input.id, username: input.username, name: input.username };
}

async function respondWithSession(
  c: AppContext,
  user: { id: string; username: string; name?: string | null },
  payload: Record<string, unknown> = {}
) {
  const session = await createSession(c.env, user.id, c.req.raw);
  const response = c.json({ ...payload, user: publicUser(user) });
  response.headers.set("set-auth-token", session.token);
  return response;
}

function firebaseErrorResponse(c: AppContext, error: unknown) {
  if (!(error instanceof FirebaseAuthError)) throw error;
  const code = ({
    EMAIL_EXISTS: "USERNAME_EXISTS",
    USERNAME_EXISTS: "USERNAME_EXISTS",
    INVALID_LOGIN_CREDENTIALS: "INVALID_CREDENTIALS",
    INVALID_PASSWORD: "INVALID_CREDENTIALS",
    EMAIL_NOT_FOUND: "INVALID_CREDENTIALS",
    USER_DISABLED: "INVALID_CREDENTIALS"
  } as Record<string, string>)[error.code] || error.code;
  return c.json({ error: code }, error.status as 400 | 401 | 403 | 409 | 500 | 503);
}

app.post("/v1/auth/register", async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "INVALID_JSON" }, 400);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  if (!validateUsername(username)) return c.json({ error: "INVALID_USERNAME" }, 400);
  if (password.length < 10 || password.length > 128) return c.json({ error: "INVALID_PASSWORD" }, 400);

  const ip = clientIp(c) ?? "unknown";
  if (!await consumeAccountActionLimit(c.env.DB, "register", ip, 5, 60_000)) {
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), REGISTER_TURNSTILE_ACTIONS);
  if (!turnstile.ok) return c.json({ error: "TURNSTILE_REJECTED", message: turnstile.reason }, 403);

  let firebaseUser;
  try {
    firebaseUser = await firebaseRegister(c.env, username, password);
  } catch (error) {
    return firebaseErrorResponse(c, error);
  }
  const user = await upsertFirebaseUser(c.env, {
    id: firebaseUser.localId,
    username,
    email: firebaseUser.email || await internalEmailForUsername(username, c.env.RECOVERY_CODE_PEPPER)
  });
  const recoveryCode = await deriveRecoveryCode(user.id, 1, c.env.RECOVERY_CODE_PEPPER);
  const codeHash = await recoveryCodeDigest(recoveryCode, c.env.RECOVERY_CODE_PEPPER);
  const now = Date.now();
  try {
    await c.env.DB.prepare(`
      INSERT INTO recovery_credentials (user_id, code_hash, generation, created_at, used_at)
      VALUES (?, ?, 1, ?, NULL)
    `).bind(user.id, codeHash, now).run();
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM user WHERE id = ?").bind(user.id).run().catch(() => undefined);
    console.error("registration recovery credential creation failed", error);
    return c.json({ error: "REGISTRATION_ROLLED_BACK" }, 503);
  }
  return respondWithSession(c, user, { recoveryCode });
});

app.post("/v1/auth/sign-in", async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "INVALID_JSON" }, 400);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  if (!validateUsername(username) || !password) return c.json({ error: "INVALID_CREDENTIALS" }, 400);
  const ip = clientIp(c) ?? "unknown";
  if (!await consumeAccountActionLimit(c.env.DB, "sign-in", ip, 10, 60_000)) {
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  let firebaseUser;
  try {
    firebaseUser = await firebaseSignIn(c.env, username, password);
  } catch (error) {
    return firebaseErrorResponse(c, error);
  }
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), SIGN_IN_TURNSTILE_ACTIONS);
  if (!turnstile.ok) return c.json({ error: "TURNSTILE_REJECTED", message: turnstile.reason }, 403);
  const user = await upsertFirebaseUser(c.env, {
    id: firebaseUser.localId,
    username,
    email: firebaseUser.email || await internalEmailForUsername(username, c.env.RECOVERY_CODE_PEPPER)
  });
  return respondWithSession(c, user);
});

app.post("/v1/auth/recover", async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "INVALID_JSON" }, 400);
  const username = normalizeUsername(body.username);
  const recoveryCode = normalizeRecoveryCode(body.recoveryCode);
  const newPassword = String(body.newPassword ?? "");
  if (!validateUsername(username) || recoveryCode.length !== 16 || newPassword.length < 10 || newPassword.length > 128) {
    return c.json({ error: "INVALID_RECOVERY_REQUEST" }, 400);
  }
  const ip = clientIp(c) ?? "unknown";
  if (!await consumeAccountActionLimit(c.env.DB, "recover", ip, 5, 300_000)) {
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  const credential = await c.env.DB.prepare(`
    SELECT r.user_id, r.code_hash, r.generation, u.email
    FROM recovery_credentials r
    JOIN user u ON u.id = r.user_id
    WHERE u.username = ? AND r.used_at IS NULL
  `).bind(username).first<{ user_id: string; code_hash: string; generation: number; email: string }>();
  const suppliedHash = await recoveryCodeDigest(recoveryCode, c.env.RECOVERY_CODE_PEPPER);
  if (!credential || !constantTimeEqualHex(credential.code_hash, suppliedHash)) {
    return c.json({ error: "INVALID_RECOVERY_CODE" }, 401);
  }
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), RECOVER_TURNSTILE_ACTIONS);
  if (!turnstile.ok) return c.json({ error: "TURNSTILE_REJECTED", message: turnstile.reason }, 403);

  const nextGeneration = credential.generation + 1;
  const nextCode = await deriveRecoveryCode(
    credential.user_id,
    nextGeneration,
    c.env.RECOVERY_CODE_PEPPER
  );
  const nextHash = await recoveryCodeDigest(nextCode, c.env.RECOVERY_CODE_PEPPER);
  const now = Date.now();
  try {
    await firebaseUpdatePassword(c.env, username, credential.user_id, newPassword);
  } catch (error) {
    return firebaseErrorResponse(c, error);
  }
  const update = await c.env.DB.prepare(`
      UPDATE recovery_credentials
      SET code_hash = ?, generation = ?, created_at = ?, used_at = NULL
      WHERE user_id = ? AND generation = ? AND code_hash = ? AND used_at IS NULL
    `).bind(nextHash, nextGeneration, now, credential.user_id, credential.generation, suppliedHash).run();
  if ((update.meta.changes ?? 0) !== 1) {
    return c.json({ error: "INVALID_RECOVERY_CODE" }, 401);
  }
  await revokeUserSessions(c.env, credential.user_id);
  return c.json({ ok: true, recoveryCode: nextCode });
});

app.post("/v1/auth/recovery/regenerate", async (c) => {
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "INVALID_JSON" }, 400);
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  if (!validateUsername(username) || password.length < 10 || password.length > 128) {
    return c.json({ error: "INVALID_CREDENTIALS" }, 400);
  }
  const ip = clientIp(c) ?? "unknown";
  if (!await consumeAccountActionLimit(c.env.DB, "recovery-regenerate", ip, 5, 300_000)) {
    return c.json({ error: "RATE_LIMITED" }, 429);
  }
  const turnstile = await verifyTurnstile(
    c.env,
    body.turnstileToken,
    clientIp(c),
    "regenerate-recovery"
  );
  if (!turnstile.ok) return c.json({ error: "TURNSTILE_REJECTED", message: turnstile.reason }, 403);

  let firebaseUser;
  try {
    firebaseUser = await firebaseSignIn(c.env, username, password);
  } catch (error) {
    return firebaseErrorResponse(c, error);
  }
  const user = await upsertFirebaseUser(c.env, {
    id: firebaseUser.localId,
    username,
    email: firebaseUser.email || await internalEmailForUsername(username, c.env.RECOVERY_CODE_PEPPER)
  });

  const current = await c.env.DB.prepare(`
    SELECT generation FROM recovery_credentials WHERE user_id = ?
  `).bind(user.id).first<{ generation: number }>();
  const generation = (current?.generation ?? 0) + 1;
  const recoveryCode = await deriveRecoveryCode(user.id, generation, c.env.RECOVERY_CODE_PEPPER);
  const codeHash = await recoveryCodeDigest(recoveryCode, c.env.RECOVERY_CODE_PEPPER);
  const now = Date.now();
  const update = current
    ? await c.env.DB.prepare(`
      UPDATE recovery_credentials
      SET code_hash = ?, generation = ?, created_at = ?, used_at = NULL
      WHERE user_id = ? AND generation = ?
    `).bind(codeHash, generation, now, user.id, current.generation).run()
    : await c.env.DB.prepare(`
      INSERT INTO recovery_credentials (user_id, code_hash, generation, created_at, used_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(user_id) DO NOTHING
    `).bind(user.id, codeHash, generation, now).run();
  if ((update.meta.changes ?? 0) !== 1) {
    return c.json({ error: "RECOVERY_REGENERATION_CONFLICT" }, 409);
  }
  return respondWithSession(c, user, { recoveryCode });
});

app.get("/v1/auth/session", async (c) => {
  const session = await getSessionFromRequest(c.env, c.req.raw);
  return session ? c.json({ user: publicUser(session.user) }) : c.json({ error: "UNAUTHORIZED" }, 401);
});

app.use("/v1/devices", requireSession);
app.use("/v1/sync/*", requireSession);
app.use("/v1/timer", requireSession);
app.use("/v1/timer/*", requireSession);
app.use("/v1/imports/*", requireSession);
app.route("/v1", syncRoutes);
app.route("/v1", timerRoutes);
app.route("/v1", importRoutes);

app.post("/api/auth/sign-out", async (c) => {
  await c.req.raw.body?.cancel().catch(() => undefined);
  await revokeRequestSession(c.env, c.req.raw);
  return c.json({ success: true });
});

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  await c.req.raw.body?.cancel().catch(() => undefined);
  return c.json({ error: "NOT_FOUND" }, 404);
});

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
app.onError((error, c) => {
  if (error instanceof RequestBodyTooLargeError) {
    return c.json({ error: "REQUEST_TOO_LARGE", limitBytes: error.limitBytes }, 413);
  }
  console.error("gateway request failed", error);
  return c.json({ error: "INTERNAL_ERROR" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupGatewayData(env.DB));
  }
} satisfies ExportedHandler<Env>;
