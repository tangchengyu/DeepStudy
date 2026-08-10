interface TurnstileResult {
  success: boolean;
  "error-codes"?: string[];
  action?: string;
  hostname?: string;
}

export async function verifyTurnstile(
  env: Env,
  token: unknown,
  remoteIp: string | undefined,
  expectedAction: string | string[]
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const value = String(token ?? "").trim();
  if (env.ENVIRONMENT !== "production" && value === "local-test-token") return { ok: true };
  if (!value || !env.TURNSTILE_SECRET_KEY) return { ok: false, reason: "Turnstile verification is required." };

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", value);
  form.set("idempotency_key", crypto.randomUUID());
  if (remoteIp) form.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  if (!response.ok) return { ok: false, reason: "Turnstile verification service is unavailable." };
  const result = await response.json<TurnstileResult>();
  if (!result.success) return { ok: false, reason: result["error-codes"]?.join(", ") || "Turnstile rejected the request." };
  const expectedActions = Array.isArray(expectedAction) ? expectedAction : [expectedAction];
  if (env.ENVIRONMENT === "production") {
    if (!expectedActions.includes(result.action || "")) return { ok: false, reason: "Turnstile action mismatch." };
    const allowedHostnames = env.TURNSTILE_ALLOWED_HOSTNAMES
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean);
    if (!result.hostname || !allowedHostnames.includes(result.hostname.toLowerCase())) {
      return { ok: false, reason: "Turnstile hostname mismatch." };
    }
  } else if (result.action && !expectedActions.includes(result.action)) {
    return { ok: false, reason: "Turnstile action mismatch." };
  }
  return { ok: true };
}
