import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { apiKeys, apiRequests, type ApiKey } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { roundCents } from "@/lib/pricing";

/**
 * Machine credentials for the REST API and the MCP server, stored in the
 * foundation's `api_keys`. Secrets are random 256-bit values shown once; only
 * their SHA-256 hash is stored (they are high entropy, so a slow hash adds
 * nothing), plus a display prefix. Prefixes make leaked keys greppable:
 * tpk_ = workspace API key, tpa_ = OAuth access token, tpr_ = OAuth refresh token.
 *
 * Scope is stored as `scopes` plus the `read_only` flag; the monthly spending
 * ceiling is `max_credits`, counted per grant (a key is its own grant; an
 * OAuth grant's rotating tokens share `grant_id`).
 */

export type Scope = "read" | "write";
export type CredentialKind = ApiKey["kind"];
export type Principal = {
  credentialId: string;
  workspaceId: string;
  grantId: string;
  scope: Scope;
  kind: CredentialKind;
  /** Monthly credit ceiling for this key or grant. Null = workspace budget only. */
  maxCredits: number | null;
  clientId: string | null;
};

/**
 * $0.01 per credit, the rate feat/v2-credits uses. This base has no credit
 * ledger yet, so a generation through the API counts its USD cost at this rate
 * against `api_keys.max_credits`. Switch to the ledger's charged credits when
 * the credits branch lands.
 */
export const USD_PER_CREDIT = 0.01;
export const MAX_CREDIT_CEILING = 10_000_000;

export function creditsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(Number((usd / USD_PER_CREDIT).toFixed(6)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `api_keys.created_by` references users; system actors are kept in the audit log only. */
function creatorOf(actor: string): string | null {
  return UUID.test(actor) ? actor : null;
}

export function scopesFor(scope: Scope): { scopes: string[]; readOnly: boolean } {
  return scope === "write" ? { scopes: ["read", "write"], readOnly: false } : { scopes: ["read"], readOnly: true };
}

/** Fails closed: anything but an explicit, non-read-only write scope is read. */
export function scopeOf(row: Pick<ApiKey, "scopes" | "readOnly">): Scope {
  return !row.readOnly && row.scopes.includes("write") ? "write" : "read";
}

export function grantOf(row: Pick<ApiKey, "id" | "grantId">): string {
  return row.grantId ?? row.id;
}

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;
export const RATE_LIMIT_PER_MINUTE = 120;

const PREFIX: Record<CredentialKind, string> = { key: "tpk", oauth_access: "tpa", oauth_refresh: "tpr" };

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function mintSecret(kind: CredentialKind): { secret: string; prefix: string } {
  const prefix = randomBytes(4).toString("hex");
  return { secret: `${PREFIX[kind]}_${prefix}_${randomBytes(32).toString("base64url")}`, prefix: `${PREFIX[kind]}_${prefix}` };
}

export function looksLikeSecret(value: string): boolean {
  return /^tp[kar]_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validateCeiling(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_CREDIT_CEILING) {
    throw new CredentialError(`Credit ceiling must be a whole number from 0 to ${MAX_CREDIT_CEILING.toLocaleString("en-US")}`);
  }
  return value;
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export async function createApiKey(input: {
  workspaceId: string;
  name: string;
  scope: Scope;
  maxCredits?: number | null;
  actor: string;
}): Promise<{ key: string; credential: ApiKey & { grantId: string } }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new CredentialError("Name the key (1-60 characters)");
  const ceiling = validateCeiling(input.maxCredits);
  const { secret, prefix } = mintSecret("key");
  const id = randomUUID();
  const db = await getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({
      id,
      workspaceId: input.workspaceId,
      kind: "key",
      name,
      prefix,
      keyHash: hashSecret(secret),
      ...scopesFor(input.scope),
      grantId: id,
      maxCredits: ceiling,
      createdBy: creatorOf(input.actor),
    })
    .returning();
  if (!row) throw new CredentialError("Could not create the key");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "api_key.created",
    data: { credentialId: row.id, prefix, scope: input.scope, maxCredits: ceiling },
  });
  return { key: secret, credential: { ...row, grantId: grantOf(row) } };
}

export async function issueOAuthTokens(input: {
  workspaceId: string;
  clientId: string;
  /** Shown on the settings page; defaults to the client id. */
  name?: string;
  scope: Scope;
  maxCredits: number | null;
  grantId?: string;
  actor: string;
  now?: Date;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; grantId: string }> {
  const now = input.now ?? new Date();
  const grantId = input.grantId ?? randomUUID();
  const access = mintSecret("oauth_access");
  const refresh = mintSecret("oauth_refresh");
  const db = await getDb();
  const base = {
    workspaceId: input.workspaceId,
    name: input.name ?? `OAuth: ${input.clientId}`,
    ...scopesFor(input.scope),
    grantId,
    clientId: input.clientId,
    maxCredits: validateCeiling(input.maxCredits),
    createdBy: creatorOf(input.actor),
  };
  await db.insert(apiKeys).values([
    {
      ...base,
      kind: "oauth_access",
      prefix: access.prefix,
      keyHash: hashSecret(access.secret),
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
    },
    {
      ...base,
      kind: "oauth_refresh",
      prefix: refresh.prefix,
      keyHash: hashSecret(refresh.secret),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
    },
  ]);
  return { accessToken: access.secret, refreshToken: refresh.secret, expiresIn: ACCESS_TOKEN_TTL_S, grantId };
}

async function findActive(secret: string, kinds: CredentialKind[], now: Date): Promise<ApiKey | null> {
  if (!looksLikeSecret(secret)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashSecret(secret)), inArray(apiKeys.kind, kinds), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

function principalOf(row: ApiKey): Principal {
  return {
    credentialId: row.id,
    workspaceId: row.workspaceId,
    grantId: grantOf(row),
    scope: scopeOf(row),
    kind: row.kind,
    maxCredits: row.maxCredits,
    clientId: row.clientId,
  };
}

/** Resolves an API key or OAuth access token. Refresh tokens never authenticate a call. */
export async function authenticate(secret: string, now = new Date()): Promise<Principal | null> {
  const row = await findActive(secret.trim(), ["key", "oauth_access"], now);
  if (!row) return null;
  const db = await getDb();
  await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  return principalOf(row);
}

/** Rotates a refresh token: the old pair is revoked and a new pair is issued on the same grant. */
export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const row = await findActive(input.refreshToken.trim(), ["oauth_refresh"], now);
  if (!row || row.clientId !== input.clientId) return null;
  const grantId = grantOf(row);
  const db = await getDb();
  await db
    .update(apiKeys)
    .set({ revokedAt: now })
    .where(and(or(eq(apiKeys.id, grantId), eq(apiKeys.grantId, grantId)), isNull(apiKeys.revokedAt)));
  return issueOAuthTokens({
    workspaceId: row.workspaceId,
    clientId: input.clientId,
    name: row.name,
    scope: scopeOf(row),
    maxCredits: row.maxCredits,
    grantId,
    actor: row.createdBy ?? "oauth",
    now,
  });
}

export function bearerFrom(headers: Headers): string {
  const key = headers.get("x-api-key")?.trim();
  if (key) return key;
  const auth = headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? "";
}

export async function revokeGrant(workspaceId: string, credentialId: string, actor: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, credentialId), eq(apiKeys.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new CredentialError("Key not found");
  const grantId = grantOf(row);
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.workspaceId, workspaceId), or(eq(apiKeys.id, grantId), eq(apiKeys.grantId, grantId)), isNull(apiKeys.revokedAt)));
  await writeAudit({ workspaceId, actor, action: "api_key.revoked", data: { credentialId, grantId } });
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function grantSpendUsd(grantId: string, now = new Date()): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${apiRequests.costUsd}), 0)` })
    .from(apiRequests)
    .where(and(eq(apiRequests.grantId, grantId), gte(apiRequests.createdAt, monthStartUtc(now))));
  return roundCents(Number(row?.total ?? 0));
}

/** Credits used this calendar month (UTC) by one key or OAuth grant: what `max_credits` caps. */
export async function grantSpendCredits(grantId: string, now = new Date()): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${apiRequests.credits}), 0)` })
    .from(apiRequests)
    .where(and(eq(apiRequests.grantId, grantId), gte(apiRequests.createdAt, monthStartUtc(now))));
  return Number(row?.total ?? 0);
}

export async function recordRequest(input: {
  principal: Principal;
  surface: "rest" | "mcp";
  operation: string;
  status: number;
  costUsd?: number;
}) {
  const db = await getDb();
  await db.insert(apiRequests).values({
    workspaceId: input.principal.workspaceId,
    grantId: input.principal.grantId,
    surface: input.surface,
    operation: input.operation.slice(0, 80),
    status: input.status,
    costUsd: input.costUsd ?? 0,
    credits: creditsForUsd(input.costUsd ?? 0),
  });
}

export async function rateLimited(grantId: string, now = new Date(), limit = RATE_LIMIT_PER_MINUTE): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(apiRequests)
    .where(and(eq(apiRequests.grantId, grantId), gte(apiRequests.createdAt, new Date(now.getTime() - 60_000))));
  return Number(row?.count ?? 0) >= limit;
}

/** Keys and OAuth grants for the settings page, one row per grant, with this month's spend. */
export async function listCredentials(workspaceId: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.workspaceId, workspaceId), inArray(apiKeys.kind, ["key", "oauth_access"])))
    .orderBy(desc(apiKeys.createdAt));
  const byGrant = new Map<string, ApiKey>();
  for (const row of rows) if (!byGrant.has(grantOf(row))) byGrant.set(grantOf(row), row);
  const out = [];
  for (const [grantId, row] of byGrant) {
    out.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      prefix: row.prefix,
      scope: scopeOf(row),
      maxCredits: row.maxCredits,
      spentCredits: await grantSpendCredits(grantId),
      spentUsd: await grantSpendUsd(grantId),
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    });
  }
  return out;
}
