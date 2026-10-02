import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { postMetrics, publishJobs, socialAccounts, videos } from "@/db/schema";
import { accessTokenOf } from "@/lib/publish/accounts";
import { isPublishLive, type Platform } from "@/lib/publish/config";
import { facebookPublisher } from "@/lib/publish/live/facebook";
import { instagramPublisher } from "@/lib/publish/live/instagram";
import { tiktokPublisher } from "@/lib/publish/live/tiktok";
import { mockPublisher } from "@/lib/publish/mock";
import type { PostCounts, Publisher } from "@/lib/publish/types";

/**
 * Analytics from official APIs only: TikTok video query (view/like/comment/share
 * counts), Instagram media insights, and Facebook reel insights. Each refresh
 * stores a snapshot so trends survive token loss. Watch-time curves are not
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
      id: publishJobs.id,
      platform: publishJobs.platform,
      externalId: publishJobs.externalId,
      accountId: publishJobs.accountId,
      mode: publishJobs.mode,
    })
    .from(publishJobs)
    .where(and(eq(publishJobs.workspaceId, workspaceId), eq(publishJobs.status, "succeeded"), isNotNull(publishJobs.externalId)));
  // Drafts are not public posts, so they have no metrics yet.
  const measurable = jobs.filter((job) => job.mode !== "draft");
  const byAccount = new Map<string, typeof measurable>();
  for (const job of measurable) byAccount.set(job.accountId, [...(byAccount.get(job.accountId) ?? []), job]);

  let snapshots = 0;
  let skipped = jobs.length - measurable.length;
  for (const [accountId, accountJobs] of byAccount) {
    const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1);
    const source = account && !account.revokedAt ? metricsSource({ mode: account.mode, platform: account.platform }, options.publishers) : null;
    if (!account || !source) {
      skipped += accountJobs.length;
      continue;
    }
    const counts = await source.metrics({
      accessToken: accessTokenOf(account),
      accountExternalId: account.externalId,
      externalIds: accountJobs.map((job) => job.externalId ?? ""),
    });
    const rows = accountJobs.flatMap((job) => {
      const found = counts[job.externalId ?? ""];
      return found ? [{ workspaceId, jobId: job.id, platform: job.platform, ...found }] : [];
    });
    skipped += accountJobs.length - rows.length;
    if (rows.length > 0) {
      await db.insert(postMetrics).values(rows);
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
  const rows = await db
    .select({
      jobId: postMetrics.jobId,
      platform: postMetrics.platform,
      views: postMetrics.views,
      likes: postMetrics.likes,
      comments: postMetrics.comments,
      shares: postMetrics.shares,
      saves: postMetrics.saves,
      reach: postMetrics.reach,
      fetchedAt: postMetrics.fetchedAt,
      title: videos.title,
      handle: socialAccounts.handle,
    })
    .from(postMetrics)
    .innerJoin(publishJobs, eq(publishJobs.id, postMetrics.jobId))
    .innerJoin(videos, eq(videos.id, publishJobs.videoId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, publishJobs.accountId))
    .where(eq(postMetrics.workspaceId, workspaceId))
    .orderBy(desc(postMetrics.fetchedAt));
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
