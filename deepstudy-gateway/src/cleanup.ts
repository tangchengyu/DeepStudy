const DAY_MS = 24 * 60 * 60 * 1_000;
const DELETE_BATCH_SIZE = 1_000;

export async function cleanupGatewayData(db: D1Database, now = Date.now()): Promise<void> {
  const thirtyDaysAgo = now - (30 * DAY_MS);
  const ninetyDaysAgo = now - (90 * DAY_MS);
  // A read-quota outage can prevent applying migration 0003 before deployment.
  // Bootstrap its additive schema when the next scheduled cleanup can access
  // D1 again. Subsequent runs only perform idempotent catalog/key checks.
  await db.batch([
    db.prepare(`
      CREATE INDEX IF NOT EXISTS sync_changes_entity_sequence_idx
        ON sync_changes(user_id, entity_type, entity_id, sequence)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS maintenance_cursors (
        task TEXT PRIMARY KEY NOT NULL,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        previous_sequence INTEGER NOT NULL DEFAULT 0
      )
    `),
    db.prepare("INSERT OR IGNORE INTO maintenance_cursors (task) VALUES ('sync_changes')")
  ]);
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
    // Advance across a bounded page even when every row is a retained latest
    // change. The cursor update and deletion share this transaction. Reset at
    // the end so recent changes are revisited after their retention period.
    db.prepare(`
      UPDATE maintenance_cursors
      SET previous_sequence = last_sequence,
          last_sequence = COALESCE((
            SELECT MAX(sequence) FROM (
              SELECT sequence FROM sync_changes
              WHERE sequence > maintenance_cursors.last_sequence
              ORDER BY sequence
              LIMIT ?
            )
          ), 0)
      WHERE task = 'sync_changes'
    `).bind(DELETE_BATCH_SIZE),
    db.prepare(`
      DELETE FROM sync_changes WHERE sequence IN (
        SELECT older.sequence
        FROM sync_changes AS older
        WHERE older.sequence > (
            SELECT previous_sequence FROM maintenance_cursors WHERE task = 'sync_changes'
          )
          AND older.sequence <= (
            SELECT last_sequence FROM maintenance_cursors WHERE task = 'sync_changes'
          )
          AND older.changed_at < ?
          AND EXISTS (
            SELECT 1 FROM sync_changes AS newer
            WHERE newer.user_id = older.user_id
              AND newer.entity_type = older.entity_type
              AND newer.entity_id = older.entity_id
              AND newer.sequence > older.sequence
          )
      )
    `).bind(thirtyDaysAgo)
  ]);
}
