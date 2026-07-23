const DAY_MS = 24 * 60 * 60 * 1_000;
const DELETE_BATCH_SIZE = 1_000;

export async function cleanupGatewayData(db: D1Database, now = Date.now()): Promise<void> {
  const thirtyDaysAgo = now - (30 * DAY_MS);
  const ninetyDaysAgo = now - (90 * DAY_MS);
  await db.batch([
    db.prepare(`
      DELETE FROM account_action_limits WHERE rowid IN (
        SELECT rowid FROM account_action_limits WHERE expires_at < ? LIMIT ?
      )
    `).bind(now, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM rateLimit WHERE rowid IN (
        SELECT rowid FROM rateLimit WHERE lastRequest < ? LIMIT ?
      )
    `).bind(ninetyDaysAgo, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM session WHERE rowid IN (
        SELECT rowid FROM session WHERE expiresAt < ? LIMIT ?
      )
    `).bind(now, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM verification WHERE rowid IN (
        SELECT rowid FROM verification WHERE expiresAt < ? LIMIT ?
      )
    `).bind(now, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM sync_conflicts WHERE rowid IN (
        SELECT rowid FROM sync_conflicts
        WHERE status LIKE 'resolved_%' AND resolved_at < ? LIMIT ?
      )
    `).bind(ninetyDaysAgo, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM sync_imports WHERE rowid IN (
        SELECT rowid FROM sync_imports
        WHERE status IN ('committed', 'superseded')
          AND COALESCE(committed_at, created_at) < ?
        LIMIT ?
      )
    `).bind(ninetyDaysAgo, DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM sync_changes WHERE sequence IN (
        SELECT older.sequence
        FROM sync_changes AS older
        WHERE older.changed_at < ?
          AND EXISTS (
            SELECT 1 FROM sync_changes AS newer
            WHERE newer.user_id = older.user_id
              AND newer.entity_type = older.entity_type
              AND newer.entity_id = older.entity_id
              AND newer.sequence > older.sequence
          )
        LIMIT ?
      )
    `).bind(thirtyDaysAgo, DELETE_BATCH_SIZE)
  ]);
}
