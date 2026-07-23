PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  username TEXT UNIQUE,
  displayUsername TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  enrollment_snapshot_hash TEXT,
  enrolled_at INTEGER,
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS devices_user_seen_idx ON devices(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS account_action_limits (
  limit_key TEXT PRIMARY KEY NOT NULL,
  request_count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_action_limits_expiry_idx ON account_action_limits(expires_at);

CREATE TABLE IF NOT EXISTS sync_records (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  client_updated_at INTEGER NOT NULL,
  server_updated_at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  legacy_source_id TEXT,
  last_mutation_id TEXT NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS sync_records_user_revision_idx ON sync_records(user_id, revision);

CREATE TABLE IF NOT EXISTS sync_mutations (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  applied_revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_changes_user_sequence_idx ON sync_changes(user_id, sequence);

CREATE TABLE IF NOT EXISTS sync_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  UNIQUE (user_id, device_id, snapshot_hash)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  remote_payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS sync_conflicts_user_status_idx ON sync_conflicts(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS active_timers (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  owner_device_id TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_version INTEGER NOT NULL,
  target_end_at INTEGER,
  remaining_ms INTEGER NOT NULL,
  planned_ms INTEGER NOT NULL,
  session_start_at INTEGER,
  segment_start_at INTEGER,
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  work_type TEXT,
  updated_at INTEGER NOT NULL
);
