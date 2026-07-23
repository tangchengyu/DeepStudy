import { hmacSha256Hex, internalEmailForUsername } from "./crypto";

interface FirebaseAuthResult {
  localId: string;
  email: string;
  idToken?: string;
}

class FirebaseAuthError extends Error {
  constructor(readonly code: string, readonly status = 401) {
    super(code);
    this.name = "FirebaseAuthError";
  }
}

function firebaseKey(env: Env): string {
  const key = String(env.FIREBASE_WEB_API_KEY ?? "").trim();
  if (!key && env.ENVIRONMENT === "production") throw new FirebaseAuthError("FIREBASE_NOT_CONFIGURED", 503);
  return key || "local-test-firebase-key";
}

function shouldUseLocalFirebase(env: Env) {
  return env.ENVIRONMENT !== "production" && firebaseKey(env) === "local-test-firebase-key";
}

async function localPasswordDigest(env: Env, username: string, password: string) {
  return hmacSha256Hex(env.RECOVERY_CODE_PEPPER, `local-firebase-password:${username}:${password}`);
}

async function localFirebaseId(env: Env, username: string) {
  return `firebase_${(await hmacSha256Hex(env.RECOVERY_CODE_PEPPER, `local-firebase-id:${username}`)).slice(0, 32)}`;
}

async function localRegister(env: Env, username: string, password: string): Promise<FirebaseAuthResult> {
  const email = await internalEmailForUsername(username, env.RECOVERY_CODE_PEPPER);
  const existing = await env.DB.prepare("SELECT userId FROM account WHERE providerId = 'firebase-local' AND accountId = ?")
    .bind(username).first<{ userId: string }>();
  if (existing) throw new FirebaseAuthError("USERNAME_EXISTS", 409);
  const localId = await localFirebaseId(env, username);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, username, displayUsername)
    VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?)
  `).bind(localId, username, email, now, now, username, username).run();
  await env.DB.prepare(`
    INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
    VALUES (?, ?, 'firebase-local', ?, ?, ?, ?)
  `).bind(
    `account_${crypto.randomUUID()}`,
    username,
    localId,
    await localPasswordDigest(env, username, password),
    now,
    now
  ).run();
  return { localId, email, idToken: `local-id-token-${localId}` };
}

async function localSignIn(env: Env, username: string, password: string): Promise<FirebaseAuthResult> {
  const row = await env.DB.prepare(`
    SELECT userId, password FROM account WHERE providerId = 'firebase-local' AND accountId = ?
  `).bind(username).first<{ userId: string; password: string }>();
  if (!row || row.password !== await localPasswordDigest(env, username, password)) {
    throw new FirebaseAuthError("INVALID_CREDENTIALS", 401);
  }
  return {
    localId: row.userId,
    email: await internalEmailForUsername(username, env.RECOVERY_CODE_PEPPER),
    idToken: `local-id-token-${row.userId}`
  };
}

async function localUpdatePassword(env: Env, username: string, newPassword: string): Promise<void> {
  const update = await env.DB.prepare(`
    UPDATE account SET password = ?, updatedAt = ? WHERE providerId = 'firebase-local' AND accountId = ?
  `).bind(await localPasswordDigest(env, username, newPassword), Date.now(), username).run();
  if ((update.meta.changes ?? 0) !== 1) throw new FirebaseAuthError("USER_NOT_FOUND", 404);
}

async function firebasePost<T>(
  env: Env,
  endpoint: string,
  body: Record<string, unknown>,
  authorization?: string,
  options: { appendApiKey?: boolean } = {}
): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  const url = options.appendApiKey === false
    ? endpoint
    : `${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(firebaseKey(env))}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const payload: Record<string, unknown> = await response.json<Record<string, unknown>>().catch(() => ({}));
  if (!response.ok) {
    const message = String((payload.error as { message?: unknown } | undefined)?.message ?? "FIREBASE_AUTH_ERROR");
    throw new FirebaseAuthError(message, response.status);
  }
  return payload as T;
}

export async function firebaseRegister(env: Env, username: string, password: string): Promise<FirebaseAuthResult> {
  if (shouldUseLocalFirebase(env)) return localRegister(env, username, password);
  const email = await internalEmailForUsername(username, env.RECOVERY_CODE_PEPPER);
  return firebasePost<FirebaseAuthResult>(env, "https://identitytoolkit.googleapis.com/v1/accounts:signUp", {
    email,
    password,
    returnSecureToken: true
  });
}

export async function firebaseSignIn(env: Env, username: string, password: string): Promise<FirebaseAuthResult> {
  if (shouldUseLocalFirebase(env)) return localSignIn(env, username, password);
  const email = await internalEmailForUsername(username, env.RECOVERY_CODE_PEPPER);
  return firebasePost<FirebaseAuthResult>(env, "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword", {
    email,
    password,
    returnSecureToken: true
  });
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function base64UrlJson(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function serviceAccountAccessToken(env: Env): Promise<string> {
  const email = String(env.FIREBASE_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const key = String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!email || !key) throw new FirebaseAuthError("FIREBASE_ADMIN_NOT_CONFIGURED", 503);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3_600
  };
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson(claim)}`;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  ));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const assertion = `${unsigned}.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload: { access_token?: string; error?: string } = await response
    .json<{ access_token?: string; error?: string }>()
    .catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new FirebaseAuthError(payload.error || "FIREBASE_ADMIN_TOKEN_FAILED", response.status);
  }
  return payload.access_token;
}

export async function firebaseUpdatePassword(
  env: Env,
  username: string,
  localId: string,
  newPassword: string
): Promise<void> {
  if (shouldUseLocalFirebase(env)) {
    await localUpdatePassword(env, username, newPassword);
    return;
  }
  const projectId = String(env.FIREBASE_PROJECT_ID ?? "").trim();
  if (!projectId) throw new FirebaseAuthError("FIREBASE_PROJECT_NOT_CONFIGURED", 503);
  const token = await serviceAccountAccessToken(env);
  await firebasePost(env, `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:update`, {
    localId,
    password: newPassword
  }, `Bearer ${token}`, { appendApiKey: false });
}

export { FirebaseAuthError };
