import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { publishingConnections, type PublishTarget, type PublishingConnection } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { isPlatform, isPublishLive, isValidMode, PLATFORM_LABEL, type Platform } from "./config";
import { openToken, sealToken, TOKEN_KEY_VERSION } from "./crypto";
import { exchangeFacebookCode } from "./live/facebook";
import { exchangeInstagramCode } from "./live/instagram";
import { exchangeTikTokCode } from "./live/tiktok";
import { authorizeUrl, pkcePair, redirectUri, signState, verifyState } from "./oauth";

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/** Accounts live in the foundation's `publishing_connections`. The display name is the handle. */
export function handleOf(connection: Pick<PublishingConnection, "displayName" | "externalAccountId">): string {
  return connection.displayName ?? connection.externalAccountId;
}

/** Active connections this phase can publish to (a reserved `youtube` row is skipped). */
export async function listAccounts(workspaceId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      id: publishingConnections.id,
      platform: publishingConnections.platform,
      displayName: publishingConnections.displayName,
      externalAccountId: publishingConnections.externalAccountId,
      mode: publishingConnections.mode,
      createdAt: publishingConnections.createdAt,
      expiresAt: publishingConnections.tokenExpiresAt,
    })
    .from(publishingConnections)
    .where(and(eq(publishingConnections.workspaceId, workspaceId), isNull(publishingConnections.revokedAt)))
    .orderBy(asc(publishingConnections.createdAt));
  return rows.flatMap(({ platform, displayName, externalAccountId, ...row }) =>
    isPlatform(platform) ? [{ ...row, platform, handle: handleOf({ displayName, externalAccountId }) }] : [],
  );
}

/** `granted.scopes` arrives as the platform's comma- or space-separated string. */
function scopeList(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean);
}

/** Mock connection for demos and tests. It never reaches a platform. */
export async function connectMockAccount(input: { workspaceId: string; platform: Platform; userId?: string | null; handle?: string }) {
  const db = await getDb();
  const [row] = await db
    .insert(publishingConnections)
    .values({
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalAccountId: `mock-${randomBytes(6).toString("hex")}`,
      displayName: input.handle ?? `@mock-${input.platform}`,
      mode: "mock",
      // Mock accounts hold no credential, so nothing needs sealing.
      accessTokenCiphertext: MOCK_TOKEN_MARKER,
      tokenKeyVersion: TOKEN_KEY_VERSION,
      scopes: ["mock"],
      status: "active",
      connectedBy: input.userId ?? null,
    })
    .returning();
  if (!row) throw new AccountError("Could not connect the account");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.userId ?? "user",
    action: "account.connected",
    data: { accountId: row.id, platform: input.platform, mode: "mock" },
  });
  return row;
}

export async function disconnectAccount(workspaceId: string, accountId: string, actor = "user") {
  const db = await getDb();
  const [row] = await db
    .update(publishingConnections)
    .set({
      revokedAt: new Date(),
      status: "revoked",
      accessTokenCiphertext: REVOKED_TOKEN_MARKER,
      refreshTokenCiphertext: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(publishingConnections.id, accountId),
        eq(publishingConnections.workspaceId, workspaceId),
        isNull(publishingConnections.revokedAt),
      ),
    )
    .returning({ id: publishingConnections.id, platform: publishingConnections.platform });
  if (!row) throw new AccountError("Account not found");
  await writeAudit({ workspaceId, actor, action: "account.disconnected", data: { accountId: row.id, platform: row.platform } });
}

export const MOCK_TOKEN_MARKER = "mock:no-credential";
export const REVOKED_TOKEN_MARKER = "revoked";

export function accessTokenOf(account: Pick<PublishingConnection, "accessTokenCiphertext" | "tokenKeyVersion">): string {
  if (account.accessTokenCiphertext === MOCK_TOKEN_MARKER) return "";
  if (account.accessTokenCiphertext === REVOKED_TOKEN_MARKER) throw new AccountError("This account was disconnected");
  if (account.tokenKeyVersion !== TOKEN_KEY_VERSION) {
    throw new AccountError("This account's token was sealed with a retired key. Reconnect the account.");
  }
  return openToken(account.accessTokenCiphertext);
}

/** Every target must be an active account of this workspace with a mode valid for its platform. */
export async function validateTargets(workspaceId: string, targets: PublishTarget[]): Promise<PublishTarget[]> {
  if (targets.length === 0) return [];
  const accounts = await listAccounts(workspaceId);
  const seen = new Set<string>();
  return targets.map((target) => {
    const account = accounts.find((entry) => entry.id === target.accountId);
    if (!account) throw new AccountError("Choose a connected account");
    if (seen.has(account.id)) throw new AccountError("Each account can be chosen once");
    seen.add(account.id);
    if (!isValidMode(account.platform, target.mode)) {
      throw new AccountError(`${PLATFORM_LABEL[account.platform]} does not support "${target.mode}"`);
    }
    return { accountId: account.id, mode: target.mode };
  });
}

export function beginOAuth(platform: Platform, workspaceId: string) {
  if (!isPublishLive(platform)) throw new AccountError(`${PLATFORM_LABEL[platform]} OAuth needs PUBLISH_MODE=live and app credentials.`);
  const { verifier, challenge } = pkcePair();
  const state = signState({ workspaceId, platform });
  return { url: authorizeUrl(platform, { state, challenge }), verifier };
}

export async function completeOAuth(
  platform: Platform,
  input: { code: string; state: string; verifier: string; userId: string; workspaceId: string },
) {
  if (!isPublishLive(platform)) throw new AccountError("PUBLISH_MODE is not live");
  const state = verifyState(input.state, { platform });
  if (state.workspaceId !== input.workspaceId) throw new AccountError("OAuth state belongs to another workspace");
  const redirect = redirectUri(platform);
  const granted =
    platform === "tiktok"
      ? await exchangeTikTokCode({ code: input.code, verifier: input.verifier, redirectUri: redirect })
      : platform === "instagram"
        ? await exchangeInstagramCode({ code: input.code, redirectUri: redirect })
        : await exchangeFacebookCode({ code: input.code, redirectUri: redirect });
  const db = await getDb();
  const values = {
    workspaceId: input.workspaceId,
    platform,
    externalAccountId: granted.externalId,
    displayName: granted.handle,
    mode: "live",
    accessTokenCiphertext: sealToken(granted.accessToken),
    refreshTokenCiphertext: granted.refreshToken ? sealToken(granted.refreshToken) : null,
    tokenKeyVersion: TOKEN_KEY_VERSION,
    scopes: scopeList(granted.scopes),
    tokenExpiresAt: granted.expiresAt,
    status: "active" as const,
    lastError: null,
    connectedBy: input.userId,
    revokedAt: null,
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select({ id: publishingConnections.id })
    .from(publishingConnections)
    .where(
      and(
        eq(publishingConnections.workspaceId, input.workspaceId),
        eq(publishingConnections.platform, platform),
        eq(publishingConnections.externalAccountId, granted.externalId),
      ),
    )
    .limit(1);
  const [row] = existing
    ? await db.update(publishingConnections).set(values).where(eq(publishingConnections.id, existing.id)).returning()
    : await db.insert(publishingConnections).values(values).returning();
  if (!row) throw new AccountError("Could not save the account");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.userId,
    action: "account.connected",
    data: { accountId: row.id, platform, mode: "live", scopes: granted.scopes },
  });
  return row;
}
