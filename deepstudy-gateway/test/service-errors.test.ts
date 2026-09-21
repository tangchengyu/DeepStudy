import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import gateway from "../src/index";

describe("sync service availability errors", () => {
  it.each([
    ["Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.", "SYNC_DAILY_READ_LIMIT"],
    ["Your account has exceeded D1's free tier daily row write limit.", "SYNC_DAILY_WRITE_LIMIT"],
    ["D1_ERROR: database or disk is full: SQLITE_FULL", "SYNC_STORAGE_LIMIT"]
  ])("reports %s without exposing the underlying database error", async (message, code) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await gateway.fetch(new Request("https://gateway.test/v1/auth/session", {
        headers: { authorization: "Bearer test-session" }
      }), { ...env, DB: { prepare() { throw new Error(message); } } as unknown as D1Database });
      expect(response.status).toBe(503);
      const body = await response.json<{ error: string; message: string; retryAfterSeconds?: number }>();
      expect(body.error).toBe(code);
      expect(body.message).not.toContain("D1_ERROR");
      expect(body.message).toContain("本机");
      if (code !== "SYNC_STORAGE_LIMIT") {
        expect(body.retryAfterSeconds).toBeGreaterThan(0);
        expect(body.retryAfterSeconds).toBeLessThanOrEqual(86400);
        expect(response.headers.get("retry-after")).toBe(String(body.retryAfterSeconds));
      }
    } finally { spy.mockRestore(); }
  });

  it("keeps unexpected failures private and distinguishable from quota errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await gateway.fetch(new Request("https://gateway.test/v1/auth/session", {
        headers: { authorization: "Bearer test-session" }
      }), { ...env, DB: { prepare() { throw new Error("private database failure"); } } as unknown as D1Database });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "INTERNAL_ERROR" });
    } finally { spy.mockRestore(); }
  });
});
