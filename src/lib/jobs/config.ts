function envMs(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** How long one clip job may run before it times out and the chain moves on. `VIDEO_JOB_TIMEOUT_MS`, default 20 min. */
export function clipDeadlineMs(): number {
  return envMs("VIDEO_JOB_TIMEOUT_MS", 20 * 60_000);
}

/** How long Generate waits for the jobs before returning "still generating". `VIDEO_INLINE_WAIT_MS`, default 45 s. */
export function inlineWaitMs(): number {
  return envMs("VIDEO_INLINE_WAIT_MS", 45_000);
}

/** Submits retried after a network error, 408, 429 or 5xx before the chain moves on. */
export const MAX_SUBMIT_RETRIES = 3;
/** Consecutive failed polls or downloads before a job is given up. */
export const MAX_POLL_ERRORS = 5;
/** Render attempts before the video falls back to the slideshow. */
export const MAX_RENDER_ATTEMPTS = 3;

/** First poll 5 s after submit, then backing off ×1.5 to at most 30 s. Runway asks for ≥ 5 s between polls. */
export function pollDelayMs(pollCount: number): number {
  return Math.min(30_000, Math.round(5_000 * 1.5 ** Math.max(0, pollCount)));
}

/** 2 s, 4 s, 8 s ... capped at 60 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));
}

/** A claimed job is skipped by other workers for this long. */
export const CLAIM_LEASE_MS = 5 * 60_000;
