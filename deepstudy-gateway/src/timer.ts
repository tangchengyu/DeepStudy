import { Hono } from "hono";
import { readJsonObject } from "./http";
import { requiredDeviceId, sessionUser } from "./session";

interface TimerRow {
  mode: string;
  owner_device_id: string;
  status: string;
  lease_version: number;
  target_end_at: number | null;
  remaining_ms: number;
  planned_ms: number;
  session_start_at: number | null;
  segment_start_at: number | null;
  accumulated_ms: number;
  work_type: string | null;
  updated_at: number;
}

const MAX_TIMER_DURATION_MS = 31 * 24 * 60 * 60 * 1_000;

function nonNegativeSafeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maximum
    ? value
    : null;
}

function optionalTimestamp(value: unknown): number | null | undefined {
  if (value == null) return null;
  const parsed = nonNegativeSafeInteger(value);
  return parsed == null ? undefined : parsed;
}

function publicTimer(row: TimerRow | null) {
  if (!row) return null;
  return {
    mode: row.mode,
    ownerDeviceId: row.owner_device_id,
    status: row.status,
    leaseVersion: row.lease_version,
    targetEndAt: row.target_end_at,
    remainingMs: row.remaining_ms,
    plannedMs: row.planned_ms,
    sessionStartAt: row.session_start_at,
    segmentStartAt: row.segment_start_at,
    accumulatedMs: row.accumulated_ms,
    workType: row.work_type,
    updatedAt: row.updated_at
  };
}

async function currentTimer(db: D1Database, userId: string) {
  return db.prepare(`
    SELECT mode, owner_device_id, status, lease_version, target_end_at,
           remaining_ms, planned_ms, session_start_at, segment_start_at,
           accumulated_ms, work_type, updated_at
    FROM active_timers WHERE user_id = ?
  `).bind(userId).first<TimerRow>();
}

export const timerRoutes = new Hono<{ Bindings: Env }>();

timerRoutes.get("/timer", async (c) => {
  const { id: userId } = sessionUser(c);
  return c.json({ timer: publicTimer(await currentTimer(c.env.DB, userId)) });
});

timerRoutes.post("/timer/claim", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c);
  if (!deviceId || !body) return c.json({ error: "INVALID_TIMER_REQUEST" }, 400);
  const mode = String(body.mode ?? "");
  const status = String(body.status ?? "");
  const expectedLeaseVersion = nonNegativeSafeInteger(body.expectedLeaseVersion);
  const remainingMs = nonNegativeSafeInteger(body.remainingMs, MAX_TIMER_DURATION_MS);
  const plannedMs = nonNegativeSafeInteger(body.plannedMs, MAX_TIMER_DURATION_MS);
  const accumulatedMs = nonNegativeSafeInteger(body.accumulatedMs, MAX_TIMER_DURATION_MS);
  const targetEndAt = optionalTimestamp(body.targetEndAt);
  const sessionStartAt = optionalTimestamp(body.sessionStartAt);
  const segmentStartAt = optionalTimestamp(body.segmentStartAt);
  const takeover = body.takeover === true;
  if (!new Set(["focus", "rest"]).has(mode)
    || !new Set(["running", "paused"]).has(status)
    || expectedLeaseVersion == null
    || remainingMs == null
    || plannedMs == null
    || plannedMs <= 0
    || accumulatedMs == null
    || targetEndAt === undefined
    || sessionStartAt === undefined
    || segmentStartAt === undefined) {
    return c.json({ error: "INVALID_TIMER_REQUEST" }, 400);
  }
  const { id: userId } = sessionUser(c);
  const current = await currentTimer(c.env.DB, userId);
  if (!current && expectedLeaseVersion !== 0) {
    return c.json({ error: "STALE_TIMER_LEASE", timer: null }, 409);
  }
  if (current && current.lease_version !== expectedLeaseVersion) {
    return c.json({ error: "STALE_TIMER_LEASE", timer: publicTimer(current) }, 409);
  }
  if (current && current.owner_device_id !== deviceId && !takeover) {
    return c.json({ error: "TAKEOVER_CONFIRMATION_REQUIRED", timer: publicTimer(current) }, 409);
  }

  const nextLeaseVersion = (current?.lease_version ?? 0) + 1;
  const now = Date.now();
  const workType = body.workType == null ? null : String(body.workType).slice(0, 40);
  const result = await c.env.DB.prepare(`
    INSERT INTO active_timers (
      user_id, mode, owner_device_id, status, lease_version, target_end_at,
      remaining_ms, planned_ms, session_start_at, segment_start_at,
      accumulated_ms, work_type, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = excluded.mode,
      owner_device_id = excluded.owner_device_id,
      status = excluded.status,
      lease_version = excluded.lease_version,
      target_end_at = excluded.target_end_at,
      remaining_ms = excluded.remaining_ms,
      planned_ms = excluded.planned_ms,
      session_start_at = excluded.session_start_at,
      segment_start_at = excluded.segment_start_at,
      accumulated_ms = excluded.accumulated_ms,
      work_type = excluded.work_type,
      updated_at = excluded.updated_at
    WHERE active_timers.lease_version = ?
  `).bind(
    userId,
    mode,
    deviceId,
    status,
    nextLeaseVersion,
    targetEndAt,
    remainingMs,
    plannedMs,
    sessionStartAt,
    segmentStartAt,
    accumulatedMs,
    workType,
    now,
    expectedLeaseVersion
  ).run();
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: "STALE_TIMER_LEASE", timer: publicTimer(await currentTimer(c.env.DB, userId)) }, 409);
  }
  return c.json({ timer: publicTimer(await currentTimer(c.env.DB, userId)) });
});

timerRoutes.post("/timer/release", async (c) => {
  const deviceId = requiredDeviceId(c);
  const body = await readJsonObject(c);
  if (!deviceId || !body) return c.json({ error: "INVALID_TIMER_REQUEST" }, 400);
  const expectedLeaseVersion = nonNegativeSafeInteger(body.expectedLeaseVersion);
  if (expectedLeaseVersion == null) return c.json({ error: "INVALID_TIMER_REQUEST" }, 400);
  const { id: userId } = sessionUser(c);
  const result = await c.env.DB.prepare(`
    DELETE FROM active_timers
    WHERE user_id = ? AND owner_device_id = ? AND lease_version = ?
  `).bind(userId, deviceId, expectedLeaseVersion).run();
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: "STALE_TIMER_LEASE", timer: publicTimer(await currentTimer(c.env.DB, userId)) }, 409);
  }
  return c.json({ timer: null });
});
