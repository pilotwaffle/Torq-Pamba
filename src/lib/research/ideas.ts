import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { chatMessages, ideas, trends, videos, viralPosts, type Idea, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { completeLive } from "@/lib/providers/llm";
import { dedupeDrafts, ideaPrompt, parseIdeaResponse, templateIdeas, type IdeaContext, type IdeaDraft } from "./drafts";
import { getPost, isUuid, listDiscover, postData, refreshDiscover, workspaceNiche } from "./posts";
import { getTrend, listTrends, refreshTrends } from "./trends";
import { ResearchError } from "./types";

export type IdeaStatus = "new" | "saved" | "used" | "dismissed";

export type IdeaView = Idea & {
  postAuthor: string | null;
  postUrl: string | null;
  trendLabel: string | null;
  videoId: string | null;
};

/** Research context for ideas: one seed post or trend, or the niche's top trends and posts (fetched when empty). */
export async function ideaContext(input: {
  workspace: Workspace;
  viralPostId?: string | null;
  trendId?: string | null;
}): Promise<IdeaContext> {
  const { workspace } = input;
  const niche = workspaceNiche(workspace.brief);
  if (input.viralPostId) {
    const post = await getPost(workspace.id, input.viralPostId);
    if (!post) throw new ResearchError("That post is not in this workspace's research");
    return { brief: workspace.brief, niche, trends: [], posts: [toIdeaPost(post)], seeded: true };
  }
  if (input.trendId) {
    const trend = await getTrend(workspace.id, input.trendId);
    if (!trend) throw new ResearchError("That trend is not in this workspace's research");
    return { brief: workspace.brief, niche, posts: [], trends: [trend], seeded: true };
  }
  let topTrends = await listTrends(workspace.id, niche);
  if (topTrends.length === 0) topTrends = await refreshTrends({ workspaceId: workspace.id, niche });
  let posts = await listDiscover({ workspaceId: workspace.id, niche, limit: 6 });
  if (posts.length === 0) {
    await refreshDiscover({ workspaceId: workspace.id, niche });
    posts = await listDiscover({ workspaceId: workspace.id, niche, limit: 6 });
  }
  return { brief: workspace.brief, niche, trends: topTrends.slice(0, 6), posts: posts.map(toIdeaPost) };
}

function toIdeaPost(post: Awaited<ReturnType<typeof listDiscover>>[number]) {
  return {
    id: post.id,
    platform: post.platform,
    authorHandle: post.authorHandle,
    hook: post.hook,
    caption: post.caption,
    views: post.views,
    outlierScore: post.outlierScore,
    notes: postData(post).notes ?? [],
  };
}

/**
 * Brand-specific ideas from the brief plus research. Uses the live chat model
 * when one is configured, and the template writer otherwise or when the
 * model's reply does not parse. Titles already in the workspace are skipped.
 */
export async function generateIdeas(input: {
  workspace: Workspace;
  userId: string;
  count?: number;
  viralPostId?: string | null;
  trendId?: string | null;
}): Promise<{ ideas: Idea[]; model: boolean }> {
  const count = Math.min(10, Math.max(1, Math.round(input.count ?? 5)));
  const ctx = await ideaContext(input);
  const prompt = ideaPrompt(ctx, count);
  const reply = await completeLive(prompt.system, prompt.user).catch(() => null);
  const fromModel = reply ? parseIdeaResponse(reply, ctx) : [];
  const db = await getDb();
  const existing = await db
    .select({ title: ideas.title })
    .from(ideas)
    .where(eq(ideas.workspaceId, input.workspace.id));
  const titles = existing.map((row) => row.title);
  let drafts: IdeaDraft[] = dedupeDrafts(fromModel, titles);
  const model = drafts.length > 0;
  if (drafts.length < count) {
    drafts = dedupeDrafts([...drafts, ...templateIdeas(ctx, 100)], titles);
  }
  drafts = drafts.slice(0, count);
  if (drafts.length === 0) return { ideas: [], model };

  const rows = await db
    .insert(ideas)
    .values(
      drafts.map((draft) => ({
        workspaceId: input.workspace.id,
        title: draft.title,
        hook: draft.hook || null,
        angle: draft.angle || null,
        source: draft.source,
        viralPostId: draft.viralPostId,
        trendId: draft.trendId,
        createdBy: input.userId,
      })),
    )
    .returning();
  await writeAudit({
    workspaceId: input.workspace.id,
    actor: input.userId,
    action: "research.ideas_generated",
    data: { count: rows.length, model, viralPostId: input.viralPostId ?? null, trendId: input.trendId ?? null },
  });
  return { ideas: rows, model };
}

export async function getIdea(workspaceId: string, id: string): Promise<Idea | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.id, id)))
    .limit(1);
  return row ?? null;
}

export async function setIdeaStatus(workspaceId: string, id: string, status: IdeaStatus): Promise<Idea | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .update(ideas)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.id, id)))
    .returning();
  return row ?? null;
}

/** Ideas newest first, without dismissed ones unless asked, with their source post or trend and any video made from them. */
export async function listIdeas(
  workspaceId: string,
  options: { includeDismissed?: boolean; limit?: number } = {},
): Promise<IdeaView[]> {
  await linkIdeaVideos(workspaceId);
  const db = await getDb();
  const filters = [eq(ideas.workspaceId, workspaceId)];
  if (!options.includeDismissed) filters.push(ne(ideas.status, "dismissed"));
  const rows = await db
    .select({
      idea: ideas,
      postAuthor: viralPosts.authorHandle,
      postUrl: viralPosts.url,
      trendLabel: trends.label,
    })
    .from(ideas)
    .leftJoin(viralPosts, eq(viralPosts.id, ideas.viralPostId))
    .leftJoin(trends, eq(trends.id, ideas.trendId))
    .where(and(...filters))
    .orderBy(desc(ideas.createdAt), desc(ideas.title))
    .limit(options.limit ?? 60);
  const ids = rows.map((row) => row.idea.id);
  const made = ids.length
    ? await db
        .select({ id: videos.id, ideaId: videos.ideaId })
        .from(videos)
        .where(and(eq(videos.workspaceId, workspaceId), inArray(videos.ideaId, ids)))
        .orderBy(desc(videos.createdAt))
    : [];
  const videoByIdea = new Map<string, string>();
  for (const video of made) if (video.ideaId && !videoByIdea.has(video.ideaId)) videoByIdea.set(video.ideaId, video.id);
  return rows.map((row) => ({
    ...row.idea,
    postAuthor: row.postAuthor,
    postUrl: row.postUrl,
    trendLabel: row.trendLabel,
    videoId: videoByIdea.get(row.idea.id) ?? null,
  }));
}

/**
 * "Make this video" stores the idea id on the chat plan. When that plan is
 * generated, the chat message records the video id; this copies the link onto
 * `videos.idea_id` without changing the chat or router code.
 */
export async function linkIdeaVideos(workspaceId: string): Promise<number> {
  const db = await getDb();
  const ideaRef = sql`${chatMessages.data}->'plan'->>'ideaId'`;
  const rows = await db
    .select({ ideaId: ideas.id, videoId: videos.id })
    .from(chatMessages)
    .innerJoin(videos, sql`${videos.id}::text = ${chatMessages.data}->>'generatedVideoId'`)
    .innerJoin(ideas, sql`${ideas.id}::text = ${ideaRef}`)
    .where(
      and(
        eq(chatMessages.workspaceId, workspaceId),
        eq(videos.workspaceId, workspaceId),
        eq(ideas.workspaceId, workspaceId),
        isNull(videos.ideaId),
      ),
    );
  for (const row of rows) {
    await db
      .update(videos)
      .set({ ideaId: row.ideaId })
      .where(and(eq(videos.workspaceId, workspaceId), eq(videos.id, row.videoId), isNull(videos.ideaId)));
  }
  return rows.length;
}
