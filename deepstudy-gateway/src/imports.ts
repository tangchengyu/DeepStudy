import { Hono } from "hono";
import { previewFirstImport, snapshotHash } from "@deepstudy/sync-contract";
import { hmacSha256Hex } from "./crypto";
import { readJsonObject } from "./http";
import { requiredDeviceId, sessionUser } from "./session";
import { applyMutation } from "./sync";

const MAX_IMPORT_RECORDS = 5_000;
const MAX_IMPORT_BYTES = 900_000;
const MAX_IMPORT_REQUEST_BYTES = 920_000;
const COMMIT_CHUNK_SIZE = 6;
const MAX_REPORT_ITEMS = 200;
const MAX_IMPORT_PLAN_BYTES = 1_800_000;

interface ImportRecord {
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  revision: number;
  clientUpdatedAt: number | string;
  serverUpdatedAt: number | string | null;
  deviceId: string;
  legacySourceId?: string;
}

interface ImportPlan {
  snapshotHash: string;
  counts: Record<string, number>;
  additions: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  tombstones: Array<Record<string, unknown>>;
  pendingRecords: ImportRecord[];
  results: Array<Record<string, unknown>>;
  summaryTruncated: boolean;
}

interface ImportRow {
  id: string;
  status: string;
  summary_json: string;
  next_index: number;
  total_items: number;
  committed_at: number | null;
}

interface CloudRecordRow {
  entity_type: string;
  entity_id: string;
  payload: string;
  deleted: number;
  revision: number;
  client_updated_at: number;
  server_updated_at: number;
  device_id: string;
  legacy_source_id: string | null;
}

interface DeviceImportRow {
  enrollment_snapshot_hash: string | null;
  enrolled_at: number | null;
}

function importResponse(row: ImportRow, plan: ImportPlan) {
  return {
    importId: row.id,
    status: row.status,
    snapshotHash: plan.snapshotHash,
    counts: plan.counts,
    additions: plan.additions,
    duplicates: plan.duplicates,
    conflicts: plan.conflicts,
    tombstones: plan.tombstones,
    nextIndex: row.next_index,
    totalItems: row.total_items,
    committedAt: row.committed_at,
    results: plan.results,
    summaryTruncated: plan.summaryTruncated
  };
}

function boundedReport(items: Array<Record<string, unknown>>) {
  return items.slice(0, MAX_REPORT_ITEMS);
}

function compactImportResult(result: Record<string, unknown>) {
  const remote = result.remote && typeof result.remote === "object"
    ? result.remote as Record<string, unknown>
    : null;
  return {
    mutationId: String(result.mutationId ?? ""),
    status: String(result.status ?? ""),
    ...(result.conflictId ? { conflictId: String(result.conflictId) } : {}),
    ...(result.entityType ? { entityType: String(result.entityType) } : {}),
    ...(result.entityId ? { entityId: String(result.entityId) } : {}),
    ...(remote?.entityType ? { entityType: String(remote.entityType) } : {}),
    ...(remote?.entityId ? { entityId: String(remote.entityId) } : {}),
    ...(remote?.revision !== undefined ? { remoteRevision: Number(remote.revision) } : {})
  };
}

function appendExceptionalResults(plan: ImportPlan, results: Array<Record<string, unknown>>) {
  const exceptional = results
    .filter((result) => result.status !== "applied")
    .map(compactImportResult);
  if (!exceptional.length) return;
  const remaining = Math.max(0, MAX_REPORT_ITEMS - plan.results.length);
  plan.results.push(...exceptional.slice(0, remaining));
  if (exceptional.length > remaining) plan.summaryTruncated = true;
}

function serializeImportPlan(plan: ImportPlan) {
  let serialized = JSON.stringify(plan);
  if (new TextEncoder().encode(serialized).byteLength <= MAX_IMPORT_PLAN_BYTES) return serialized;
  plan.additions = [];
  plan.duplicates = [];
  plan.conflicts = [];
  plan.tombstones = [];
  plan.results = [];
  plan.summaryTruncated = true;
  serialized = JSON.stringify(plan);
  if (new TextEncoder().encode(serialized).byteLength > MAX_IMPORT_PLAN_BYTES) {
    throw new Error("Import plan exceeds the safe D1 row size after compaction.");
  }
  return serialized;
}

function rowToRecord(row: CloudRecordRow): ImportRecord {
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    deleted: row.deleted === 1,
    revision: row.revision,
    clientUpdatedAt: row.client_updated_at,
    serverUpdatedAt: row.server_updated_at,
    deviceId: row.device_id,
    ...(row.legacy_source_id ? { legacySourceId: row.legacy_source_id } : {})
  };
}

function parsePlan(row: ImportRow): ImportPlan {
  return JSON.parse(row.summary_json) as ImportPlan;
}

export const importRoutes = new Hono<{ Bindings: Env }>();

importRoutes.post("/imports/preview", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c, MAX_IMPORT_REQUEST_BYTES);
  const records = body?.records;
  const providedHash = String(body?.snapshotHash ?? "");
  if (!deviceId || !Array.isArray(records) || records.length > MAX_IMPORT_RECORDS) {
    return c.json({ error: "INVALID_IMPORT" }, 400);
  }
  const serializedBytes = new TextEncoder().encode(JSON.stringify(records)).byteLength;
  if (serializedBytes > MAX_IMPORT_BYTES) return c.json({ error: "IMPORT_TOO_LARGE" }, 413);

  let computedHash: string;
  try {
    computedHash = snapshotHash(records);
  } catch (error) {
    return c.json({ error: "INVALID_IMPORT_RECORDS", message: error instanceof Error ? error.message : String(error) }, 400);
  }
  if (computedHash !== providedHash) return c.json({ error: "SNAPSHOT_HASH_MISMATCH" }, 409);
  if ((records as ImportRecord[]).some((record) => record.deviceId !== deviceId)) {
    return c.json({ error: "DEVICE_ID_MISMATCH" }, 400);
  }

  const { id: userId } = sessionUser(c);
  const device = await c.env.DB.prepare(`
    SELECT enrollment_snapshot_hash, enrolled_at
    FROM devices WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
  `).bind(userId, deviceId).first<DeviceImportRow>();
  if (!device) return c.json({ error: "DEVICE_NOT_REGISTERED" }, 409);
  if (device.enrollment_snapshot_hash && device.enrollment_snapshot_hash !== computedHash) {
    return c.json({ error: "DEVICE_ALREADY_ENROLLED" }, 409);
  }
  const existing = await c.env.DB.prepare(`
    SELECT id, status, summary_json, next_index, total_items, committed_at
    FROM sync_imports
    WHERE user_id = ? AND device_id = ? AND snapshot_hash = ?
  `).bind(userId, deviceId, computedHash).first<ImportRow>();
  if (existing && !new Set(["blocked", "superseded"]).has(existing.status)) {
    if (existing.status === "committed" && !device.enrolled_at) {
      await c.env.DB.prepare(`
        UPDATE devices
        SET enrollment_snapshot_hash = ?, enrolled_at = COALESCE(enrolled_at, ?)
        WHERE user_id = ? AND device_id = ?
          AND (enrollment_snapshot_hash IS NULL OR enrollment_snapshot_hash = ?)
      `).bind(computedHash, existing.committed_at ?? Date.now(), userId, deviceId, computedHash).run();
    }
    return c.json(importResponse(existing, parsePlan(existing)));
  }
  if (existing) {
    await c.env.DB.prepare(`
      DELETE FROM sync_imports
      WHERE id = ? AND user_id = ? AND device_id = ? AND status IN ('blocked', 'superseded')
    `).bind(existing.id, userId, deviceId).run();
  }
  if (device.enrolled_at) return c.json({ error: "DEVICE_ALREADY_ENROLLED" }, 409);

  await c.env.DB.prepare(`
    DELETE FROM sync_imports
    WHERE user_id = ? AND device_id = ? AND status = 'previewed' AND snapshot_hash <> ?
  `).bind(userId, deviceId, computedHash).run();

  const cloud = await c.env.DB.prepare(`
    SELECT entity_type, entity_id, payload, deleted, revision,
           client_updated_at, server_updated_at, device_id, legacy_source_id
    FROM sync_records
    WHERE user_id = ?
    ORDER BY entity_type, entity_id
    LIMIT ?
  `).bind(userId, MAX_IMPORT_RECORDS + 1).all<CloudRecordRow>();
  if ((cloud.results?.length ?? 0) > MAX_IMPORT_RECORDS) return c.json({ error: "CLOUD_SNAPSHOT_TOO_LARGE" }, 413);
  const cloudRecords = (cloud.results ?? []).map(rowToRecord);
  const preview = previewFirstImport({ localRecords: records, cloudRecords });
  const cloudIdentities = new Set(cloudRecords.map((record) => `${record.entityType}\u0000${record.entityId}`));
  const mergedRecords = preview.mergedRecords as unknown as ImportRecord[];
  const pendingRecords = mergedRecords.filter((record) => (
    !cloudIdentities.has(`${record.entityType}\u0000${record.entityId}`)
  ));
  const plan: ImportPlan = {
    snapshotHash: computedHash,
    counts: preview.counts,
    additions: boundedReport(preview.additions),
    duplicates: boundedReport(preview.duplicates),
    conflicts: boundedReport(preview.conflicts),
    tombstones: boundedReport(preview.tombstones),
    pendingRecords,
    results: [],
    summaryTruncated: [preview.additions, preview.duplicates, preview.conflicts, preview.tombstones]
      .some((items) => items.length > MAX_REPORT_ITEMS)
  };
  const importId = crypto.randomUUID();
  const now = Date.now();
  const serializedPlan = serializeImportPlan(plan);
  await c.env.DB.prepare(`
    INSERT INTO sync_imports (
      id, user_id, device_id, snapshot_hash, status, summary_json,
      next_index, total_items, created_at, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(
    importId,
    userId,
    deviceId,
    computedHash,
    pendingRecords.length ? "previewed" : "committed",
    serializedPlan,
    pendingRecords.length,
    now,
    pendingRecords.length ? null : now
  ).run();
  if (!pendingRecords.length) {
    const claim = await c.env.DB.prepare(`
      UPDATE devices
      SET enrollment_snapshot_hash = ?, enrolled_at = ?
      WHERE user_id = ? AND device_id = ?
        AND (enrollment_snapshot_hash IS NULL OR enrollment_snapshot_hash = ?)
    `).bind(computedHash, now, userId, deviceId, computedHash).run();
    if ((claim.meta.changes ?? 0) === 0) {
      await c.env.DB.prepare("DELETE FROM sync_imports WHERE id = ?").bind(importId).run();
      return c.json({ error: "DEVICE_ALREADY_ENROLLED" }, 409);
    }
  }
  const row: ImportRow = {
    id: importId,
    status: pendingRecords.length ? "previewed" : "committed",
    summary_json: serializedPlan,
    next_index: 0,
    total_items: pendingRecords.length,
    committed_at: pendingRecords.length ? null : now
  };
  return c.json(importResponse(row, plan));
});

importRoutes.post("/imports/commit", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c);
  const importId = String(body?.importId ?? "");
  const expectedIndex = body?.expectedIndex;
  if (!deviceId || !importId || !Number.isSafeInteger(expectedIndex) || Number(expectedIndex) < 0) {
    return c.json({ error: "INVALID_IMPORT_COMMIT" }, 400);
  }
  const expectedIndexNumber = Number(expectedIndex);
  const { id: userId } = sessionUser(c);
  const row = await c.env.DB.prepare(`
    SELECT id, status, summary_json, next_index, total_items, committed_at
    FROM sync_imports
    WHERE id = ? AND user_id = ? AND device_id = ?
  `).bind(importId, userId, deviceId).first<ImportRow>();
  if (!row) return c.json({ error: "IMPORT_NOT_FOUND" }, 404);
  const plan = parsePlan(row);
  if (row.status === "blocked") {
    return c.json({ error: "IMPORT_REPREVIEW_REQUIRED", ...importResponse(row, plan) }, 409);
  }
  if (row.status === "superseded") {
    return c.json({ error: "IMPORT_SUPERSEDED", ...importResponse(row, plan) }, 409);
  }
  if (!new Set(["previewed", "applying", "committed"]).has(row.status)) {
    return c.json({ error: "IMPORT_NOT_COMMITTABLE", ...importResponse(row, plan) }, 409);
  }
  const enrollmentClaim = await c.env.DB.prepare(`
    UPDATE devices
    SET enrollment_snapshot_hash = COALESCE(enrollment_snapshot_hash, ?)
    WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
      AND (enrollment_snapshot_hash IS NULL OR enrollment_snapshot_hash = ?)
  `).bind(plan.snapshotHash, userId, deviceId, plan.snapshotHash).run();
  if ((enrollmentClaim.meta.changes ?? 0) === 0) {
    return c.json({ error: "DEVICE_ALREADY_ENROLLED" }, 409);
  }
  if (row.status === "committed") {
    await c.env.DB.prepare(`
      UPDATE devices SET enrolled_at = COALESCE(enrolled_at, ?)
      WHERE user_id = ? AND device_id = ? AND enrollment_snapshot_hash = ?
    `).bind(row.committed_at ?? Date.now(), userId, deviceId, plan.snapshotHash).run();
    return c.json(importResponse(row, plan));
  }
  if (row.next_index !== expectedIndexNumber) return c.json({ error: "STALE_IMPORT_CURSOR", ...importResponse(row, plan) }, 409);

  const endIndex = Math.min(row.total_items, row.next_index + COMMIT_CHUNK_SIZE);
  const chunk = plan.pendingRecords.slice(row.next_index, endIndex);
  const chunkResults: Array<Record<string, unknown>> = [];
  for (const record of chunk) {
    const digest = await hmacSha256Hex(
      c.env.GATEWAY_SECRET,
      `import:${importId}:${record.entityType}:${record.entityId}`
    );
    chunkResults.push(await applyMutation(c.env.DB, userId, deviceId, {
      mutationId: `import-${digest.slice(0, 48)}`,
      baseRevision: 0,
      record: {
        ...record,
        revision: 0,
        serverUpdatedAt: null,
        deviceId
      }
    }));
  }

  const importConflict = chunkResults.find((result) => result.status === "conflict");
  if (importConflict) {
    appendExceptionalResults(plan, chunkResults);
    const serializedPlan = serializeImportPlan(plan);
    const blockedAt = row.next_index + chunkResults.length;
    const conflictIds = [...new Set(chunkResults
      .filter((result) => result.status === "conflict")
      .map((result) => String(result.conflictId ?? ""))
      .filter(Boolean))];
    const blocked = await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE sync_imports
        SET status = 'blocked', summary_json = ?, next_index = ?
        WHERE id = ? AND user_id = ? AND device_id = ? AND next_index = ?
          AND status IN ('previewed', 'applying')
      `).bind(serializedPlan, blockedAt, importId, userId, deviceId, row.next_index),
      c.env.DB.prepare(`
        UPDATE devices
        SET enrollment_snapshot_hash = NULL
        WHERE user_id = ? AND device_id = ? AND enrolled_at IS NULL
          AND enrollment_snapshot_hash = ?
          AND EXISTS (SELECT 1 FROM sync_imports WHERE id = ? AND status = 'blocked')
      `).bind(userId, deviceId, plan.snapshotHash, importId),
      ...conflictIds.map((conflictId) => c.env.DB.prepare(`
          UPDATE sync_conflicts
          SET status = 'resolved_import_repreview', resolved_at = ?
          WHERE id = ? AND user_id = ? AND status = 'open'
            AND EXISTS (SELECT 1 FROM sync_imports WHERE id = ? AND status = 'blocked')
        `).bind(Date.now(), conflictId, userId, importId))
    ]);
    if ((blocked[0].meta.changes ?? 0) === 0) {
      const latest = await c.env.DB.prepare(`
        SELECT id, status, summary_json, next_index, total_items, committed_at
        FROM sync_imports WHERE id = ? AND user_id = ? AND device_id = ?
      `).bind(importId, userId, deviceId).first<ImportRow>();
      if (!latest) return c.json({ error: "IMPORT_NOT_FOUND" }, 404);
      return c.json({ error: "STALE_IMPORT_CURSOR", ...importResponse(latest, parsePlan(latest)) }, 409);
    }
    return c.json({
      error: "IMPORT_REPREVIEW_REQUIRED",
      ...importResponse({ ...row, status: "blocked", next_index: blockedAt }, plan)
    }, 409);
  }

  const nextIndex = endIndex;
  appendExceptionalResults(plan, chunkResults);
  const completed = nextIndex >= row.total_items;
  if (completed) plan.pendingRecords = [];
  const serializedPlan = serializeImportPlan(plan);
  const now = Date.now();
  const importUpdate = c.env.DB.prepare(`
    UPDATE sync_imports
    SET status = ?, summary_json = ?, next_index = ?, committed_at = ?
    WHERE id = ? AND user_id = ? AND device_id = ? AND next_index = ?
      AND status IN ('previewed', 'applying')
  `).bind(
    completed ? "committed" : "applying",
    serializedPlan,
    nextIndex,
    completed ? now : null,
    importId,
    userId,
    deviceId,
    row.next_index
  );
  const updates = completed
    ? await c.env.DB.batch([
      importUpdate,
      c.env.DB.prepare(`
        UPDATE devices
        SET enrolled_at = COALESCE(enrolled_at, ?)
        WHERE user_id = ? AND device_id = ? AND enrollment_snapshot_hash = ?
      `).bind(now, userId, deviceId, plan.snapshotHash)
    ])
    : [await importUpdate.run()];
  if ((updates[0].meta.changes ?? 0) === 0) {
    const latest = await c.env.DB.prepare(`
      SELECT id, status, summary_json, next_index, total_items, committed_at
      FROM sync_imports WHERE id = ? AND user_id = ? AND device_id = ?
    `).bind(importId, userId, deviceId).first<ImportRow>();
    if (!latest) return c.json({ error: "IMPORT_NOT_FOUND" }, 404);
    return c.json({ error: "STALE_IMPORT_CURSOR", ...importResponse(latest, parsePlan(latest)) }, 409);
  }
  const nextRow: ImportRow = {
    ...row,
    status: completed ? "committed" : "applying",
    summary_json: serializedPlan,
    next_index: nextIndex,
    committed_at: completed ? now : null
  };
  return c.json(importResponse(nextRow, plan));
});
