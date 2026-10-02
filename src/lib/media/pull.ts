import { createHmac, timingSafeEqual } from "node:crypto";
import { tokenKey } from "@/lib/publish/crypto";

/**
 * Signed, expiring pull URLs for publishing. TikTok (PULL_FROM_URL), Instagram
 * and Facebook fetch the MP4 themselves, so the rendered output must be
 * reachable without a session. The URL names one media asset, expires, and is
 * signed with a key derived from TOKEN_ENCRYPTION_KEY (required in production).
 * Only the dispatcher mints them, for the render the owner approved.
 */

export const PULL_TTL_S = 6 * 3600;

function pullKey(env: Record<string, string | undefined>): Buffer {
  return createHmac("sha256", tokenKey(env)).update("torq-pamba media pull v1").digest();
}

export function pullSignature(assetId: string, exp: number, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", pullKey(env)).update(`${assetId}.${exp}`).digest("base64url");
}

/** Absolute https pull URL, or null when PUBLIC_BASE_URL is not an https origin (platforms cannot reach it). */
export function publicPullUrl(
  assetId: string,
  options: { base?: string; now?: Date; ttlS?: number; env?: Record<string, string | undefined> } = {},
): string | null {
  const env = options.env ?? process.env;
  const base = (options.base ?? env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/i.test(base)) return null;
  const exp = Math.floor((options.now ?? new Date()).getTime() / 1000) + (options.ttlS ?? PULL_TTL_S);
  return `${base}/api/media/${assetId}/pull?exp=${exp}&sig=${pullSignature(assetId, exp, env)}`;
}

export function verifyPull(
  assetId: string,
  exp: string | null,
  sig: string | null,
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) < Math.floor(now.getTime() / 1000)) return false;
  const expected = Buffer.from(pullSignature(assetId, Number(exp), env));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
