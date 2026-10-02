import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { postAnalyticsSnapshots, publishAttempts, publishingConnections, videos } from "@/db/schema";
import { accessTokenOf, handleOf } from "@/lib/publish/accounts";
import { asPlatform, isPlatform, isPublishLive, type Platform } from "@/lib/publish/config";
import { facebookPublisher } from "@/lib/publish/live/facebook";
import { instagramPublisher } from "@/lib/publish/live/instagram";
import { tiktokPublisher } from "@/lib/publish/live/tiktok";
import { mockPublisher } from "@/lib/publish/mock";
import type { PostCounts, Publisher } from "@/lib/publish/types";

/**
 * Analytics from official APIs only: TikTok video query (view/like/comment/share
 * counts), Instagram media insights, and Facebook reel insights. Each refresh
 * stores a row in the foundation's post_analytics_snapshots so trends survive
 * token loss. Watch-time curves are not
 * available from these fields (parity gap, see REPORT.md).
 */

const LIVE: Record<Platform, Publisher> = { tiktok: tiktokPublisher, instagram: instagramPublisher, facebook: facebookPublisher };

function metricsSource(account: { mode: string; platform: Platform }, override?: Partial<Record<Platform, Publisher>>): Publisher | null {
  if (override?.[account.platform]) return override[account.platform] ?? null;
  if (account.mode !== "live") return mockPublisher(account.platform);
  return isPublishLive(account.platform) ? LIVE[account.platform] : null;
}

export async function refreshMetrics(
  workspaceId: string,
  options: { publishers?: Partial<Record<Platform, Publisher>> } = {},
): Promise<{ snapshots: number; skipped: number }> {
  const db = await getDb();
  const jobs = await db
    .select({
      id: publishAttempts.id,
      platform: publishAttempts.platform,
      externalId: publishAttempts.externalPostId,
      accountId: publishAttempts.connectionId,
      mode: publishAttempts.mode,
    })
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.workspaceId, workspaceId),
        eq(publishAttempts.status, "published"),
        isNotNull(publishAttempts.externalPostId),
      ),
    );
  // Drafts are not public posts, so they have no metrics yet. A disconnected
  // (deleted) connection or a platform with no publisher cannot be measured.
  const measurable = jobs.filter((job) => job.mode !== "draft" && job.accountId && isPlatform(job.platform));
  const byAccount = new Map<string, typeof measurable>();
  for (const job of measurable) byAccount.set(job.accountId!, [...(byAccount.get(job.accountId!) ?? []), job]);

  let snapshots = 0;
  let skipped = jobs.length - measurable.length;
  for (const [accountId, accountJobs] of byAccount) {
    const [account] = await db.select().from(publishingConnections).where(eq(publishingConnections.id, accountId)).limit(1);
    const source =
      account && !account.revokedAt && isPlatform(account.platform)
        ? metricsSource({ mode: account.mode, platform: account.platform }, options.publishers)
        : null;
    if (!account || !source) {
      skipped += accountJobs.length;
      continue;
    }
    const counts = await source.metrics({
      accessToken: accessTokenOf(account),
      accountExternalId: account.externalAccountId,
      externalIds: accountJobs.map((job) => job.externalId ?? ""),
    });
    const rows = accountJobs.flatMap((job) => {
      const found = counts[job.externalId ?? ""];
      return found ? [{ workspaceId, publishAttemptId: job.id, ...found }] : [];
    });
    skipped += accountJobs.length - rows.length;
    if (rows.length > 0) {
      await db.insert(postAnalyticsSnapshots).values(rows);
      snapshots += rows.length;
    }
  }
  return { snapshots, skipped };
}

export type PostRow = PostCounts & { jobId: string; platform: Platform; title: string; handle: string; fetchedAt: Date; engagementRate: number };

export function engagementRate(counts: Pick<PostCounts, "views" | "likes" | "comments" | "shares" | "saves">): number {
  if (counts.views <= 0) return 0;
  return Math.round(((counts.likes + counts.comments + counts.shares + counts.saves) / counts.views) * 10_000) / 100;
}

export async function workspaceAnalytics(workspaceId: string) {
  const db = await getDb();
  const snapshots = await db
    .select({
      jobId: postAnalyticsSnapshots.publishAttemptId,
      platform: publishAttempts.platform,
      views: postAnalyticsSnapshots.views,
      likes: postAnalyticsSnapshots.likes,
      comments: postAnalyticsSnapshots.comments,
      shares: postAnalyticsSnapshots.shares,
      saves: postAnalyticsSnapshots.saves,
      reach: postAnalyticsSnapshots.reach,
      fetchedAt: postAnalyticsSnapshots.capturedAt,
      title: videos.title,
      displayName: publishingConnections.displayName,
      externalAccountId: publishingConnections.externalAccountId,
    })
    .from(postAnalyticsSnapshots)
    .innerJoin(publishAttempts, eq(publishAttempts.id, postAnalyticsSnapshots.publishAttemptId))
    .innerJoin(videos, eq(videos.id, publishAttempts.videoId))
    .leftJoin(publishingConnections, eq(publishingConnections.id, publishAttempts.connectionId))
    .where(eq(postAnalyticsSnapshots.workspaceId, workspaceId))
    .orderBy(desc(postAnalyticsSnapshots.capturedAt));
  const rows = snapshots.flatMap(({ displayName, externalAccountId, platform, ...row }) =>
    isPlatform(platform)
      ? [
          {
            ...row,
            platform: asPlatform(platform),
            handle: externalAccountId ? handleOf({ displayName, externalAccountId }) : "(disconnected)",
            views: row.views ?? 0,
            likes: row.likes ?? 0,
            comments: row.comments ?? 0,
            shares: row.shares ?? 0,
            saves: row.saves ?? 0,
            reach: row.reach ?? 0,
          },
        ]
      : [],
  );
  const latest = new Map<string, PostRow>();
  for (const row of rows) {
    if (!latest.has(row.jobId)) latest.set(row.jobId, { ...row, engagementRate: engagementRate(row) });
  }
  const posts = [...latest.values()].sort((a, b) => b.views - a.views);
  const totals = posts.reduce(
    (sum, post) => ({
      views: sum.views + post.views,
      likes: sum.likes + post.likes,
      comments: sum.comments + post.comments,
      shares: sum.shares + post.shares,
      saves: sum.saves + post.saves,
      reach: sum.reach + post.reach,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0 },
  );
  return { posts, totals, engagementRate: engagementRate(totals) };
}
