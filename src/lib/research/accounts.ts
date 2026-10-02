import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { inspirationAccounts, viralPosts, type InspirationAccount, type ViralPost } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { parseAccountInput } from "./handles";
import { isUuid, upsertPosts } from "./posts";
import { researchSource } from "./source";
import { ResearchError, type SocialPlatform } from "./types";

export const ACCOUNT_POST_LIMIT = 12;
const MAX_ACCOUNTS = 50;

export type AccountKind = "inspiration" | "competitor";

/** Adds (or un-archives) a tracked account from a handle or URL, then syncs its recent posts. */
export async function addAccount(input: {
  workspaceId: string;
  userId: string;
  input: string;
  platform?: SocialPlatform | null;
  kind?: AccountKind;
  notes?: string;
}): Promise<InspirationAccount> {
  const parsed = parseAccountInput(input.input, input.platform);
  const db = await getDb();
  const active = await db
    .select({ id: inspirationAccounts.id })
    .from(inspirationAccounts)
    .where(and(eq(inspirationAccounts.workspaceId, input.workspaceId), isNull(inspirationAccounts.archivedAt)));
  if (active.length >= MAX_ACCOUNTS) throw new ResearchError(`You can track up to ${MAX_ACCOUNTS} accounts`);

  const [row] = await db
    .insert(inspirationAccounts)
    .values({
      workspaceId: input.workspaceId,
      platform: parsed.platform,
      handle: parsed.handle,
      kind: input.kind ?? "inspiration",
      profileUrl: parsed.profileUrl,
      notes: input.notes?.trim().slice(0, 500) || null,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [inspirationAccounts.workspaceId, inspirationAccounts.platform, inspirationAccounts.handle],
      set: { archivedAt: null, kind: input.kind ?? "inspiration" },
    })
    .returning();
  if (!row) throw new ResearchError("Could not save the account");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.userId,
    action: "research.account_added",
    data: { platform: row.platform, handle: row.handle, kind: row.kind },
  });
  return syncAccount(input.workspaceId, row.id);
}

/**
 * Fetches the account's profile and recent posts from the source for its
 * platform. A source failure is stored on the account rather than thrown, so
 * the account stays listed with the reason.
 */
export async function syncAccount(workspaceId: string, accountId: string): Promise<InspirationAccount> {
  const account = await getAccount(workspaceId, accountId);
  if (!account) throw new ResearchError("That account is not tracked in this workspace");
  const db = await getDb();
  try {
    const source = researchSource(account.platform);
    const found = await source.lookupAccount({ platform: account.platform, handle: account.handle, limit: ACCOUNT_POST_LIMIT });
    await upsertPosts({ workspaceId, posts: found.posts, sourceId: source.id, sample: source.sample, accountId });
    const [row] = await db
      .update(inspirationAccounts)
      .set({
        displayName: found.account.displayName,
        profileUrl: found.account.profileUrl,
        followerCount: found.account.followerCount,
        lastSyncedAt: new Date(),
        syncError: null,
      })
      .where(and(eq(inspirationAccounts.id, accountId), eq(inspirationAccounts.workspaceId, workspaceId)))
      .returning();
    return row ?? account;
  } catch (error) {
    if (!(error instanceof ResearchError || error instanceof ProviderUnavailableError)) throw error;
    const [row] = await db
      .update(inspirationAccounts)
      .set({ syncError: error.message.slice(0, 300) })
      .where(and(eq(inspirationAccounts.id, accountId), eq(inspirationAccounts.workspaceId, workspaceId)))
      .returning();
    return row ?? account;
  }
}

export async function archiveAccount(workspaceId: string, userId: string, accountId: string): Promise<void> {
  if (!isUuid(accountId)) return;
  const db = await getDb();
  const [row] = await db
    .update(inspirationAccounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(inspirationAccounts.id, accountId), eq(inspirationAccounts.workspaceId, workspaceId)))
    .returning();
  if (row) {
    await writeAudit({
      workspaceId,
      actor: userId,
      action: "research.account_archived",
      data: { platform: row.platform, handle: row.handle },
    });
  }
}

export async function getAccount(workspaceId: string, accountId: string): Promise<InspirationAccount | null> {
  if (!isUuid(accountId)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(inspirationAccounts)
    .where(and(eq(inspirationAccounts.id, accountId), eq(inspirationAccounts.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function listAccounts(workspaceId: string): Promise<InspirationAccount[]> {
  const db = await getDb();
  return db
    .select()
    .from(inspirationAccounts)
    .where(and(eq(inspirationAccounts.workspaceId, workspaceId), isNull(inspirationAccounts.archivedAt)))
    .orderBy(asc(inspirationAccounts.kind), desc(inspirationAccounts.createdAt));
}

/** The account's stored posts, newest first. */
export async function accountPosts(workspaceId: string, accountId: string): Promise<ViralPost[]> {
  if (!isUuid(accountId)) return [];
  const db = await getDb();
  return db
    .select()
    .from(viralPosts)
    .where(and(eq(viralPosts.workspaceId, workspaceId), eq(viralPosts.accountId, accountId)))
    .orderBy(desc(viralPosts.postedAt))
    .limit(50);
}
