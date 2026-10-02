import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { viralPosts, type BrandBrief, type ViralPost } from "@/db/schema";
import { DEFAULT_NICHE, FIXTURE_NICHES } from "./fixtures";
import { engagementRate, extractHook, outlierScores, whyItWorked } from "./metrics";
import { researchSource } from "./source";
import type { SocialPlatform, SourcePost } from "./types";

/** What research stores in `viral_posts.data`. */
export type PostData = {
  niche?: string;
  hashtags?: string[];
  sound?: string | null;
  notes?: string[];
  engagementPct?: number;
  source?: string;
  sample?: boolean;
};

export function postData(post: Pick<ViralPost, "data">): PostData {
  return (post.data ?? {}) as PostData;
}

/** The brief's niche, or the first sample niche when the brief has none yet. */
export function workspaceNiche(brief: BrandBrief | null | undefined): string {
  return brief?.niche?.trim() || DEFAULT_NICHE.label;
}

/**
 * Upserts posts for one workspace, scoring each against the batch median and
 * writing why-it-worked notes. Metrics refresh on conflict; an existing
 * account link and niche are kept when the new batch has none.
 */
export async function upsertPosts(input: {
  workspaceId: string;
  posts: SourcePost[];
  sourceId: string;
  sample: boolean;
  accountId?: string | null;
  niche?: string | null;
}): Promise<number> {
  // One statement cannot upsert the same row twice, and sources can repeat a post across pages.
  const unique = [...new Map(input.posts.map((post) => [`${post.platform}:${post.externalId}`, post])).values()];
  if (unique.length === 0) return 0;
  const db = await getDb();
  const scores = outlierScores(unique);
  const rows = unique.map((post, index) => {
    const outlier = scores[index] ?? 0;
    const data: PostData = {
      ...(input.niche ? { niche: input.niche } : {}),
      hashtags: post.hashtags,
      sound: post.sound,
      notes: whyItWorked(post, outlier),
      engagementPct: engagementRate(post),
      source: input.sourceId,
      sample: input.sample,
    };
    return {
      workspaceId: input.workspaceId,
      accountId: input.accountId ?? null,
      platform: post.platform,
      externalId: post.externalId,
      url: post.url,
      authorHandle: post.authorHandle,
      caption: post.caption,
      hook: extractHook(post.caption),
      thumbnailUrl: post.thumbnailUrl,
      durationMs: post.durationMs,
      postedAt: post.postedAt,
      views: post.views,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      saves: post.saves,
      outlierScore: outlier,
      data: data as Record<string, unknown>,
    };
  });
  await db
    .insert(viralPosts)
    .values(rows)
    .onConflictDoUpdate({
      target: [viralPosts.workspaceId, viralPosts.platform, viralPosts.externalId],
      set: {
        accountId: sql`coalesce(excluded.account_id, ${viralPosts.accountId})`,
        caption: sql`excluded.caption`,
        hook: sql`excluded.hook`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        views: sql`excluded.views`,
        likes: sql`excluded.likes`,
        comments: sql`excluded.comments`,
        shares: sql`excluded.shares`,
        saves: sql`excluded.saves`,
        outlierScore: sql`excluded.outlier_score`,
        data: sql`coalesce(${viralPosts.data}, '{}'::jsonb) || excluded.data`,
      },
    });
  return rows.length;
}

/** Pulls high-performing posts for a niche from the active source into the Discover library. */
export async function refreshDiscover(input: {
  workspaceId: string;
  niche: string;
  platform?: SocialPlatform | null;
  limit?: number;
}): Promise<{ count: number; sourceId: string; sample: boolean }> {
  const source = researchSource(input.platform);
  const niche = input.niche.trim() || DEFAULT_NICHE.label;
  const posts = await source.discover({ niche, platform: input.platform ?? undefined, limit: input.limit ?? 20 });
  const count = await upsertPosts({
    workspaceId: input.workspaceId,
    posts,
    sourceId: source.id,
    sample: source.sample,
    niche,
  });
  return { count, sourceId: source.id, sample: source.sample };
}

export async function listDiscover(input: {
  workspaceId: string;
  niche?: string | null;
  platform?: SocialPlatform | null;
  limit?: number;
}): Promise<ViralPost[]> {
  const db = await getDb();
  const filters = [eq(viralPosts.workspaceId, input.workspaceId)];
  if (input.niche) filters.push(sql`lower(${viralPosts.data}->>'niche') = ${input.niche.toLowerCase()}`);
  if (input.platform) filters.push(eq(viralPosts.platform, input.platform));
  return db
    .select()
    .from(viralPosts)
    .where(and(...filters))
    .orderBy(desc(viralPosts.outlierScore), desc(viralPosts.views))
    .limit(input.limit ?? 60);
}

/** Niches with stored posts, plus the brief's niche and the sample niches, for the Discover filter. */
export async function discoverNiches(workspaceId: string, briefNiche: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ niche: sql<string | null>`${viralPosts.data}->>'niche'` })
    .from(viralPosts)
    .where(eq(viralPosts.workspaceId, workspaceId));
  const seen = new Map<string, string>();
  for (const value of [briefNiche, ...rows.map((row) => row.niche ?? ""), ...FIXTURE_NICHES.map((niche) => niche.label)]) {
    const label = value.trim();
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()];
}

export async function getPost(workspaceId: string, id: string): Promise<ViralPost | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(viralPosts)
    .where(and(eq(viralPosts.workspaceId, workspaceId), eq(viralPosts.id, id)))
    .limit(1);
  return row ?? null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
