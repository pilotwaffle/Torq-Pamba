import { extensionFor, MediaError, mediaMaxBytes, saveMedia } from "@/lib/media/storage";
import { ProviderRefusedError, ProviderUnavailableError } from "./types";

export function isLive(envKeys: string[]): boolean {
  if (process.env.PROVIDER_MODE !== "live") return false;
  if (process.env.NODE_ENV === "test") return false;
  return envKeys.every((key) => Boolean(process.env[key]?.trim()));
}

export async function postJson(
  providerId: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network");
  }
  return readBody(providerId, response);
}

export async function getJson(providerId: string, url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network");
  }
  return readBody(providerId, response);
}

async function readBody(providerId: string, response: Response): Promise<unknown> {
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = { raw: text };
    }
  }
  if (!response.ok) {
    const message = text.slice(0, 300);
    if (response.status === 400 || response.status === 422 || /safety|refus|blocked/i.test(message)) {
      throw new ProviderRefusedError(providerId, message || "Provider refused the prompt");
    }
    throw new ProviderUnavailableError(providerId, message || `HTTP ${response.status}`);
  }
  return json;
}

export type PollOptions = {
  /** First wait between polls. Default 5 s. */
  intervalMs?: number;
  /** Backoff ceiling. Default 20 s. */
  maxIntervalMs?: number;
  /** Give up after this long. Default PROVIDER_POLL_TIMEOUT_MS or 10 minutes. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export function pollTimeoutMs(): number {
  const raw = Number(process.env.PROVIDER_POLL_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
}

/**
 * Poll a long-running vendor job until `check` returns a value (not null).
 * Real Veo / Grok / Seedance jobs take tens of seconds to minutes, so the
 * default budget is 10 minutes with 5 s → 20 s exponential backoff.
 */
export async function pollUntil<T>(
  providerId: string,
  check: () => Promise<T | null>,
  options: PollOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? pollTimeoutMs();
  const maxInterval = options.maxIntervalMs ?? 20_000;
  let interval = options.intervalMs ?? 5_000;
  const started = now();
  for (;;) {
    const result = await check();
    if (result !== null) return result;
    const elapsed = now() - started;
    if (elapsed + interval > timeoutMs) {
      throw new ProviderUnavailableError(providerId, `timed out after ${Math.round(elapsed / 1000)}s`);
    }
    await sleep(interval);
    interval = Math.min(maxInterval, Math.round(interval * 1.5));
  }
}

/**
 * Download a finished clip from the vendor and store it. Returns the storage key.
 * Only https URLs are fetched; the body must be video/* and under MEDIA_MAX_BYTES.
 */
export async function downloadClip(
  providerId: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new ProviderUnavailableError(providerId, "output URL is not https");
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "download failed");
  }
  if (!response.ok) throw new ProviderUnavailableError(providerId, `download HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !/^(video\/|application\/octet-stream)/i.test(type)) {
    throw new ProviderUnavailableError(providerId, `download is ${type}, not video`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > mediaMaxBytes()) throw new ProviderUnavailableError(providerId, "download is too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    return await saveMedia(bytes, extensionFor(type));
  } catch (error) {
    if (error instanceof MediaError) throw new ProviderUnavailableError(providerId, error.message);
    throw error;
  }
}
