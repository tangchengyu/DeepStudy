ALTER TABLE sync_conflicts ADD COLUMN resolution_operation_id TEXT;
ALTER TABLE sync_conflicts ADD COLUMN resolution_result_json TEXT;

CREATE INDEX IF NOT EXISTS sync_conflicts_user_resolution_operation_idx
  ON sync_conflicts(user_id, resolution_operation_id);

CREATE TABLE IF NOT EXISTS conflict_resolution_receipts (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conflict_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, conflict_id),
  UNIQUE (user_id, operation_id)
);
