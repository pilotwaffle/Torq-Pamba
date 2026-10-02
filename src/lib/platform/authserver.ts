import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { oauthClients, oauthCodes } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { hashSecret, issueOAuthTokens, rotateRefreshToken, validateCeiling, type Scope } from "./credentials";

/**
 * OAuth 2.1 authorization server for MCP clients: authorization-code grant with
 * PKCE S256 only, public clients (no client secret), dynamic client
 * registration (RFC 7591), metadata (RFC 8414) and protected-resource
 * metadata (RFC 9728). Refresh tokens rotate on every use.
 */

export const CODE_TTL_S = 600;
export const PENDING_COOKIE = "tp_oauth_pending";

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export function publicBase(request: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export function mcpResource(base: string): string {
  return `${base}/api/mcp`;
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth2/token`,
    registration_endpoint: `${base}/api/oauth2/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
    service_documentation: `${base}/docs/api`,
  };
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: mcpResource(base),
    authorization_servers: [base],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Torq-Pamba MCP",
  };
}

export function isAllowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export async function registerClient(body: unknown) {
  const input = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  if (uris.length === 0 || uris.length > 5) throw new OAuthError("invalid_redirect_uri", "Register 1 to 5 redirect_uris");
  const bad = uris.find((uri) => !isAllowedRedirect(uri));
  if (bad) throw new OAuthError("invalid_redirect_uri", `redirect_uri must be https (or http on localhost): ${bad.slice(0, 100)}`);
  const name = typeof input.client_name === "string" && input.client_name.trim() ? input.client_name.trim().slice(0, 80) : "MCP client";
  const clientId = `tpc_${randomBytes(12).toString("base64url")}`;
  const db = await getDb();
  await db.insert(oauthClients).values({ clientId, name, redirectUris: uris });
  return {
    client_id: clientId,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
}

export async function findClient(clientId: string) {
  const db = await getDb();
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  return row ?? null;
}

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scope: Scope;
  state: string;
  resource: string | null;
};

export function normalizeScope(raw: string | null | undefined): Scope | null {
  const parts = (raw ?? "read").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "read";
  if (parts.some((part) => part !== "read" && part !== "write")) return null;
  return parts.includes("write") ? "write" : "read";
}

/** Validates an authorization request. Errors before the redirect URI is trusted are never redirected. */
export async function validateAuthorizeRequest(params: URLSearchParams, base: string): Promise<AuthorizeRequest> {
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await findClient(clientId) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id");
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "response_type must be code");
  const challenge = params.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw new OAuthError("invalid_request", "code_challenge is required (PKCE)");
  if (params.get("code_challenge_method") !== "S256") throw new OAuthError("invalid_request", "code_challenge_method must be S256");
  const scope = normalizeScope(params.get("scope"));
  if (!scope) throw new OAuthError("invalid_scope", "scope must be read and/or write");
  const resource = params.get("resource");
  if (resource && resource !== mcpResource(base)) throw new OAuthError("invalid_target", "resource must be this server's MCP endpoint");
  return { clientId, clientName: client.name, redirectUri, codeChallenge: challenge, scope, state: (params.get("state") ?? "").slice(0, 500), resource };
}

export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

export async function createAuthorizationCode(input: {
  request: AuthorizeRequest;
  workspaceId: string;
  userId: string;
  scope: Scope;
  maxCredits: number | null;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const code = `tpz_${randomBytes(32).toString("base64url")}`;
  const db = await getDb();
  await db.insert(oauthCodes).values({
    codeHash: hashSecret(code),
    clientId: input.request.clientId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    redirectUri: input.request.redirectUri,
    codeChallenge: input.request.codeChallenge,
    scope: input.scope,
    maxCredits: validateCeiling(input.maxCredits),
    resource: input.request.resource,
    expiresAt: new Date(now.getTime() + CODE_TTL_S * 1000),
  });
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.userId,
    action: "oauth.authorized",
    data: { clientId: input.request.clientId, scope: input.scope, maxCredits: input.maxCredits },
  });
  return code;
}

export function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new OAuthError("invalid_grant", "code_verifier is missing or malformed");
  const db = await getDb();
  const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, hashSecret(input.code))).limit(1);
  if (!row || row.clientId !== input.clientId) throw new OAuthError("invalid_grant", "Unknown authorization code");
  if (row.usedAt) throw new OAuthError("invalid_grant", "Authorization code was already used");
  if (row.expiresAt.getTime() <= now.getTime()) throw new OAuthError("invalid_grant", "Authorization code expired");
  if (row.redirectUri !== input.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  if (s256(input.codeVerifier) !== row.codeChallenge) throw new OAuthError("invalid_grant", "PKCE verification failed");
  const [claimed] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.id, row.id), isNull(oauthCodes.usedAt)))
    .returning({ id: oauthCodes.id });
  if (!claimed) throw new OAuthError("invalid_grant", "Authorization code was already used");
  const [client] = await db.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.clientId, row.clientId)).limit(1);
  const tokens = await issueOAuthTokens({
    workspaceId: row.workspaceId,
    clientId: row.clientId,
    name: `OAuth: ${client?.name ?? row.clientId}`,
    scope: row.scope,
    maxCredits: row.maxCredits,
    actor: row.userId,
    now,
  });
  return { ...tokens, scope: row.scope };
}

function tokenJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", pragma: "no-cache" },
  });
}

async function formOrJson(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

export async function handleTokenRequest(request: Request): Promise<Response> {
  const params = await formOrJson(request);
  const grantType = params.get("grant_type");
  const clientId = params.get("client_id") ?? "";
  try {
    if (!clientId || !(await findClient(clientId))) throw new OAuthError("invalid_client", "Unknown client_id", 401);
    if (grantType === "authorization_code") {
      const tokens = await exchangeAuthorizationCode({
        code: params.get("code") ?? "",
        clientId,
        redirectUri: params.get("redirect_uri") ?? "",
        codeVerifier: params.get("code_verifier") ?? "",
      });
      return tokenJson(200, {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        refresh_token: tokens.refreshToken,
        scope: tokens.scope,
      });
    }
    if (grantType === "refresh_token") {
      const tokens = await rotateRefreshToken({ refreshToken: params.get("refresh_token") ?? "", clientId });
      if (!tokens) throw new OAuthError("invalid_grant", "Refresh token is invalid, expired, or already used");
      return tokenJson(200, { access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresIn, refresh_token: tokens.refreshToken });
    }
    throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  } catch (error) {
    if (error instanceof OAuthError) return tokenJson(error.status, { error: error.error, error_description: error.message });
    return tokenJson(500, { error: "server_error", error_description: "Something went wrong" });
  }
}
