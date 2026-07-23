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
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), "register");
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
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), "sign-in");
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
  const turnstile = await verifyTurnstile(c.env, body.turnstileToken, clientIp(c), "recover");
  if (!turnstile.ok) return c.json({ error: "TURNSTILE_REJECTED", message: turnstile.reason }, 403);

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
