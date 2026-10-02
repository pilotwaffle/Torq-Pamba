/** Small fetch helpers for official platform APIs. Errors carry the platform's message. */

export class PlatformApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
  }
}

async function read(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { raw: text };
  }
  const tiktokError = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const failed = !response.ok || (tiktokError?.code !== undefined && tiktokError.code !== "ok");
  if (failed) {
    const message = tiktokError?.message || tiktokError?.code || text.slice(0, 300) || `HTTP ${response.status}`;
    throw new PlatformApiError(String(message).slice(0, 300), response.status);
  }
  return body;
}

export async function platformJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; json?: unknown; form?: Record<string, string> } = {},
): Promise<unknown> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json; charset=UTF-8";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new PlatformApiError(error instanceof Error ? error.message : "network error", 0);
  }
  return read(response);
}
