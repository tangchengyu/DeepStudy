import type { Context, Next } from "hono";
import { hmacSha256Hex } from "./crypto";

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
export interface AuthUser {
  id: string;
  username: string | null;
  name: string | null;
}

export interface AuthSession {
  user: AuthUser;
  session: { id: string; expiresAt: number };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function bearerToken(headers: Headers): string | null {
  const value = headers.get("authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function sessionTokenDigest(env: Env, token: string): Promise<string> {
  return hmacSha256Hex(env.GATEWAY_SECRET, `session-token:${token}`);
}

export async function createSession(
  env: Env,
  userId: string,
  request: Request
): Promise<{ token: string; session: AuthSession }> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenDigest = await sessionTokenDigest(env, token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const sessionId = newId("session");
  await env.DB.prepare(`
    INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    expiresAt,
    tokenDigest,
    now,
    now,
    request.headers.get("cf-connecting-ip"),
    request.headers.get("user-agent"),
    userId
  ).run();
  const session = await getSessionForToken(env, token);
  if (!session) throw new Error("Created session cannot be read back.");
  return { token, session };
}

export async function getSessionForToken(env: Env, token: string | null): Promise<AuthSession | null> {
  if (!token) return null;
  const digest = await sessionTokenDigest(env, token);
  const now = Date.now();
  const row = await env.DB.prepare(`
    SELECT s.id AS session_id, s.expiresAt AS expires_at,
           u.id AS user_id, u.username AS username, u.name AS name
    FROM session s
    JOIN user u ON u.id = s.userId
    WHERE s.token = ? AND s.expiresAt > ?
  `).bind(digest, now).first<{
    session_id: string;
    expires_at: number;
    user_id: string;
    username: string | null;
    name: string | null;
  }>();
  if (!row) return null;
  return {
    user: { id: row.user_id, username: row.username, name: row.name },
    session: { id: row.session_id, expiresAt: row.expires_at }
  };
}

export async function getSessionFromRequest(env: Env, request: Request): Promise<AuthSession | null> {
  return getSessionForToken(env, bearerToken(request.headers));
}

export async function revokeRequestSession(env: Env, request: Request): Promise<void> {
  const token = bearerToken(request.headers);
  if (!token) return;
  await env.DB.prepare("DELETE FROM session WHERE token = ?")
    .bind(await sessionTokenDigest(env, token)).run();
}

export async function revokeUserSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run();
}

export async function requireSession(c: Context<{ Bindings: Env }>, next: Next) {
  const session = await getSessionFromRequest(c.env, c.req.raw);
  if (!session) return c.json({ error: "UNAUTHORIZED" }, 401);
  c.set("session" as never, session as never);
  await next();
}

export function sessionUser(c: Context): { id: string } {
  const session = c.get("session" as never) as AuthSession | undefined;
  if (!session?.user?.id) throw new Error("Authenticated session is missing from context.");
  return session.user;
}

export function requiredDeviceId(c: Context): string | null {
  const value = String(c.req.header("x-device-id") ?? "").trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}
