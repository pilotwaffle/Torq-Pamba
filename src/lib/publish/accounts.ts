import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { socialAccounts, type PublishTarget, type SocialAccount } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { isPublishLive, isValidMode, PLATFORM_LABEL, type Platform } from "./config";
import { openToken, sealToken } from "./crypto";
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

export async function listAccounts(workspaceId: string) {
  const db = await getDb();
  return db
    .select({
      id: socialAccounts.id,
      platform: socialAccounts.platform,
      handle: socialAccounts.handle,
      mode: socialAccounts.mode,
      createdAt: socialAccounts.createdAt,
      expiresAt: socialAccounts.expiresAt,
    })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, workspaceId), isNull(socialAccounts.revokedAt)))
    .orderBy(asc(socialAccounts.createdAt));
}

/** Mock connection for demos and tests. It never reaches a platform. */
export async function connectMockAccount(input: { workspaceId: string; platform: Platform; userId?: string | null; handle?: string }) {
  const db = await getDb();
  const [row] = await db
    .insert(socialAccounts)
    .values({
      workspaceId: input.workspaceId,
      platform: input.platform,
      externalId: `mock-${randomBytes(6).toString("hex")}`,
      handle: input.handle ?? `@mock-${input.platform}`,
      mode: "mock",
      // Mock accounts hold no credential, so nothing needs sealing.
      accessTokenEnc: MOCK_TOKEN_MARKER,
      scopes: "mock",
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
    .update(socialAccounts)
    .set({ revokedAt: new Date(), accessTokenEnc: REVOKED_TOKEN_MARKER, refreshTokenEnc: null })
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId), isNull(socialAccounts.revokedAt)))
    .returning({ id: socialAccounts.id, platform: socialAccounts.platform });
  if (!row) throw new AccountError("Account not found");
  await writeAudit({ workspaceId, actor, action: "account.disconnected", data: { accountId: row.id, platform: row.platform } });
}

export const MOCK_TOKEN_MARKER = "mock:no-credential";
export const REVOKED_TOKEN_MARKER = "revoked";

export function accessTokenOf(account: Pick<SocialAccount, "accessTokenEnc">): string {
  if (account.accessTokenEnc === MOCK_TOKEN_MARKER) return "";
  if (account.accessTokenEnc === REVOKED_TOKEN_MARKER) throw new AccountError("This account was disconnected");
  return openToken(account.accessTokenEnc);
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
    externalId: granted.externalId,
    handle: granted.handle,
    mode: "live",
    accessTokenEnc: sealToken(granted.accessToken),
    refreshTokenEnc: granted.refreshToken ? sealToken(granted.refreshToken) : null,
    scopes: granted.scopes,
    expiresAt: granted.expiresAt,
    connectedBy: input.userId,
    revokedAt: null,
  };
  const [existing] = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, input.workspaceId),
        eq(socialAccounts.platform, platform),
        eq(socialAccounts.externalId, granted.externalId),
      ),
    )
    .limit(1);
  const [row] = existing
    ? await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, existing.id)).returning()
    : await db.insert(socialAccounts).values(values).returning();
  if (!row) throw new AccountError("Could not save the account");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.userId,
    action: "account.connected",
    data: { accountId: row.id, platform, mode: "live", scopes: granted.scopes },
  });
  return row;
}
