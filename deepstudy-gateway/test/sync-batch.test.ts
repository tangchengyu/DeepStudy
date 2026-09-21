import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import gateway from "../src/index";
import { createSession } from "../src/session";

describe("sync batches on a 50-query request budget", () => {
  it("acknowledges a safe prefix of an older client's 20-item queue and resumes all items", async () => {
    const userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES (?,?,?,0,0)")
      .bind(userId, "batch test", `${userId}@test.invalid`).run();
    const session = await createSession(env, userId, new Request("https://gateway.test"));
    let queries = 0;
    const db = {
      prepare(sql: string) {
        if (++queries > 50) throw new Error("Too many D1 queries in one request");
        return env.DB.prepare(sql);
      },
      batch: env.DB.batch.bind(env.DB)
    } as D1Database;
    const pending = Array.from({ length: 20 }, (_, index) => ({
      mutationId: `batch-budget-mutation-${index}`,
      baseRevision: 0,
      record: {
        entityType: "long_task", entityId: `budget-task-${index}`,
        payload: { title: `Task ${index}` }, deleted: false, revision: 0,
        clientUpdatedAt: Date.now(), serverUpdatedAt: null, deviceId: "batch-budget-device"
      }
    }));
    let sent = 0;
    while (pending.length) {
      queries = 0;
      const response = await gateway.fetch(new Request("https://gateway.test/v1/sync/push", {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}`, "x-device-id": "batch-budget-device", "content-type": "application/json" },
        body: JSON.stringify({ mutations: pending })
      }), { ...env, DB: db });
      expect(response.status).toBe(200);
      const body = await response.json<{ results: Array<{ mutationId: string; status: string }>; hasMore: boolean }>();
      expect(body.results).toHaveLength(Math.min(5, pending.length));
      expect(body.results.every((result) => result.status === "applied")).toBe(true);
      expect(queries).toBeLessThanOrEqual(50);
      expect(body.hasMore).toBe(pending.length > body.results.length);
      for (const result of body.results) {
        expect(result.mutationId).toBe(pending.shift()?.mutationId);
        sent += 1;
      }
    }
    expect(sent).toBe(20);
    const result = await env.DB.prepare("SELECT count(*) AS n FROM sync_records WHERE user_id = ?").bind(userId).first<{ n: number }>();
    expect(result?.n).toBe(20);
  });
});
