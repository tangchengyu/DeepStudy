CREATE INDEX IF NOT EXISTS sync_changes_entity_sequence_idx
  ON sync_changes(user_id, entity_type, entity_id, sequence);

CREATE TABLE IF NOT EXISTS maintenance_cursors (
  task TEXT PRIMARY KEY NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  previous_sequence INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO maintenance_cursors (task)
VALUES ('sync_changes');
