const encoder = new TextEncoder();
const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function normalizeUsername(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function validateUsername(username: string): boolean {
  return /^[a-z0-9_.]{3,30}$/.test(username);
}

export async function internalEmailForUsername(username: string, pepper: string): Promise<string> {
  const digest = await hmacSha256Hex(pepper, `internal-email:${normalizeUsername(username)}`);
  return `${digest}@account.deepstudy.invalid`;
}

export function createRecoveryCode(byteLength = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const characters = Array.from(bytes, (byte) => BASE32[byte % BASE32.length]).join("");
  return characters.match(/.{1,4}/g)?.join("-") ?? characters;
}

export async function deriveRecoveryCode(
  userId: string,
  generation: number,
  pepper: string
): Promise<string> {
  if (!userId || !Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("A user ID and positive recovery generation are required.");
  }
  const digest = await hmacSha256Hex(pepper, `recovery-display:${userId}:${generation}`);
  const characters = Array.from({ length: 16 }, (_, index) => (
    BASE32[Number.parseInt(digest.slice(index * 2, (index * 2) + 2), 16) & 31]
  )).join("");
  return characters.match(/.{1,4}/g)?.join("-") ?? characters;
}

export function normalizeRecoveryCode(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export async function recoveryCodeDigest(code: string, pepper: string): Promise<string> {
  return hmacSha256Hex(pepper, `recovery-code:${normalizeRecoveryCode(code)}`);
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
