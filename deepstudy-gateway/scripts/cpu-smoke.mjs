const baseURL = process.env.DEEPSTUDY_GATEWAY_URL;
const turnstileTokens = String(process.env.DEEPSTUDY_TURNSTILE_TOKENS ?? "")
  .split(/[\s,]+/)
  .map((token) => token.trim())
  .filter(Boolean);
const signInAttempts = Math.max(1, Number.parseInt(process.env.DEEPSTUDY_SIGN_IN_ATTEMPTS ?? "5", 10));
const requiredTokens = 2 + (signInAttempts * 2);

if (!baseURL || turnstileTokens.length < requiredTokens) {
  console.error(`Set DEEPSTUDY_GATEWAY_URL and at least ${requiredTokens} fresh, single-use tokens in DEEPSTUDY_TURNSTILE_TOKENS.`);
  process.exit(2);
}

const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
const username = `cpu_${suffix}`.slice(0, 30);
const password = `DeepStudy-${suffix}-Safe!`;
const replacementPassword = `DeepStudy-${suffix}-Rotated!`;
let tokenIndex = 0;

function nextTurnstileToken() {
  const token = turnstileTokens[tokenIndex];
  tokenIndex += 1;
  return token;
}

async function request(path, body) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "capacitor://localhost" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  const result = {
    path,
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    error: typeof payload.error === "string" ? payload.error : undefined
  };
  console.log(JSON.stringify(result));
  if (response.status !== 200) process.exit(1);
  return payload;
}

const signup = await request("/v1/auth/register", {
  username,
  password,
  turnstileToken: nextTurnstileToken()
});
if (typeof signup.recoveryCode !== "string") {
  console.error("Registration did not return a recovery code.");
  process.exit(1);
}

for (let attempt = 0; attempt < signInAttempts; attempt += 1) {
  await request("/v1/auth/sign-in", {
    username,
    password,
    turnstileToken: nextTurnstileToken()
  });
}

await request("/v1/auth/recover", {
  username,
  recoveryCode: signup.recoveryCode,
  newPassword: replacementPassword,
  turnstileToken: nextTurnstileToken()
});

for (let attempt = 0; attempt < signInAttempts; attempt += 1) {
  await request("/v1/auth/sign-in", {
    username,
    password: replacementPassword,
    turnstileToken: nextTurnstileToken()
  });
}
