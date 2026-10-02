import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { graphVersion, type Platform } from "./config";

/**
 * Official OAuth only: TikTok Login Kit, Instagram Business Login, and
 * Facebook Login for Business. No passwords are ever collected.
 */

export const OAUTH_SCOPES: Record<Platform, string[]> = {
  tiktok: ["user.info.basic", "video.publish", "video.upload", "video.list"],
  instagram: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"],
  facebook: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights", "business_management"],
};

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

function stateSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.OAUTH_STATE_SECRET?.trim() ?? "";
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new OAuthStateError("OAUTH_STATE_SECRET is not set.");
  return "torq-pamba-dev-only-oauth-state";
}

export type OAuthState = { workspaceId: string; platform: Platform; nonce: string; exp: number };

export function signState(
  input: { workspaceId: string; platform: Platform; nowMs?: number; ttlMs?: number },
  env: Record<string, string | undefined> = process.env,
): string {
  const payload: OAuthState = {
    workspaceId: input.workspaceId,
    platform: input.platform,
    nonce: randomBytes(12).toString("base64url"),
    exp: (input.nowMs ?? Date.now()) + (input.ttlMs ?? 10 * 60_000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(
  value: string,
  expected: { platform: Platform; nowMs?: number },
  env: Record<string, string | undefined> = process.env,
): OAuthState {
  const [body, sig] = value.split(".");
  if (!body || !sig) throw new OAuthStateError("Malformed OAuth state");
  const want = createHmac("sha256", stateSecret(env)).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new OAuthStateError("OAuth state signature mismatch");
  const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  if (state.platform !== expected.platform) throw new OAuthStateError("OAuth state is for another platform");
  if (state.exp < (expected.nowMs ?? Date.now())) throw new OAuthStateError("OAuth state expired");
  return state;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function redirectUri(platform: Platform, env: Record<string, string | undefined> = process.env): string {
  const base = (env.PUBLIC_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/oauth/${platform}/callback`;
}

export function authorizeUrl(
  platform: Platform,
  input: { state: string; challenge: string },
  env: Record<string, string | undefined> = process.env,
): string {
  const redirect = redirectUri(platform, env);
  if (platform === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY?.trim() ?? "");
    url.searchParams.set("scope", OAUTH_SCOPES.tiktok.join(","));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }
  if (platform === "instagram") {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", env.INSTAGRAM_APP_ID?.trim() ?? "");
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", OAUTH_SCOPES.instagram.join(","));
    url.searchParams.set("state", input.state);
    return url.toString();
  }
  const url = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`);
  url.searchParams.set("client_id", env.META_APP_ID?.trim() ?? "");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES.facebook.join(","));
  url.searchParams.set("state", input.state);
  return url.toString();
}
