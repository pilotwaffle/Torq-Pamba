import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { apiCredentials, apiRequests, type ApiCredential } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { roundCents } from "@/lib/pricing";

/**
 * Machine credentials for the REST API and the MCP server. Secrets are random
 * 256-bit values shown once; only their SHA-256 hash is stored (they are high
 * entropy, so a slow hash adds nothing). Prefixes make leaked keys greppable:
 * tpk_ = workspace API key, tpa_ = OAuth access token, tpr_ = OAuth refresh token.
 */

export type Scope = "read" | "write";
export type Principal = {
  credentialId: string;
  workspaceId: string;
  grantId: string;
  scope: Scope;
  kind: ApiCredential["kind"];
  spendCapUsd: number | null;
  clientId: string | null;
};

export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;
export const RATE_LIMIT_PER_MINUTE = 120;

const PREFIX: Record<ApiCredential["kind"], string> = { key: "tpk", oauth_access: "tpa", oauth_refresh: "tpr" };

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function mintSecret(kind: ApiCredential["kind"]): { secret: string; prefix: string } {
  const prefix = randomBytes(4).toString("hex");
  return { secret: `${PREFIX[kind]}_${prefix}_${randomBytes(32).toString("base64url")}`, prefix: `${PREFIX[kind]}_${prefix}` };
}

export function looksLikeSecret(value: string): boolean {
  return /^tp[kar]_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validateCap(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100_000) throw new CredentialError("Spending cap must be between $0 and $100,000");
  return roundCents(value);
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
  spendCapUsd?: number | null;
  actor: string;
}): Promise<{ key: string; credential: ApiCredential }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new CredentialError("Name the key (1-60 characters)");
  const cap = validateCap(input.spendCapUsd);
  const { secret, prefix } = mintSecret("key");
  const id = randomUUID();
  const db = await getDb();
  const [row] = await db
    .insert(apiCredentials)
    .values({
      id,
      workspaceId: input.workspaceId,
      kind: "key",
      name,
      prefix,
      secretHash: hashSecret(secret),
      scope: input.scope,
      grantId: id,
      spendCapUsd: cap,
      createdBy: input.actor,
    })
    .returning();
  if (!row) throw new CredentialError("Could not create the key");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "api_key.created",
    data: { credentialId: row.id, prefix, scope: input.scope, spendCapUsd: cap },
  });
  return { key: secret, credential: row };
}

export async function issueOAuthTokens(input: {
  workspaceId: string;
  clientId: string;
  /** Shown on the settings page; defaults to the client id. */
  name?: string;
  scope: Scope;
  spendCapUsd: number | null;
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
    scope: input.scope,
    grantId,
    clientId: input.clientId,
    spendCapUsd: input.spendCapUsd,
    createdBy: input.actor,
  };
  await db.insert(apiCredentials).values([
    {
      ...base,
      kind: "oauth_access",
      prefix: access.prefix,
      secretHash: hashSecret(access.secret),
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
    },
    {
      ...base,
      kind: "oauth_refresh",
      prefix: refresh.prefix,
      secretHash: hashSecret(refresh.secret),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
    },
  ]);
  return { accessToken: access.secret, refreshToken: refresh.secret, expiresIn: ACCESS_TOKEN_TTL_S, grantId };
}

async function findActive(secret: string, kinds: ApiCredential["kind"][], now: Date): Promise<ApiCredential | null> {
  if (!looksLikeSecret(secret)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(apiCredentials)
    .where(and(eq(apiCredentials.secretHash, hashSecret(secret)), inArray(apiCredentials.kind, kinds), isNull(apiCredentials.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

function principalOf(row: ApiCredential): Principal {
  return {
    credentialId: row.id,
    workspaceId: row.workspaceId,
    grantId: row.grantId,
    scope: row.scope,
    kind: row.kind,
    spendCapUsd: row.spendCapUsd === null ? null : Number(row.spendCapUsd),
    clientId: row.clientId,
  };
}

/** Resolves an API key or OAuth access token. Refresh tokens never authenticate a call. */
export async function authenticate(secret: string, now = new Date()): Promise<Principal | null> {
  const row = await findActive(secret.trim(), ["key", "oauth_access"], now);
  if (!row) return null;
  const db = await getDb();
  await db.update(apiCredentials).set({ lastUsedAt: now }).where(eq(apiCredentials.id, row.id));
  return principalOf(row);
}

/** Rotates a refresh token: the old pair is revoked and a new pair is issued on the same grant. */
export async function rotateRefreshToken(input: { refreshToken: string; clientId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const row = await findActive(input.refreshToken.trim(), ["oauth_refresh"], now);
  if (!row || row.clientId !== input.clientId) return null;
  const db = await getDb();
  await db
    .update(apiCredentials)
    .set({ revokedAt: now })
    .where(and(eq(apiCredentials.grantId, row.grantId), isNull(apiCredentials.revokedAt)));
  return issueOAuthTokens({
    workspaceId: row.workspaceId,
    clientId: input.clientId,
    name: row.name,
    scope: row.scope,
    spendCapUsd: row.spendCapUsd === null ? null : Number(row.spendCapUsd),
    grantId: row.grantId,
    actor: row.createdBy,
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
    .from(apiCredentials)
    .where(and(eq(apiCredentials.id, credentialId), eq(apiCredentials.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new CredentialError("Key not found");
  await db
    .update(apiCredentials)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiCredentials.grantId, row.grantId), isNull(apiCredentials.revokedAt)));
  await writeAudit({ workspaceId, actor, action: "api_key.revoked", data: { credentialId, grantId: row.grantId } });
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
    .from(apiCredentials)
    .where(and(eq(apiCredentials.workspaceId, workspaceId), inArray(apiCredentials.kind, ["key", "oauth_access"])))
    .orderBy(desc(apiCredentials.createdAt));
  const byGrant = new Map<string, ApiCredential>();
  for (const row of rows) if (!byGrant.has(row.grantId)) byGrant.set(row.grantId, row);
  const out = [];
  for (const row of byGrant.values()) {
    out.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope,
      spendCapUsd: row.spendCapUsd === null ? null : Number(row.spendCapUsd),
      spentUsd: await grantSpendUsd(row.grantId),
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    });
  }
  return out;
}
