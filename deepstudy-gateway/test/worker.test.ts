import { env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { snapshotHash } from "@deepstudy/sync-contract";
import { verifyTurnstile } from "../src/turnstile";
import { cleanupGatewayData } from "../src/cleanup";

const PASSWORD = "correct-horse-battery-staple";
let registrationIpSuffix = 20;

function username(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function jsonRequest(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return SELF.fetch(`https://gateway.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.test",
      "cf-connecting-ip": "192.0.2.10",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function register(prefix: string) {
  const accountUsername = username(prefix);
  const response = await jsonRequest("/v1/auth/register", {
    username: accountUsername,
    password: PASSWORD,
    turnstileToken: "local-test-token"
  }, {
    "cf-connecting-ip": `192.0.2.${registrationIpSuffix++}`
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ recoveryCode: string }>();
  const token = response.headers.get("set-auth-token");
  expect(body.recoveryCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  expect(token).toBeTruthy();
  return { username: accountUsername, recoveryCode: body.recoveryCode, token: token! };
}

function authHeaders(token: string, deviceId?: string) {
  return {
    authorization: `Bearer ${token}`,
    ...(deviceId ? { "x-device-id": deviceId } : {})
  };
}

describe("gateway", () => {
  it("reports health without exposing secrets", async () => {
    const response = await SELF.fetch("https://gateway.test/health");
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body).toEqual({ ok: true, service: "deepstudy-gateway", environment: "development" });
    expect(JSON.stringify(body)).not.toContain(env.GATEWAY_SECRET);
  });

  it("requires exact production Turnstile action and hostname", async () => {
    const results = [
      { success: true, hostname: "account.deepstudy.example" },
      { success: true, action: "register", hostname: "attacker.example" },
      { success: true, action: "register", hostname: "account.deepstudy.example" }
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify(results.shift()),
      { status: 200, headers: { "content-type": "application/json" } }
    ));
    const productionEnv = {
      ...env,
      ENVIRONMENT: "production",
      TURNSTILE_ALLOWED_HOSTNAMES: "account.deepstudy.example"
    } as Env;
    try {
      await expect(verifyTurnstile(productionEnv, "token-1", undefined, "register"))
        .resolves.toMatchObject({ ok: false, reason: "Turnstile action mismatch." });
      await expect(verifyTurnstile(productionEnv, "token-2", undefined, "register"))
        .resolves.toMatchObject({ ok: false, reason: "Turnstile hostname mismatch." });
      await expect(verifyTurnstile(productionEnv, "token-3", undefined, "register"))
        .resolves.toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("serves the desktop browser Turnstile page only for loopback callbacks", async () => {
    const ok = await SELF.fetch("https://gateway.test/v1/turnstile/desktop?action=sign-in&state=state-1&callback=http%3A%2F%2F127.0.0.1%3A49152%2Fcallback");
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(html).toContain(env.TURNSTILE_SITE_KEY);
    expect(html).toContain("http://127.0.0.1:49152/callback");
    expect(html).toContain("state-1");
    expect(html).toContain("sign-in");

    const badCallback = await SELF.fetch("https://gateway.test/v1/turnstile/desktop?action=sign-in&state=state-1&callback=https%3A%2F%2Fattacker.example%2Fcallback");
    expect(badCallback.status).toBe(400);

    const badAction = await SELF.fetch("https://gateway.test/v1/turnstile/desktop?action=delete-account&state=state-1&callback=http%3A%2F%2Flocalhost%3A49152%2Fcallback");
    expect(badAction.status).toBe(400);
  });

  it("keeps raw provider auth endpoints private", async () => {
    const directSignup = await SELF.fetch("https://gateway.test/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const directUsernameSignIn = await SELF.fetch("https://gateway.test/api/auth/sign-in/username", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const directPasswordChange = await SELF.fetch("https://gateway.test/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: PASSWORD })
    });
    expect(directSignup.status).toBe(404);
    expect(directUsernameSignIn.status).toBe(404);
    expect(directPasswordChange.status).toBe(404);
  });

  it("rejects oversized JSON before authentication work", async () => {
    const response = await jsonRequest("/v1/auth/register", {
      username: "oversized_user",
      password: PASSWORD,
      turnstileToken: "local-test-token",
      padding: "x".repeat(17_000)
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "REQUEST_TOO_LARGE", limitBytes: 16_384 });

    const encoder = new TextEncoder();
    const request = new Request("https://gateway.test/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`{"padding":"${"x".repeat(9_000)}`));
          controller.enqueue(encoder.encode(`${"x".repeat(9_000)}"}`));
          controller.close();
        }
      })
    });
    const streamed = await SELF.fetch(request);
    expect(streamed.status).toBe(413);
  });

  it("rate-limits repeated account actions by client IP", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await jsonRequest("/v1/auth/sign-in", {
        username: "missing_user",
        password: PASSWORD,
        turnstileToken: "local-test-token"
      }, { "cf-connecting-ip": "192.0.2.200" });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("registers, signs in, authenticates bearer sessions, and rotates recovery codes", async () => {
    const account = await register("auth");
    const session = await SELF.fetch("https://gateway.test/v1/auth/session", {
      headers: authHeaders(account.token)
    });
    expect(session.status).toBe(200);
    expect((await session.json<{ user: { username: string } }>()).user.username).toBe(account.username);

    const signedIn = await jsonRequest("/v1/auth/sign-in", {
      username: account.username,
      password: PASSWORD,
      turnstileToken: "local-test-token"
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-auth-token")).toBeTruthy();

    const newPassword = "new-correct-horse-battery-staple";
    const recovered = await jsonRequest("/v1/auth/recover", {
      username: account.username,
      recoveryCode: account.recoveryCode,
      newPassword,
      turnstileToken: "local-test-token"
    });
    expect(recovered.status).toBe(200);
    const rotated = await recovered.json<{ recoveryCode: string }>();
    expect(rotated.recoveryCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(rotated.recoveryCode).not.toBe(account.recoveryCode);

    const oldPassword = await jsonRequest("/v1/auth/sign-in", {
      username: account.username,
      password: PASSWORD,
      turnstileToken: "local-test-token"
    });
    const newPasswordLogin = await jsonRequest("/v1/auth/sign-in", {
      username: account.username,
      password: newPassword,
      turnstileToken: "local-test-token"
    });
    expect(oldPassword.status).toBe(401);
    expect(newPasswordLogin.status).toBe(200);

    const oldSession = await SELF.fetch("https://gateway.test/v1/auth/session", {
      headers: authHeaders(account.token)
    });
    expect(oldSession.status).toBe(401);
    const reusedRecoveryCode = await jsonRequest("/v1/auth/recover", {
      username: account.username,
      recoveryCode: account.recoveryCode,
      newPassword: "another-correct-horse-battery-staple",
      turnstileToken: "local-test-token"
    });
    expect(reusedRecoveryCode.status).toBe(401);

    const regenerated = await jsonRequest("/v1/auth/recovery/regenerate", {
      username: account.username,
      password: newPassword,
      turnstileToken: "local-test-token"
    });
    expect(regenerated.status).toBe(200);
    const regeneratedToken = regenerated.headers.get("set-auth-token");
    expect(regeneratedToken).toBeTruthy();
    const regeneratedBody = await regenerated.json<{ recoveryCode: string }>();
    expect(regeneratedBody.recoveryCode).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(regeneratedBody.recoveryCode).not.toBe(rotated.recoveryCode);

    const signedOut = await jsonRequest("/api/auth/sign-out", {}, authHeaders(regeneratedToken!));
    expect(signedOut.status).toBe(200);
    const signedOutSession = await SELF.fetch("https://gateway.test/v1/auth/session", {
      headers: authHeaders(regeneratedToken!)
    });
    expect(signedOutSession.status).toBe(401);
  });

  it("syncs records idempotently, records conflicts once, and requires explicit timer takeover", async () => {
    const account = await register("sync");
    const deviceA = "android-device-0001";
    const deviceB = "desktop-device-0002";
    const headersA = authHeaders(account.token, deviceA);
    const headersB = authHeaders(account.token, deviceB);
    expect((await jsonRequest("/v1/devices", { name: "Phone", platform: "android" }, headersA)).status).toBe(200);
    expect((await jsonRequest("/v1/devices", { name: "Desktop", platform: "windows" }, headersB)).status).toBe(200);

    const record = {
      entityType: "long_task",
      entityId: "legacy-long-1",
      payload: {
        title: "Legacy task",
        notes: "line one\nline two",
        plannedAt: "2026-07-23T09:30:00.000Z",
        unknownLegacyField: { keep: true }
      },
      deleted: false,
      revision: 0,
      clientUpdatedAt: "2026-07-22T12:00:00.000Z",
      serverUpdatedAt: null,
      deviceId: deviceA
    };
    const mutation = { mutationId: "mutation-legacy-long-0001", baseRevision: 0, record };
    const firstPush = await jsonRequest("/v1/sync/push", { mutations: [mutation] }, headersA);
    const duplicatePush = await jsonRequest("/v1/sync/push", { mutations: [mutation] }, headersA);
    expect(firstPush.status).toBe(200);
    expect(await duplicatePush.json()).toEqual(await firstPush.json());

    const staleMutation = {
      mutationId: "mutation-stale-long-0002",
      baseRevision: 0,
      record: { ...record, payload: { ...record.payload, title: "Stale edit" } }
    };
    const firstConflict = await jsonRequest("/v1/sync/push", { mutations: [staleMutation] }, headersA);
    const duplicateConflict = await jsonRequest("/v1/sync/push", { mutations: [staleMutation] }, headersA);
    const firstConflictBody = await firstConflict.json<Record<string, unknown>>();
    expect(await duplicateConflict.json()).toEqual(firstConflictBody);
    const conflicts = await SELF.fetch("https://gateway.test/v1/sync/conflicts", { headers: headersA });
    const openConflicts = (await conflicts.json<{
      conflicts: Array<{ id: string; remote: { revision: number } }>;
    }>()).conflicts;
    expect(openConflicts).toHaveLength(1);

    const pull = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0", { headers: headersA });
    const pulled = await pull.json<{ records: Array<typeof record & { revision: number }> }>();
    expect(pulled.records).toHaveLength(1);
    expect(pulled.records[0].payload).toEqual(record.payload);
    expect(pulled.records[0].revision).toBe(1);

    const otherRecord = { ...record, entityId: "another-long-task" };
    await jsonRequest("/v1/sync/push", {
      mutations: [{ mutationId: "mutation-other-record-0003", baseRevision: 0, record: otherRecord }]
    }, headersA);

    await env.DB.prepare(`
      UPDATE sync_conflicts SET status = 'resolving', resolved_at = ? WHERE id = ?
    `).bind(Date.now() - 600_000, openConflicts[0].id).run();
    const recoveredLease = await SELF.fetch("https://gateway.test/v1/sync/conflicts", { headers: headersA });
    expect((await recoveredLease.json<{ conflicts: unknown[] }>()).conflicts).toHaveLength(1);

    const reusedMutationId = await jsonRequest(`/v1/sync/conflicts/${openConflicts[0].id}/resolve`, {
      resolution: "keep_local",
      mutationId: "mutation-other-record-0003",
      expectedRemoteRevision: openConflicts[0].remote.revision
    }, headersA);
    expect(reusedMutationId.status).toBe(409);

    const keepLocalBody = {
      resolution: "keep_local",
      operationId: "operation-resolve-local-0001",
      mutationId: "mutation-resolve-local-0004",
      expectedRemoteRevision: openConflicts[0].remote.revision
    };
    const keepLocal = await jsonRequest(`/v1/sync/conflicts/${openConflicts[0].id}/resolve`, keepLocalBody, headersA);
    expect(keepLocal.status).toBe(200);
    const keepLocalRetry = await jsonRequest(
      `/v1/sync/conflicts/${openConflicts[0].id}/resolve`,
      keepLocalBody,
      headersA
    );
    expect(keepLocalRetry.status).toBe(200);
    expect(await keepLocalRetry.json()).toMatchObject({
      ok: true,
      conflictId: openConflicts[0].id,
      resolution: "keep_local",
      idempotent: true
    });
    const afterKeepLocal = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0", { headers: headersA });
    const keptLocalRecords = (await afterKeepLocal.json<{ records: Array<typeof record & { revision: number }> }>()).records;
    const keptLocal = keptLocalRecords.find((candidate) => candidate.entityId === record.entityId)!;
    expect(keptLocal.payload.title).toBe("Stale edit");
    expect(keptLocal.revision).toBe(2);

    const discardedMutation = {
      mutationId: "mutation-discarded-long-0004",
      baseRevision: 1,
      record: { ...record, payload: { ...record.payload, title: "Discard this edit" } }
    };
    await jsonRequest("/v1/sync/push", { mutations: [discardedMutation] }, headersA);
    const nextConflicts = await SELF.fetch("https://gateway.test/v1/sync/conflicts", { headers: headersA });
    const openAfterLocal = (await nextConflicts.json<{ conflicts: Array<{ id: string }> }>()).conflicts;
    expect(openAfterLocal).toHaveLength(1);
    const reusedResolutionOperation = await jsonRequest(
      `/v1/sync/conflicts/${openAfterLocal[0].id}/resolve`,
      { resolution: "keep_remote", operationId: "operation-resolve-local-0001" },
      headersA
    );
    expect(reusedResolutionOperation.status).toBe(409);
    expect(await reusedResolutionOperation.json()).toMatchObject({
      error: "CONFLICT_RESOLUTION_OPERATION_REUSED"
    });
    const keepRemoteBody = {
      resolution: "keep_remote",
      operationId: "operation-resolve-remote-0002"
    };
    const keepRemote = await jsonRequest(
      `/v1/sync/conflicts/${openAfterLocal[0].id}/resolve`,
      keepRemoteBody,
      headersA
    );
    expect(keepRemote.status).toBe(200);
    const keepRemoteRetry = await jsonRequest(
      `/v1/sync/conflicts/${openAfterLocal[0].id}/resolve`,
      keepRemoteBody,
      headersA
    );
    expect(keepRemoteRetry.status).toBe(200);
    expect(await keepRemoteRetry.json()).toMatchObject({
      ok: true,
      conflictId: openAfterLocal[0].id,
      resolution: "keep_remote",
      idempotent: true
    });
    await env.DB.prepare("DELETE FROM sync_conflicts WHERE id = ?")
      .bind(openAfterLocal[0].id).run();
    const keepRemoteAfterConflictCleanup = await jsonRequest(
      `/v1/sync/conflicts/${openAfterLocal[0].id}/resolve`,
      keepRemoteBody,
      headersA
    );
    expect(keepRemoteAfterConflictCleanup.status).toBe(200);
    expect(await keepRemoteAfterConflictCleanup.json()).toMatchObject({
      ok: true,
      conflictId: openAfterLocal[0].id,
      resolution: "keep_remote",
      idempotent: true
    });
    const noOpenConflicts = await SELF.fetch("https://gateway.test/v1/sync/conflicts", { headers: headersA });
    expect((await noOpenConflicts.json<{ conflicts: unknown[] }>()).conflicts).toHaveLength(0);

    const initialClaim = await jsonRequest("/v1/timer/claim", {
      mode: "focus",
      status: "running",
      expectedLeaseVersion: 0,
      remainingMs: 1_500_000,
      plannedMs: 1_500_000,
      accumulatedMs: 0,
      takeover: false
    }, headersA);
    expect(initialClaim.status).toBe(200);
    const denied = await jsonRequest("/v1/timer/claim", {
      mode: "rest",
      status: "running",
      expectedLeaseVersion: 1,
      remainingMs: 300_000,
      plannedMs: 300_000,
      accumulatedMs: 0,
      takeover: false
    }, headersB);
    expect(denied.status).toBe(409);
    expect((await denied.json<{ error: string }>()).error).toBe("TAKEOVER_CONFIRMATION_REQUIRED");
    const taken = await jsonRequest("/v1/timer/claim", {
      mode: "rest",
      status: "running",
      expectedLeaseVersion: 1,
      remainingMs: 300_000,
      plannedMs: 300_000,
      accumulatedMs: 0,
      takeover: true
    }, headersB);
    expect(taken.status).toBe(200);
    expect((await taken.json<{ timer: { ownerDeviceId: string; leaseVersion: number } }>()).timer)
      .toMatchObject({ ownerDeviceId: deviceB, leaseVersion: 2 });

    const invalidTimer = await jsonRequest("/v1/timer/claim", {
      mode: "focus",
      status: "running",
      expectedLeaseVersion: Number.MAX_SAFE_INTEGER + 1,
      remainingMs: 1_000,
      plannedMs: 1_000,
      accumulatedMs: 0,
      takeover: true
    }, headersB);
    expect(invalidTimer.status).toBe(400);

    const invalidCursor = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=Infinity", { headers: headersA });
    expect(invalidCursor.status).toBe(400);

    const firstPage = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0&limit=1", { headers: headersA });
    const firstPageBody = await firstPage.json<{ cursor: number; hasMore: boolean; records: unknown[] }>();
    expect(firstPageBody.records).toHaveLength(1);
    expect(firstPageBody.hasMore).toBe(true);
    const secondPage = await SELF.fetch(
      `https://gateway.test/v1/sync/pull?cursor=${firstPageBody.cursor}&limit=1`,
      { headers: headersA }
    );
    expect((await secondPage.json<{ cursor: number }>()).cursor).toBeGreaterThan(firstPageBody.cursor);
  });

  it("previews and commits a first import without losing legacy fields", async () => {
    const account = await register("import");
    const deviceId = "legacy-import-device-01";
    const headers = authHeaders(account.token, deviceId);
    expect((await jsonRequest("/v1/devices", { name: "Old desktop", platform: "windows" }, headers)).status).toBe(200);

    const cloudRecord = {
      entityType: "long_task",
      entityId: "shared-id",
      payload: { title: "Cloud title", notes: "cloud" },
      deleted: false,
      revision: 0,
      clientUpdatedAt: "2026-07-22T10:00:00.000Z",
      serverUpdatedAt: null,
      deviceId
    };
    await jsonRequest("/v1/sync/push", {
      mutations: [{ mutationId: "mutation-cloud-seed-0001", baseRevision: 0, record: cloudRecord }]
    }, headers);

    const localRecords = [
      {
        ...cloudRecord,
        payload: {
          title: "Legacy divergent title",
          notes: "first line\nsecond line",
          plannedAt: "2026-07-24T08:00:00.000Z",
          unknownLegacyField: ["keep", 42]
        }
      },
      {
        ...cloudRecord,
        entityId: "local-only",
        payload: { title: "Local only", notes: "preserve me", custom: { nested: true } }
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...cloudRecord,
        entityId: `local-only-${index + 2}`,
        payload: { title: `Local ${index + 2}`, notes: `legacy note ${index + 2}` }
      }))
    ];
    const hash = snapshotHash(localRecords);
    const previewResponse = await jsonRequest("/v1/imports/preview", {
      records: localRecords,
      snapshotHash: hash
    }, headers);
    expect(previewResponse.status).toBe(200);
    let preview = await previewResponse.json<{
      importId: string;
      status: string;
      nextIndex: number;
      totalItems: number;
      counts: { conflicts: number; additions: number };
    }>();
    expect(preview.counts).toMatchObject({ conflicts: 1, additions: 7 });
    expect(preview.totalItems).toBe(8);

    const firstCommit = await jsonRequest("/v1/imports/commit", {
      importId: preview.importId,
      expectedIndex: preview.nextIndex
    }, headers);
    expect(firstCommit.status).toBe(200);
    preview = await firstCommit.json<typeof preview>();
    expect(preview.status).toBe("applying");
    expect(preview.nextIndex).toBe(6);

    const staleCommit = await jsonRequest("/v1/imports/commit", {
      importId: preview.importId,
      expectedIndex: 0
    }, headers);
    expect(staleCommit.status).toBe(409);

    while (preview.status !== "committed") {
      const commit = await jsonRequest("/v1/imports/commit", {
        importId: preview.importId,
        expectedIndex: preview.nextIndex
      }, headers);
      expect(commit.status).toBe(200);
      preview = await commit.json<typeof preview>();
    }

    const repeatedPreview = await jsonRequest("/v1/imports/preview", {
      records: localRecords,
      snapshotHash: hash
    }, headers);
    const repeated = await repeatedPreview.json<typeof preview>();
    expect(repeated.importId).toBe(preview.importId);
    expect(repeated.status).toBe("committed");

    const changedRecords = localRecords.map((record, index) => index === 0
      ? { ...record, payload: { ...record.payload, notes: "changed after enrollment" } }
      : record);
    const changedPreview = await jsonRequest("/v1/imports/preview", {
      records: changedRecords,
      snapshotHash: snapshotHash(changedRecords)
    }, headers);
    expect(changedPreview.status).toBe(409);
    expect(await changedPreview.json()).toMatchObject({ error: "DEVICE_ALREADY_ENROLLED" });

    const pull = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0&limit=20", { headers });
    const records = (await pull.json<{ records: Array<Record<string, unknown>> }>()).records;
    expect(records).toHaveLength(9);
    const fork = records.find((record) => record.legacySourceId === "shared-id") as {
      payload: Record<string, unknown>;
    };
    expect(fork.payload).toEqual(localRecords[0].payload);
    expect(records.find((record) => record.entityId === "local-only")?.payload).toEqual(localRecords[1].payload);

    const secondDeviceId = "legacy-import-device-02";
    const secondHeaders = authHeaders(account.token, secondDeviceId);
    await jsonRequest("/v1/devices", { name: "Second old desktop", platform: "macos" }, secondHeaders);
    const secondDeviceRecords = localRecords.map((record) => ({ ...record, deviceId: secondDeviceId }));
    const secondPreviewResponse = await jsonRequest("/v1/imports/preview", {
      records: secondDeviceRecords,
      snapshotHash: snapshotHash(secondDeviceRecords)
    }, secondHeaders);
    expect(secondPreviewResponse.status).toBe(200);
    expect(await secondPreviewResponse.json()).toMatchObject({
      status: "committed",
      totalItems: 0,
      counts: { conflicts: 0, duplicates: 8, merged: 9 }
    });
    const secondPull = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0&limit=20", {
      headers: secondHeaders
    });
    expect((await secondPull.json<{ records: unknown[] }>()).records).toHaveLength(9);
  });

  it("requires a new preview when cloud data races an import commit", async () => {
    const account = await register("import_race");
    const importDevice = "import-race-device-01";
    const cloudDevice = "import-race-device-02";
    const importHeaders = authHeaders(account.token, importDevice);
    const cloudHeaders = authHeaders(account.token, cloudDevice);
    await jsonRequest("/v1/devices", { name: "Import source", platform: "windows" }, importHeaders);
    await jsonRequest("/v1/devices", { name: "Cloud writer", platform: "android" }, cloudHeaders);
    const localRecords = ["A", "B"].map((suffix) => ({
      entityType: "long_task",
      entityId: `racing-legacy-id-${suffix.toLowerCase()}`,
      payload: { title: `Legacy copy ${suffix}`, notes: `must survive ${suffix}` },
      deleted: false,
      revision: 0,
      clientUpdatedAt: Date.now(),
      serverUpdatedAt: null,
      deviceId: importDevice
    }));
    const hash = snapshotHash(localRecords);
    const initialPreviewResponse = await jsonRequest("/v1/imports/preview", {
      records: localRecords,
      snapshotHash: hash
    }, importHeaders);
    const initialPreview = await initialPreviewResponse.json<{ importId: string; nextIndex: number }>();

    await jsonRequest("/v1/sync/push", {
      mutations: localRecords.map((record, index) => ({
        mutationId: `import-race-cloud-000${index + 1}`,
        baseRevision: 0,
        record: {
          ...record,
          payload: { title: `Cloud copy ${index ? "B" : "A"}`, notes: `also keep ${index ? "B" : "A"}` },
          deviceId: cloudDevice
        }
      }))
    }, cloudHeaders);
    const blocked = await jsonRequest("/v1/imports/commit", {
      importId: initialPreview.importId,
      expectedIndex: initialPreview.nextIndex
    }, importHeaders);
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json<{ error: string; status: string; nextIndex: number }>();
    expect(blockedBody).toMatchObject({ error: "IMPORT_REPREVIEW_REQUIRED", status: "blocked" });

    const blockedRetry = await jsonRequest("/v1/imports/commit", {
      importId: initialPreview.importId,
      expectedIndex: blockedBody.nextIndex
    }, importHeaders);
    expect(blockedRetry.status).toBe(409);
    expect(await blockedRetry.json()).toMatchObject({
      error: "IMPORT_REPREVIEW_REQUIRED",
      status: "blocked",
      nextIndex: blockedBody.nextIndex
    });
    const importUser = await env.DB.prepare("SELECT id FROM user WHERE username = ?")
      .bind(account.username).first<{ id: string }>();
    const unresolvedImportConflicts = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM sync_conflicts
      WHERE status = 'open' AND user_id = ?
    `).bind(importUser!.id).first<{ count: number }>();
    expect(unresolvedImportConflicts?.count).toBe(0);

    const secondPreviewResponse = await jsonRequest("/v1/imports/preview", {
      records: localRecords,
      snapshotHash: hash
    }, importHeaders);
    expect(secondPreviewResponse.status).toBe(200);
    const secondPreview = await secondPreviewResponse.json<{
      importId: string;
      status: string;
      nextIndex: number;
      counts: { conflicts: number };
    }>();
    expect(secondPreview.importId).not.toBe(initialPreview.importId);
    expect(secondPreview.counts.conflicts).toBe(2);
    const committed = await jsonRequest("/v1/imports/commit", {
      importId: secondPreview.importId,
      expectedIndex: secondPreview.nextIndex
    }, importHeaders);
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ status: "committed" });

    const pull = await SELF.fetch("https://gateway.test/v1/sync/pull?cursor=0", { headers: importHeaders });
    const records = (await pull.json<{ records: Array<{ payload: { title: string; notes: string } }> }>()).records;
    expect(records.map((record) => record.payload.title).sort()).toEqual([
      "Cloud copy A",
      "Cloud copy B",
      "Legacy copy A",
      "Legacy copy B"
    ]);
    expect(records.find((record) => record.payload.title === "Legacy copy A")?.payload.notes)
      .toBe("must survive A");
  });

  it("blocks a near-limit import race without overflowing the D1 import summary row", async () => {
    const account = await register("large_import_race");
    const importDevice = "large-import-device-01";
    const cloudDevice = "large-import-device-02";
    const importHeaders = authHeaders(account.token, importDevice);
    const cloudHeaders = authHeaders(account.token, cloudDevice);
    await jsonRequest("/v1/devices", { name: "Large import", platform: "windows" }, importHeaders);
    await jsonRequest("/v1/devices", { name: "Large cloud writer", platform: "android" }, cloudHeaders);

    const localRecords = Array.from({ length: 5 }, (_, index) => ({
      entityType: "long_task",
      entityId: `large-race-${index}`,
      payload: { title: `Legacy ${index}`, notes: "L".repeat(165_000) },
      deleted: false,
      revision: 0,
      clientUpdatedAt: Date.now(),
      serverUpdatedAt: null,
      deviceId: importDevice
    }));
    expect(new TextEncoder().encode(JSON.stringify(localRecords)).byteLength).toBeLessThan(900_000);
    const previewResponse = await jsonRequest("/v1/imports/preview", {
      records: localRecords,
      snapshotHash: snapshotHash(localRecords)
    }, importHeaders);
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json<{ importId: string; nextIndex: number }>();

    for (const [index, record] of localRecords.entries()) {
      const cloudWrite = await jsonRequest("/v1/sync/push", {
        mutations: [{
          mutationId: `large-import-cloud-${index}`,
          baseRevision: 0,
          record: {
            ...record,
            payload: { title: `Cloud ${index}`, notes: "R".repeat(250_000) },
            deviceId: cloudDevice
          }
        }]
      }, cloudHeaders);
      expect(cloudWrite.status).toBe(200);
    }

    const blocked = await jsonRequest("/v1/imports/commit", {
      importId: preview.importId,
      expectedIndex: preview.nextIndex
    }, importHeaders);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: "IMPORT_REPREVIEW_REQUIRED",
      status: "blocked"
    });

    const importRow = await env.DB.prepare(`
      SELECT status, length(summary_json) AS summary_length
      FROM sync_imports WHERE id = ?
    `).bind(preview.importId).first<{ status: string; summary_length: number }>();
    expect(importRow?.status).toBe("blocked");
    expect(importRow?.summary_length).toBeLessThan(2_000_000);
    const user = await env.DB.prepare("SELECT id FROM user WHERE username = ?")
      .bind(account.username).first<{ id: string }>();
    const openConflicts = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM sync_conflicts WHERE user_id = ? AND status = 'open'
    `).bind(user!.id).first<{ count: number }>();
    expect(openConflicts?.count).toBe(0);
  });

  it("compacts bounded historical rows without deleting the latest record state", async () => {
    const account = await register("cleanup");
    const deviceId = "cleanup-device-0001";
    const headers = authHeaders(account.token, deviceId);
    await jsonRequest("/v1/devices", { name: "Cleanup test", platform: "android" }, headers);
    const baseRecord = {
      entityType: "reflection",
      entityId: "cleanup-reflection",
      payload: { notes: "first" },
      deleted: false,
      revision: 0,
      clientUpdatedAt: Date.now(),
      serverUpdatedAt: null,
      deviceId
    };
    await jsonRequest("/v1/sync/push", {
      mutations: [{ mutationId: "cleanup-mutation-0001", baseRevision: 0, record: baseRecord }]
    }, headers);
    await jsonRequest("/v1/sync/push", {
      mutations: [{
        mutationId: "cleanup-mutation-0002",
        baseRevision: 1,
        record: { ...baseRecord, revision: 1, payload: { notes: "latest" } }
      }]
    }, headers);
    const user = await env.DB.prepare("SELECT id FROM user WHERE username = ?")
      .bind(account.username).first<{ id: string }>();
    await cleanupGatewayData(env.DB, Date.now() + (100 * 24 * 60 * 60 * 1_000));
    const changes = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM sync_changes
      WHERE user_id = ? AND entity_type = 'reflection' AND entity_id = 'cleanup-reflection'
    `).bind(user!.id).first<{ count: number }>();
    const receipts = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM sync_mutations WHERE user_id = ?
    `).bind(user!.id).first<{ count: number }>();
    const stored = await env.DB.prepare(`
      SELECT payload FROM sync_records
      WHERE user_id = ? AND entity_type = 'reflection' AND entity_id = 'cleanup-reflection'
    `).bind(user!.id).first<{ payload: string }>();
    expect(changes?.count).toBe(1);
    expect(receipts?.count).toBe(2);
    expect(JSON.parse(stored!.payload)).toEqual({ notes: "latest" });
  });
});
