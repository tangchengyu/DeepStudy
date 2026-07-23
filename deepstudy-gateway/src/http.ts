import type { Context } from "hono";

const DEFAULT_JSON_LIMIT_BYTES = 16 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonObject(
  c: Context,
  limitBytes = DEFAULT_JSON_LIMIT_BYTES
): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(c.req.header("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    await c.req.raw.body?.cancel().catch(() => undefined);
    throw new RequestBodyTooLargeError(limitBytes);
  }

  try {
    const reader = c.req.raw.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(limitBytes);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return null;
  }
}

export function clientIp(c: Context): string | undefined {
  return c.req.header("cf-connecting-ip") || undefined;
}

export function copyResponseWithJson(response: Response, payload: unknown): Response {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status: response.status, headers });
}

export async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.clone().json<unknown>();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
