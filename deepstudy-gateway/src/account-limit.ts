export async function consumeAccountActionLimit(
  db: D1Database,
  action: string,
  key: string,
  maximum: number,
  windowMs: number,
  now = Date.now()
): Promise<boolean> {
  const limitKey = `${action}:${key}`;
  const result = await db.prepare(`
    INSERT INTO account_action_limits (limit_key, request_count, window_started_at, expires_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(limit_key) DO UPDATE SET
      request_count = CASE
        WHEN account_action_limits.expires_at <= ? THEN 1
        ELSE account_action_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN account_action_limits.expires_at <= ? THEN excluded.window_started_at
        ELSE account_action_limits.window_started_at
      END,
      expires_at = CASE
        WHEN account_action_limits.expires_at <= ? THEN excluded.expires_at
        ELSE account_action_limits.expires_at
      END
    RETURNING request_count
  `).bind(limitKey, now, now + windowMs, now, now, now).first<{ request_count: number }>();

  return Boolean(result && result.request_count <= maximum);
}
