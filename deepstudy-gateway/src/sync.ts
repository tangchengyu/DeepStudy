import { Hono } from "hono";
import { stableStringify, validateMutation } from "@deepstudy/sync-contract";
import { readJsonObject } from "./http";
import { requiredDeviceId, sessionUser } from "./session";

const MAX_MUTATIONS = 20;
const MAX_SYNC_PUSH_BYTES = 900_000;
const RESOLUTION_LEASE_MS = 5 * 60_000;

interface MutationInput {
  mutationId: string;
  baseRevision: number;
  record: {
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    deleted: boolean;
    revision: number;
    clientUpdatedAt: number | string;
    serverUpdatedAt: number | string | null;
    deviceId: string;
    legacySourceId?: string;
  };
}

interface StoredRecord {
  entity_type: string;
  entity_id: string;
  payload: string;
  deleted: number;
  revision: number;
  client_updated_at: number;
  server_updated_at: number;
  device_id: string;
  legacy_source_id: string | null;
  last_mutation_id: string;
}

function parseMutation(value: unknown, deviceId: string): MutationInput | null {
  const result = validateMutation(value);
  if (!result.valid) return null;
  const mutation = value as MutationInput;
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(mutation.mutationId)) return null;
  if (mutation.record.deviceId !== deviceId) return null;
  return mutation;
}

function publicRecord(record: StoredRecord) {
  return {
    entityType: record.entity_type,
    entityId: record.entity_id,
    payload: JSON.parse(record.payload) as Record<string, unknown>,
    deleted: record.deleted === 1,
    revision: record.revision,
    clientUpdatedAt: record.client_updated_at,
    serverUpdatedAt: record.server_updated_at,
    deviceId: record.device_id,
    ...(record.legacy_source_id ? { legacySourceId: record.legacy_source_id } : {})
  };
}

async function storedRecord(db: D1Database, userId: string, entityType: string, entityId: string) {
  return db.prepare(`
    SELECT entity_type, entity_id, payload, deleted, revision,
           client_updated_at, server_updated_at, device_id, legacy_source_id, last_mutation_id
    FROM sync_records
    WHERE user_id = ? AND entity_type = ? AND entity_id = ?
  `).bind(userId, entityType, entityId).first<StoredRecord>();
}

async function recordConflict(
  db: D1Database,
  userId: string,
  mutation: MutationInput,
  remote: StoredRecord | null
): Promise<Record<string, unknown>> {
  const conflictId = crypto.randomUUID();
  const result = {
    mutationId: mutation.mutationId,
    status: "conflict",
    conflictId,
    remote: remote ? publicRecord(remote) : null
  };
  const now = Date.now();
  try {
    await db.batch([
      db.prepare(`
        INSERT INTO sync_conflicts (
          id, user_id, entity_type, entity_id, local_payload,
          remote_payload, status, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL)
      `).bind(
        conflictId,
        userId,
        mutation.record.entityType,
        mutation.record.entityId,
        JSON.stringify(mutation.record),
        JSON.stringify(result.remote),
        now
      ),
      db.prepare(`
        INSERT INTO sync_mutations (user_id, mutation_id, applied_revision, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        userId,
        mutation.mutationId,
        remote?.revision ?? 0,
        JSON.stringify(result),
        now
      )
    ]);
    return result;
  } catch (error) {
    const concurrentReceipt = await db.prepare(
      "SELECT result_json FROM sync_mutations WHERE user_id = ? AND mutation_id = ?"
    ).bind(userId, mutation.mutationId).first<{ result_json: string }>();
    if (concurrentReceipt) return JSON.parse(concurrentReceipt.result_json) as Record<string, unknown>;
    throw error;
  }
}

export async function applyMutation(
  db: D1Database,
  userId: string,
  deviceId: string,
  mutation: MutationInput
): Promise<Record<string, unknown>> {
  const receipt = await db.prepare(
    "SELECT result_json FROM sync_mutations WHERE user_id = ? AND mutation_id = ?"
  ).bind(userId, mutation.mutationId).first<{ result_json: string }>();
  if (receipt) return JSON.parse(receipt.result_json) as Record<string, unknown>;

  const current = await storedRecord(db, userId, mutation.record.entityType, mutation.record.entityId);
  if ((current?.revision ?? 0) !== mutation.baseRevision) {
    return recordConflict(db, userId, mutation, current);
  }

  const revision = mutation.baseRevision + 1;
  const now = Date.now();
  const result = {
    mutationId: mutation.mutationId,
    status: "applied",
    entityType: mutation.record.entityType,
    entityId: mutation.record.entityId,
    revision,
    serverUpdatedAt: now
  };

  try {
    const results = await db.batch([
      db.prepare(`
        INSERT INTO sync_records (
          user_id, entity_type, entity_id, payload, deleted, revision,
          client_updated_at, server_updated_at, device_id, legacy_source_id, last_mutation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
          payload = excluded.payload,
          deleted = excluded.deleted,
          revision = excluded.revision,
          client_updated_at = excluded.client_updated_at,
          server_updated_at = excluded.server_updated_at,
          device_id = excluded.device_id,
          legacy_source_id = excluded.legacy_source_id,
          last_mutation_id = excluded.last_mutation_id
        WHERE sync_records.revision = ?
      `).bind(
        userId,
        mutation.record.entityType,
        mutation.record.entityId,
        JSON.stringify(mutation.record.payload),
        mutation.record.deleted ? 1 : 0,
        revision,
        Math.round(typeof mutation.record.clientUpdatedAt === "string"
          ? Date.parse(mutation.record.clientUpdatedAt)
          : mutation.record.clientUpdatedAt),
        now,
        deviceId,
        mutation.record.legacySourceId ?? null,
        mutation.mutationId,
        mutation.baseRevision
      ),
      db.prepare(`
        INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, changed_at)
        SELECT user_id, entity_type, entity_id, revision, ?
        FROM sync_records
        WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND last_mutation_id = ?
      `).bind(now, userId, mutation.record.entityType, mutation.record.entityId, mutation.mutationId),
      db.prepare(`
        INSERT INTO sync_mutations (user_id, mutation_id, applied_revision, result_json, created_at)
        SELECT user_id, ?, revision, ?, ?
        FROM sync_records
        WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND last_mutation_id = ?
      `).bind(
        mutation.mutationId,
        JSON.stringify(result),
        now,
        userId,
        mutation.record.entityType,
        mutation.record.entityId,
        mutation.mutationId
      )
    ]);
    if ((results[0].meta.changes ?? 0) > 0 && (results[2].meta.changes ?? 0) > 0) return result;
  } catch (error) {
    const concurrentReceipt = await db.prepare(
      "SELECT result_json FROM sync_mutations WHERE user_id = ? AND mutation_id = ?"
    ).bind(userId, mutation.mutationId).first<{ result_json: string }>();
    if (concurrentReceipt) return JSON.parse(concurrentReceipt.result_json) as Record<string, unknown>;
    throw error;
  }

  const latest = await storedRecord(db, userId, mutation.record.entityType, mutation.record.entityId);
  return recordConflict(db, userId, mutation, latest);
}

export const syncRoutes = new Hono<{ Bindings: Env }>();

syncRoutes.post("/devices", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c);
  if (!deviceId || !body) return c.json({ error: "INVALID_DEVICE" }, 400);
  const name = String(body.name ?? "").trim().slice(0, 80);
  const platform = String(body.platform ?? "").trim().slice(0, 40);
  if (!name || !platform) return c.json({ error: "INVALID_DEVICE" }, 400);
  const { id: userId } = sessionUser(c);
  const now = Date.now();
  await c.env.DB.prepare(`
    INSERT INTO devices (user_id, device_id, name, platform, created_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id, device_id) DO UPDATE SET
      name = excluded.name,
      platform = excluded.platform,
      last_seen_at = excluded.last_seen_at,
      revoked_at = NULL
  `).bind(userId, deviceId, name, platform, now, now).run();
  return c.json({ ok: true, deviceId });
});

syncRoutes.post("/sync/push", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c, MAX_SYNC_PUSH_BYTES);
  const rawMutations = body?.mutations;
  if (!deviceId || !Array.isArray(rawMutations) || rawMutations.length > MAX_MUTATIONS) {
    return c.json({ error: "INVALID_MUTATIONS" }, 400);
  }
  const mutations = rawMutations.map((mutation) => parseMutation(mutation, deviceId));
  if (mutations.some((mutation) => !mutation)) return c.json({ error: "INVALID_MUTATION" }, 400);
  const { id: userId } = sessionUser(c);
  const results: Record<string, unknown>[] = [];
  for (const mutation of mutations as MutationInput[]) {
    results.push(await applyMutation(c.env.DB, userId, deviceId, mutation));
  }
  return c.json({ results });
});

syncRoutes.get("/sync/pull", async (c) => {
  const cursorValue = c.req.query("cursor");
  const cursor = cursorValue == null || cursorValue === "" ? 0 : Number(cursorValue);
  const limitValue = c.req.query("limit");
  const requestedLimit = limitValue == null || limitValue === "" ? 200 : Number(limitValue);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(requestedLimit)) {
    return c.json({ error: "INVALID_PULL_CURSOR" }, 400);
  }
  const limit = Math.max(1, Math.min(500, Math.trunc(requestedLimit)));
  const { id: userId } = sessionUser(c);
  const result = await c.env.DB.prepare(`
    WITH windowed AS (
      SELECT sequence, entity_type, entity_id
      FROM sync_changes
      WHERE user_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    ), latest AS (
      SELECT entity_type, entity_id, MAX(sequence) AS sequence
      FROM windowed
      GROUP BY entity_type, entity_id
    )
    SELECT r.entity_type, r.entity_id, r.payload, r.deleted, r.revision,
           r.client_updated_at, r.server_updated_at, r.device_id,
           r.legacy_source_id, latest.sequence
    FROM latest
    JOIN sync_records r
      ON r.user_id = ?
     AND r.entity_type = latest.entity_type
     AND r.entity_id = latest.entity_id
    ORDER BY latest.sequence ASC
  `).bind(userId, cursor, limit, userId).all<StoredRecord & { sequence: number }>();
  const rows = result.results ?? [];
  const nextCursor = rows.reduce((maximum, row) => Math.max(maximum, row.sequence), cursor);
  const later = await c.env.DB.prepare(`
    SELECT sequence
    FROM sync_changes
    WHERE user_id = ? AND sequence > ?
    ORDER BY sequence ASC
    LIMIT 1
  `).bind(userId, nextCursor).first<{ sequence: number }>();
  return c.json({ records: rows.map(publicRecord), cursor: nextCursor, hasMore: Boolean(later) });
});

syncRoutes.get("/sync/conflicts", async (c) => {
  const { id: userId } = sessionUser(c);
  await c.env.DB.prepare(`
    UPDATE sync_conflicts
    SET status = 'open', resolved_at = NULL,
        resolution_operation_id = NULL, resolution_result_json = NULL
    WHERE user_id = ? AND status = 'resolving' AND resolved_at <= ?
  `).bind(userId, Date.now() - RESOLUTION_LEASE_MS).run();
  const result = await c.env.DB.prepare(`
    SELECT id, entity_type, entity_id, local_payload, remote_payload, created_at
    FROM sync_conflicts
    WHERE user_id = ? AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(userId).all<{
    id: string;
    entity_type: string;
    entity_id: string;
    local_payload: string;
    remote_payload: string;
    created_at: number;
  }>();
  return c.json({
    conflicts: (result.results ?? []).map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      local: JSON.parse(row.local_payload),
      remote: JSON.parse(row.remote_payload),
      createdAt: row.created_at
    }))
  });
});

syncRoutes.post("/sync/conflicts/:id/resolve", async (c) => {
  const body = await readJsonObject(c);
  const resolution = String(body?.resolution ?? "");
  if (!body || !new Set(["keep_remote", "keep_local"]).has(resolution)) {
    return c.json({ error: "INVALID_CONFLICT_RESOLUTION" }, 400);
  }
  const { id: userId } = sessionUser(c);
  const conflictId = c.req.param("id");
  const suppliedOperationId = String(body.operationId ?? "").trim();
  const operationId = suppliedOperationId || (resolution === "keep_local"
    ? String(body.mutationId ?? "").trim()
    : `legacy:${conflictId}:keep_remote`);
  if (!operationId || operationId.length > 200) {
    return c.json({ error: "INVALID_CONFLICT_RESOLUTION_OPERATION" }, 400);
  }
  const existingOperation = await c.env.DB.prepare(`
    SELECT conflict_id, result_json
    FROM conflict_resolution_receipts
    WHERE user_id = ? AND operation_id = ?
  `).bind(userId, operationId).first<{ conflict_id: string; result_json: string }>();
  if (existingOperation) {
    if (existingOperation.conflict_id !== conflictId) {
      return c.json({ error: "CONFLICT_RESOLUTION_OPERATION_REUSED" }, 409);
    }
    return c.json({
      ...(JSON.parse(existingOperation.result_json) as Record<string, unknown>),
      idempotent: true
    });
  }
  await c.env.DB.prepare(`
    UPDATE sync_conflicts
    SET status = 'open', resolved_at = NULL,
        resolution_operation_id = NULL, resolution_result_json = NULL
    WHERE id = ? AND user_id = ? AND status = 'resolving' AND resolved_at <= ?
  `).bind(conflictId, userId, Date.now() - RESOLUTION_LEASE_MS).run();
  const conflict = await c.env.DB.prepare(`
    SELECT id, entity_type, entity_id, local_payload, remote_payload, status,
           resolution_operation_id, resolution_result_json
    FROM sync_conflicts
    WHERE id = ? AND user_id = ?
  `).bind(conflictId, userId).first<{
    id: string;
    entity_type: string;
    entity_id: string;
    local_payload: string;
    remote_payload: string;
    status: string;
    resolution_operation_id: string | null;
    resolution_result_json: string | null;
  }>();
  if (!conflict) return c.json({ error: "CONFLICT_NOT_FOUND" }, 404);
  if (conflict.status.startsWith("resolved_")) {
    if (conflict.resolution_operation_id === operationId && conflict.resolution_result_json) {
      return c.json({
        ...(JSON.parse(conflict.resolution_result_json) as Record<string, unknown>),
        idempotent: true
      });
    }
    return c.json({ error: "CONFLICT_ALREADY_RESOLVED", status: conflict.status }, 409);
  }
  if (conflict.status !== "open") {
    return c.json({ error: "CONFLICT_RESOLUTION_IN_PROGRESS", status: conflict.status }, 409);
  }

  if (resolution === "keep_remote") {
    const response = { ok: true, conflictId, resolution };
    const now = Date.now();
    const serializedResponse = JSON.stringify(response);
    const updates = await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE sync_conflicts
        SET status = 'resolved_keep_remote', resolved_at = ?,
            resolution_operation_id = ?, resolution_result_json = ?
        WHERE id = ? AND user_id = ? AND status = 'open'
      `).bind(now, operationId, serializedResponse, conflictId, userId),
      c.env.DB.prepare(`
        INSERT INTO conflict_resolution_receipts (
          user_id, conflict_id, operation_id, result_json, created_at
        )
        SELECT user_id, id, ?, ?, ? FROM sync_conflicts
        WHERE id = ? AND user_id = ?
          AND status = 'resolved_keep_remote' AND resolution_operation_id = ?
        ON CONFLICT(user_id, conflict_id) DO NOTHING
      `).bind(operationId, serializedResponse, now, conflictId, userId, operationId)
    ]);
    if ((updates[0].meta.changes ?? 0) === 0) return c.json({ error: "CONFLICT_ALREADY_RESOLVED" }, 409);
    return c.json(response);
  }

  const deviceId = requiredDeviceId(c);
  const mutationId = String(body.mutationId ?? "");
  const expectedRemoteRevision = body.expectedRemoteRevision;
  if (!Number.isSafeInteger(expectedRemoteRevision) || Number(expectedRemoteRevision) < 0) {
    return c.json({ error: "INVALID_CONFLICT_RESOLUTION" }, 400);
  }
  if (!deviceId) return c.json({ error: "INVALID_DEVICE" }, 400);
  let localRecord: MutationInput["record"];
  let remoteAtConflict: { revision?: unknown } | null;
  try {
    localRecord = JSON.parse(conflict.local_payload) as MutationInput["record"];
    remoteAtConflict = JSON.parse(conflict.remote_payload) as { revision?: unknown } | null;
  } catch {
    return c.json({ error: "INVALID_CONFLICT_STATE" }, 500);
  }
  if (Number(remoteAtConflict?.revision ?? 0) !== expectedRemoteRevision) {
    return c.json({ error: "STALE_CONFLICT_REVISION" }, 409);
  }
  const mutation = parseMutation({
    mutationId,
    baseRevision: Number(expectedRemoteRevision),
    record: {
      ...localRecord,
      revision: Number(expectedRemoteRevision),
      serverUpdatedAt: null,
      deviceId
    }
  }, deviceId);
  if (!mutation
    || mutation.record.entityType !== conflict.entity_type
    || mutation.record.entityId !== conflict.entity_id) {
    return c.json({ error: "INVALID_CONFLICT_RESOLUTION" }, 400);
  }

  const claim = await c.env.DB.prepare(`
    UPDATE sync_conflicts
    SET status = 'resolving', resolved_at = ?,
        resolution_operation_id = ?, resolution_result_json = NULL
    WHERE id = ? AND user_id = ? AND status = 'open'
  `).bind(Date.now(), operationId, conflictId, userId).run();
  if ((claim.meta.changes ?? 0) === 0) return c.json({ error: "CONFLICT_ALREADY_RESOLVED" }, 409);
  try {
    const result = await applyMutation(c.env.DB, userId, deviceId, mutation);
    const appliedRecord = result.status === "applied"
      ? await storedRecord(c.env.DB, userId, conflict.entity_type, conflict.entity_id)
      : null;
    if (result.status !== "applied"
      || result.entityType !== conflict.entity_type
      || result.entityId !== conflict.entity_id
      || !appliedRecord
      || appliedRecord.last_mutation_id !== mutation.mutationId
      || appliedRecord.revision !== result.revision
      || appliedRecord.deleted !== (mutation.record.deleted ? 1 : 0)
      || stableStringify(JSON.parse(appliedRecord.payload)) !== stableStringify(mutation.record.payload)) {
      await c.env.DB.prepare(`
        UPDATE sync_conflicts
        SET status = 'open', resolved_at = NULL,
            resolution_operation_id = NULL, resolution_result_json = NULL
        WHERE id = ? AND user_id = ? AND status = 'resolving'
          AND resolution_operation_id = ?
      `).bind(conflictId, userId, operationId).run();
      return c.json({ error: "STALE_CONFLICT_REVISION", result }, 409);
    }
    const response = { ok: true, conflictId, resolution, result };
    const now = Date.now();
    const serializedResponse = JSON.stringify(response);
    const updates = await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE sync_conflicts
        SET status = 'resolved_keep_local', resolved_at = ?, resolution_result_json = ?
        WHERE id = ? AND user_id = ? AND status = 'resolving'
          AND resolution_operation_id = ?
      `).bind(now, serializedResponse, conflictId, userId, operationId),
      c.env.DB.prepare(`
        INSERT INTO conflict_resolution_receipts (
          user_id, conflict_id, operation_id, result_json, created_at
        )
        SELECT user_id, id, ?, ?, ? FROM sync_conflicts
        WHERE id = ? AND user_id = ?
          AND status = 'resolved_keep_local' AND resolution_operation_id = ?
        ON CONFLICT(user_id, conflict_id) DO NOTHING
      `).bind(operationId, serializedResponse, now, conflictId, userId, operationId)
    ]);
    if ((updates[0].meta.changes ?? 0) === 0) {
      return c.json({ error: "CONFLICT_ALREADY_RESOLVED" }, 409);
    }
    return c.json(response);
  } catch (error) {
    await c.env.DB.prepare(`
      UPDATE sync_conflicts
      SET status = 'open', resolved_at = NULL,
          resolution_operation_id = NULL, resolution_result_json = NULL
      WHERE id = ? AND user_id = ? AND status = 'resolving'
        AND resolution_operation_id = ?
    `).bind(conflictId, userId, operationId).run();
    throw error;
  }
});
