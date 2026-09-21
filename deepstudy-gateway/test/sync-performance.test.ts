import { env } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupGatewayData } from "../src/cleanup";
import { syncRoutes } from "../src/sync";

const DAY_MS = 24 * 60 * 60 * 1_000;
const fixtureUsers = new Set<string>();

afterEach(async () => {
  for (const userId of fixtureUsers) {
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(userId).run();
  }
  fixtureUsers.clear();
  await env.DB.prepare("UPDATE maintenance_cursors SET last_sequence = 0, previous_sequence = 0").run();
});

function measureDatabase(database: D1Database) {
  const reads: { sql: string; rows: number }[] = [];
  const originals = new WeakMap<object, { statement: D1PreparedStatement; sql: string }>();
  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    async function all() {
      const result = await statement.all();
      reads.push({ sql, rows: result.meta.rows_read });
      return result;
    }
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      all,
      run: all,
      first: async (column?: string) => {
        const result = await all();
        const first = result.results[0];
        return first ? (column ? first[column] : first) : null;
      }
    } as D1PreparedStatement;
    originals.set(wrapped, { statement, sql });
    return wrapped;
  }
  const db = {
    prepare: (sql: string) => wrap(database.prepare(sql), sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const unwrapped = statements.map((statement) => originals.get(statement)!);
      const results = await database.batch(unwrapped.map(({ statement }) => statement));
      results.forEach((result, index) => reads.push({ sql: unwrapped[index].sql, rows: result.meta.rows_read }));
      return results;
    }
  } as unknown as D1Database;
  return { db, reads, total: () => reads.reduce((sum, entry) => sum + entry.rows, 0) };
}

async function seedRecords(count: number, changedAt: number) {
  const userId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO user (id, name, email, createdAt, updatedAt) VALUES (?, 'Performance fixture', ?, ?, ?)
  `).bind(userId, `${userId}@test.invalid`, changedAt, changedAt).run();
  fixtureUsers.add(userId);
  await env.DB.prepare(`
    WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
    INSERT INTO sync_records (
      user_id, entity_type, entity_id, payload, deleted, revision,
      client_updated_at, server_updated_at, device_id, last_mutation_id
    )
    SELECT ?, 'reflection', 'entity-' || n, '{"notes":"latest"}', n % 2, 1,
           ?, ?, 'performance-device', 'mutation-' || n FROM numbers
  `).bind(count, userId, changedAt, changedAt).run();
  await env.DB.prepare(`
    INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, changed_at)
    SELECT user_id, entity_type, entity_id, revision, ? FROM sync_records WHERE user_id = ?
    ORDER BY CAST(SUBSTR(entity_id, 8) AS INTEGER)
  `).bind(changedAt, userId).run();
  return userId;
}

function pullApp(userId: string) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", async (c, next) => {
    c.set("session" as never, { user: { id: userId } } as never);
    await next();
  });
  app.route("/", syncRoutes);
  return app;
}

describe("sync database read costs", () => {
  it("safely bootstraps the old schema when a quota outage delayed the migration", async () => {
    const now = Date.now();
    const userId = await seedRecords(2, now - 60 * DAY_MS);
    await env.DB.batch([
      env.DB.prepare("DROP INDEX sync_changes_entity_sequence_idx"),
      env.DB.prepare("DROP TABLE maintenance_cursors"),
      env.DB.prepare(`
        INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, changed_at)
        VALUES (?, 'reflection', 'entity-1', 2, ?)
      `).bind(userId, now)
    ]);
    await cleanupGatewayData(env.DB, now);
    const schema = await env.DB.prepare(`
      SELECT name FROM sqlite_schema
      WHERE name IN ('sync_changes_entity_sequence_idx', 'maintenance_cursors')
      ORDER BY name
    `).all<{ name: string }>();
    expect(schema.results.map((row) => row.name)).toEqual([
      'maintenance_cursors', 'sync_changes_entity_sequence_idx'
    ]);
    const remaining = await env.DB.prepare(`
      SELECT entity_id, revision FROM sync_changes WHERE user_id = ? ORDER BY entity_id
    `).bind(userId).all<{ entity_id: string; revision: number }>();
    expect(remaining.results).toEqual([
      { entity_id: 'entity-1', revision: 2 },
      { entity_id: 'entity-2', revision: 1 }
    ]);
    const repeated = measureDatabase(env.DB);
    await cleanupGatewayData(repeated.db, now);
    const schemaReads = repeated.reads
      .filter(({ sql }) => /CREATE|INSERT OR IGNORE/.test(sql))
      .reduce((sum, { rows }) => sum + rows, 0);
    expect(schemaReads).toBeLessThan(20);
    const afterRepeat = await env.DB.prepare(`
      SELECT entity_id, revision FROM sync_changes WHERE user_id = ? ORDER BY entity_id
    `).bind(userId).all<{ entity_id: string; revision: number }>();
    expect(afterRepeat.results).toEqual(remaining.results);
  });

  it("keeps caught-up pulls and one-change pulls independent of account size", async () => {
    const userId = await seedRecords(3_000, Date.now());
    const latest = await env.DB.prepare("SELECT MAX(sequence) AS sequence FROM sync_changes WHERE user_id = ?")
      .bind(userId).first<{ sequence: number }>();
    const app = pullApp(userId);
    const idle = measureDatabase(env.DB);
    const idleResponse = await app.request(`/sync/pull?cursor=${latest!.sequence}`, {}, { ...env, DB: idle.db });
    expect(await idleResponse.json()).toEqual({ records: [], cursor: latest!.sequence, hasMore: false });
    expect(idle.total()).toBeLessThanOrEqual(8);

    const one = measureDatabase(env.DB);
    const oneResponse = await app.request(`/sync/pull?cursor=${latest!.sequence - 1}&limit=1`, {}, { ...env, DB: one.db });
    expect(await oneResponse.json()).toMatchObject({
      records: [{ entityId: "entity-3000", payload: { notes: "latest" }, deleted: false }],
      cursor: latest!.sequence,
      hasMore: false
    });
    expect(one.total()).toBeLessThanOrEqual(20);
    console.info("pull rows read", { idle: idle.total(), one: one.total() });
  });

  it("advances bounded cleanup pages past retained latest rows and tombstones", async () => {
    const now = Date.now();
    const userId = await seedRecords(2_500, now - 60 * DAY_MS);
    const first = await env.DB.prepare("SELECT MIN(sequence) AS sequence FROM sync_changes WHERE user_id = ?")
      .bind(userId).first<{ sequence: number }>();
    await env.DB.prepare(`
      INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, changed_at)
      VALUES (?, 'reflection', 'entity-2500', 2, ?), (?, 'reflection', 'entity-2500', 3, ?)
    `).bind(userId, now - 40 * DAY_MS, userId, now).run();
    const pageReads: number[] = [];
    for (let page = 0; page < 3; page += 1) {
      const measured = measureDatabase(env.DB);
      await cleanupGatewayData(measured.db, now);
      pageReads.push(measured.total());
      expect(measured.total()).toBeLessThan(12_000);
      if (page === 0) {
        const tail = await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE user_id = ? AND entity_id = 'entity-2500'")
          .bind(userId).first<{ count: number }>();
        expect(tail!.count).toBe(3);
      }
    }
    const remaining = await env.DB.prepare("SELECT COUNT(*) AS count, MIN(sequence) AS sequence FROM sync_changes WHERE user_id = ?")
      .bind(userId).first<{ count: number; sequence: number }>();
    expect(remaining).toEqual({ count: 2_500, sequence: first!.sequence });
    const stored = await env.DB.prepare("SELECT COUNT(*) AS count, SUM(deleted) AS tombstones FROM sync_records WHERE user_id = ?")
      .bind(userId).first<{ count: number; tombstones: number }>();
    expect(stored).toEqual({ count: 2_500, tombstones: 1_250 });
    console.info("cleanup rows read per page", pageReads);
  });

  it("revisits recent history after cursor wrap without deleting other entity or account histories", async () => {
    const now = Date.now();
    const userId = await seedRecords(1, now);
    const otherUserId = await seedRecords(1, now - 60 * DAY_MS);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO sync_records (
          user_id, entity_type, entity_id, payload, deleted, revision,
          client_updated_at, server_updated_at, device_id, last_mutation_id
        )
        SELECT user_id, 'longTask', entity_id, payload, 0, 1,
               client_updated_at, server_updated_at, device_id, 'other-type-mutation'
        FROM sync_records WHERE user_id = ?
      `).bind(userId),
      env.DB.prepare(`
        INSERT INTO sync_changes (user_id, entity_type, entity_id, revision, changed_at)
        VALUES (?, 'reflection', 'entity-1', 2, ?), (?, 'longTask', 'entity-1', 1, ?)
      `).bind(userId, now, userId, now - 60 * DAY_MS),
      env.DB.prepare(`
        UPDATE sync_records SET revision = 2, deleted = 1 WHERE user_id = ? AND entity_type = 'reflection'
      `).bind(userId)
    ]);
    await cleanupGatewayData(env.DB, now);
    const beforeExpiry = await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE user_id = ?")
      .bind(userId).first<{ count: number }>();
    expect(beforeExpiry!.count).toBe(3);
    // The first call at the end resets the cursor; the following one revisits
    // rows that have since crossed the thirty-day retention threshold.
    await cleanupGatewayData(env.DB, now + 60 * DAY_MS);
    await cleanupGatewayData(env.DB, now + 60 * DAY_MS);
    const histories = await env.DB.prepare(`
      SELECT user_id, entity_type, revision FROM sync_changes ORDER BY user_id, entity_type
    `).all<{ user_id: string; entity_type: string; revision: number }>();
    expect(histories.results.filter((row) => row.user_id === userId)).toEqual([
      { user_id: userId, entity_type: "longTask", revision: 1 },
      { user_id: userId, entity_type: "reflection", revision: 2 }
    ]);
    expect(histories.results.filter((row) => row.user_id === otherUserId)).toEqual([
      { user_id: otherUserId, entity_type: "reflection", revision: 1 }
    ]);
    const app = pullApp(userId);
    const pull = await app.request("/sync/pull?cursor=0", {}, env);
    expect(await pull.json()).toMatchObject({
      records: [
        { entityType: "reflection", entityId: "entity-1", deleted: true, revision: 2 },
        { entityType: "longTask", entityId: "entity-1", deleted: false, revision: 1 }
      ],
      hasMore: false
    });
  });
});
