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
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network", { retryable: true });
  }
  return readBody(providerId, response);
}

export async function getJson(providerId: string, url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network", { retryable: true });
  }
  return readBody(providerId, response);
}

/**
 * 400 / 422 and safety wording are refusals (the chain moves on). 408, 429 and
 * 5xx are retryable. Anything else (401, 403, 404) is a permanent failure.
 */
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
    if (response.status === 400 || response.status === 422 || /safety|refus|blocked|moderation/i.test(message)) {
      throw new ProviderRefusedError(providerId, message || "Provider refused the prompt");
    }
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new ProviderUnavailableError(providerId, message || `HTTP ${response.status}`, { retryable });
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
 * Poll a long-running job until `check` returns a value (not null), with
 * 5 s → 20 s exponential backoff and a 10 minute default budget. Clip jobs use
 * the async job runner (src/lib/jobs); this is for the publishers' status polls.
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

/** Nearest allowed value, preferring the larger one on a tie; the stitcher trims or pads to the scene length. */
export function nearestDuration(target: number, allowed: readonly number[]): number {
  let best = allowed[0] ?? target;
  for (const value of allowed) {
    if (Math.abs(value - target) < Math.abs(best - target) || (Math.abs(value - target) === Math.abs(best - target) && value > best)) {
      best = value;
    }
  }
  return best;
}

export function clampDuration(target: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(target)));
}
