import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import gateway from "../src/index";
import { createSession } from "../src/session";
import { applyMutation } from "../src/sync";

async function fixture() {
  const userId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES (?,?,?,0,0)")
    .bind(userId, "conflict status", `${userId}@test.invalid`).run();
  const session = await createSession(env, userId, new Request("https://gateway.test"));
  const record = { entityType: "long_task", entityId: "shared-note", payload: { notes: "old cloud" }, deleted: false, revision: 0, clientUpdatedAt: 1, serverUpdatedAt: null, deviceId: "status-test-device" };
  await applyMutation(env.DB, userId, record.deviceId, { mutationId: "status-original", baseRevision: 0, record });
  const conflict = await applyMutation(env.DB, userId, record.deviceId, { mutationId: "status-conflicting", baseRevision: 0, record: { ...record, payload: { notes: "old local" } } });
  const request = (suffix: string, method = "GET", body?: unknown) => gateway.fetch(new Request(`https://gateway.test/v1/sync/conflicts/${conflict.conflictId}${suffix}`, {
    method,
    headers: { authorization: `Bearer ${session.token}`, "x-device-id": record.deviceId, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { userId, record, conflict, request };
}

describe("read-only exact conflict status", () => {
  it("returns the latest record after resolution on another device", async () => {
    const f = await fixture();
    const resolved = await f.request("/resolve", "POST", { resolution: "keep_remote", operationId: "another-device-resolution" });
    expect(resolved.status).toBe(200);
    await applyMutation(env.DB, f.userId, f.record.deviceId, { mutationId: "status-new-cloud", baseRevision: 1, record: { ...f.record, payload: { notes: "old cloud\nnew line one\nnew line two" } } });
    const response = await f.request("");
    expect(response.status).toBe(200);
    const body = await response.json<{ status: string; record: { revision: number; payload: { notes: string } } }>();
    expect(body.status).toBe("resolved_keep_remote");
    expect(body.record.revision).toBe(2);
    expect(body.record.payload.notes).toContain("new line two");
  });

  it("does not resolve an open conflict when inspecting it", async () => {
    const f = await fixture();
    const response = await f.request("");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "open", record: null });
    const stored = await env.DB.prepare("SELECT status FROM sync_conflicts WHERE id = ?").bind(f.conflict.conflictId).first();
    expect(stored?.status).toBe("open");
  });

  it("never exposes another account's conflict or notes", async () => {
    const owner = await fixture();
    const other = await fixture();
    const session = await createSession(env, other.userId, new Request("https://gateway.test"));
    const response = await gateway.fetch(new Request(`https://gateway.test/v1/sync/conflicts/${owner.conflict.conflictId}`, {
      headers: { authorization: `Bearer ${session.token}`, "x-device-id": "status-other-device" },
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "unknown", record: null });
  });
});
