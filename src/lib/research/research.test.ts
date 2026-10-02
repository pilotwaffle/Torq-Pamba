import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { auditLog, ideas as ideasTable, videos, workspaces, type BrandBrief, type Workspace } from "@/db/schema";
import { isPlanMessage } from "@/lib/agent/plan";
import { generateFromMessage, handleUserMessage, listChat } from "@/lib/agent/run";
import { chatTools } from "@/lib/agent/tools/registry";
import { signupAccount } from "@/lib/auth/account";
import { accountPosts, addAccount, archiveAccount, listAccounts, syncAccount } from "./accounts";
import { makeVideoFromIdea, withIdeaHook } from "./handoff";
import { generateIdeas, getIdea, listIdeas, setIdeaStatus } from "./ideas";
import { discoverNiches, listDiscover, postData, refreshDiscover, upsertPosts } from "./posts";
import { listTrends, refreshTrends } from "./trends";

const BRIEF: BrandBrief = {
  companyName: "Northwind Cold Brew",
  niche: "Cold brew coffee",
  whatTheyDo: "Ready-to-drink oat-milk cold brew",
  products: ["Oat-milk cold brew"],
  audience: "busy commuters",
  tone: "warm",
};

async function workspaceWithBrief(label: string, brief: BrandBrief | null = BRIEF): Promise<{ workspace: Workspace; userId: string }> {
  const { user, workspace } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "correct-horse-battery",
    workspaceName: `${label} Co`,
  });
  const db = await getDb();
  const [updated] = await db.update(workspaces).set({ brief }).where(eq(workspaces.id, workspace.id)).returning();
  return { workspace: updated ?? workspace, userId: user.id };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("discover", () => {
  it("stores high-performing posts with scores, hooks, and why-it-worked notes, filterable by niche and platform", async () => {
    const { workspace } = await workspaceWithBrief("discover");
    const result = await refreshDiscover({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    expect(result).toMatchObject({ sourceId: "mock", sample: true });
    expect(result.count).toBeGreaterThanOrEqual(6);

    const feed = await listDiscover({ workspaceId: workspace.id, niche: "cold brew COFFEE" });
    expect(feed).toHaveLength(result.count);
    expect(feed[0]?.outlierScore).toBeGreaterThan(feed.at(-1)?.outlierScore ?? 0);
    expect(feed[0]?.hook).toBeTruthy();
    expect(postData(feed[0]!).notes?.length).toBeGreaterThan(0);
    expect(postData(feed[0]!)).toMatchObject({ niche: "Cold brew coffee", sample: true, source: "mock" });

    const youtube = await listDiscover({ workspaceId: workspace.id, platform: "youtube" });
    expect(youtube.length).toBeGreaterThan(0);
    expect(youtube.every((post) => post.platform === "youtube")).toBe(true);
    expect(await listDiscover({ workspaceId: workspace.id, niche: "Pets" })).toEqual([]);

    // A second pull refreshes metrics in place instead of duplicating rows.
    await refreshDiscover({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    expect(await listDiscover({ workspaceId: workspace.id, niche: "Cold brew coffee" })).toHaveLength(result.count);

    const niches = await discoverNiches(workspace.id, "Cold brew coffee");
    expect(niches[0]).toBe("Cold brew coffee");
    expect(niches).toContain("Wellness");

    const other = await workspaceWithBrief("discover-other");
    expect(await listDiscover({ workspaceId: other.workspace.id })).toEqual([]);
  });
});

describe("inspiration accounts", () => {
  it("adds by URL or handle, syncs recent posts with performance, and archives", async () => {
    const { workspace, userId } = await workspaceWithBrief("accounts");
    const account = await addAccount({
      workspaceId: workspace.id,
      userId,
      input: "https://www.tiktok.com/@BrewByBea",
      kind: "competitor",
    });
    expect(account).toMatchObject({ platform: "tiktok", handle: "brewbybea", kind: "competitor", syncError: null });
    expect(account.followerCount).toBeGreaterThan(0);
    expect(account.lastSyncedAt).toBeInstanceOf(Date);

    const posts = await accountPosts(workspace.id, account.id);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((post) => post.accountId === account.id && post.authorHandle === "brewbybea")).toBe(true);
    expect(Math.max(...posts.map((post) => post.outlierScore ?? 0))).toBeGreaterThan(2);

    // Re-adding the same profile does not duplicate it; a bare handle needs a platform.
    await addAccount({ workspaceId: workspace.id, userId, input: "@brewbybea", platform: "tiktok" });
    await expect(addAccount({ workspaceId: workspace.id, userId, input: "brewbybea" })).rejects.toThrow(/platform/);
    expect(await listAccounts(workspace.id)).toHaveLength(1);

    // Discovering a post the account already owns keeps the account link.
    expect(await upsertPosts({ workspaceId: workspace.id, posts: [], sourceId: "mock", sample: true })).toBe(0);
    const repeated = posts.slice(0, 1).map((post) => ({
      platform: post.platform,
      externalId: post.externalId,
      url: post.url,
      authorHandle: post.authorHandle,
      caption: post.caption,
      thumbnailUrl: null,
      durationMs: post.durationMs,
      postedAt: post.postedAt,
      views: 5,
      likes: 1,
      comments: 0,
      shares: 0,
      saves: 0,
      hashtags: [],
      sound: null,
    }));
    expect(await upsertPosts({ workspaceId: workspace.id, posts: [...repeated, ...repeated], sourceId: "mock", sample: true })).toBe(1);
    await syncAccount(workspace.id, account.id);
    await refreshDiscover({ workspaceId: workspace.id, niche: "Coffee" });
    const shared = (await listDiscover({ workspaceId: workspace.id, niche: "Coffee" })).filter((post) => post.authorHandle === "brewbybea");
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((post) => post.accountId === account.id)).toBe(true);
    await archiveAccount(workspace.id, userId, account.id);
    expect(await listAccounts(workspace.id)).toEqual([]);
    const restored = await addAccount({ workspaceId: workspace.id, userId, input: "@brewbybea", platform: "tiktok" });
    expect(restored.id).toBe(account.id);
    expect(restored.archivedAt).toBeNull();

    const db = await getDb();
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining(["research.account_added", "research.account_archived"]),
    );
  });

  it("stores the reason on the account when no configured source covers its platform", async () => {
    const { workspace, userId } = await workspaceWithBrief("accounts-error");
    const account = await addAccount({ workspaceId: workspace.id, userId, input: "instagram.com/slowpourstudio" });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PROVIDER_MODE", "live");
    vi.stubEnv("RESEARCH_SOURCE", "youtube");
    vi.stubEnv("YOUTUBE_API_KEY", "yt-test");
    const synced = await syncAccount(workspace.id, account.id);
    expect(synced.syncError).toMatch(/No configured research source covers Instagram/);
    vi.unstubAllEnvs();
    expect((await syncAccount(workspace.id, account.id)).syncError).toBeNull();
  });
});

describe("trends", () => {
  it("records observations and lists the latest per trend", async () => {
    const { workspace } = await workspaceWithBrief("trends");
    const first = await refreshTrends({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    expect(first.length).toBeGreaterThanOrEqual(4);
    await refreshTrends({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    const latest = await listTrends(workspace.id, "Cold brew coffee");
    expect(latest).toHaveLength(first.length);
    expect(latest[0]?.growthPct).toBe(Math.max(...first.map((trend) => trend.growthPct ?? 0)));
    expect(latest.find((trend) => trend.label === "coffeetok")).toMatchObject({ kind: "hashtag", platform: "tiktok" });
    expect(await listTrends(workspace.id, "Pets")).toEqual([]);
  });
});

describe("ideas", () => {
  it("generates brand-specific ideas from the brief plus research without a model", async () => {
    const { workspace, userId } = await workspaceWithBrief("ideas");
    const { ideas, model } = await generateIdeas({ workspace, userId, count: 4 });
    expect(model).toBe(false);
    expect(ideas).toHaveLength(4);
    expect(ideas.every((idea) => idea.workspaceId === workspace.id && idea.status === "new")).toBe(true);
    expect(ideas.some((idea) => idea.source === "viral_post" && idea.viralPostId)).toBe(true);
    expect(ideas.some((idea) => idea.source === "trend" && idea.trendId)).toBe(true);
    expect(ideas.map((idea) => `${idea.title} ${idea.hook} ${idea.angle}`).join(" ")).toMatch(/Oat-milk cold brew/);

    // Asking again skips titles the workspace already has.
    const again = await generateIdeas({ workspace, userId, count: 4 });
    expect(again.ideas).toHaveLength(4);
    const titles = [...ideas, ...again.ideas].map((idea) => idea.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);

    const view = await listIdeas(workspace.id);
    const fromPost = view.find((idea) => idea.viralPostId);
    expect(fromPost?.postAuthor).toBeTruthy();

    await setIdeaStatus(workspace.id, ideas[0]!.id, "dismissed");
    expect((await listIdeas(workspace.id)).some((idea) => idea.id === ideas[0]!.id)).toBe(false);
    expect((await listIdeas(workspace.id, { includeDismissed: true })).some((idea) => idea.id === ideas[0]!.id)).toBe(true);
  });

  it("seeds ideas from one post or trend and rejects another workspace's", async () => {
    const { workspace, userId } = await workspaceWithBrief("ideas-seed");
    await refreshDiscover({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    const [post] = await listDiscover({ workspaceId: workspace.id });
    const fromPost = await generateIdeas({ workspace, userId, count: 2, viralPostId: post!.id });
    expect(fromPost.ideas.length).toBeGreaterThan(0);
    expect(fromPost.ideas.every((idea) => idea.viralPostId === post!.id)).toBe(true);

    const [trend] = await refreshTrends({ workspaceId: workspace.id, niche: "Cold brew coffee" });
    const fromTrend = await generateIdeas({ workspace, userId, count: 2, trendId: trend!.id });
    expect(fromTrend.ideas.every((idea) => idea.trendId === trend!.id)).toBe(true);

    const other = await workspaceWithBrief("ideas-seed-other");
    await expect(generateIdeas({ workspace: other.workspace, userId: other.userId, viralPostId: post!.id })).rejects.toThrow(
      /not in this workspace/,
    );
    expect(await getIdea(other.workspace.id, fromPost.ideas[0]!.id)).toBeNull();
  });

  it("works with no brief at all", async () => {
    const { workspace, userId } = await workspaceWithBrief("ideas-nobrief", null);
    const { ideas } = await generateIdeas({ workspace, userId, count: 3 });
    expect(ideas).toHaveLength(3);
  });
});

describe("make this video", () => {
  it("hands an idea to the chat plan flow, then links the generated video back to it", async () => {
    const { workspace, userId } = await workspaceWithBrief("handoff");
    const { ideas } = await generateIdeas({ workspace, userId, count: 2 });
    const idea = ideas[0]!;
    await makeVideoFromIdea({ workspace, userId, ideaId: idea.id });

    const chat = await listChat(workspace.id);
    expect(chat.at(-2)).toMatchObject({ role: "user", content: `Make a 30s video about ${idea.title.replace(/[.!?…]+$/u, "")}` });
    const planMessage = chat.at(-1)!;
    expect(planMessage.role).toBe("assistant");
    expect(isPlanMessage(planMessage.data)).toBe(true);
    const plan = (planMessage.data as { plan: { hooks: string[]; ideaId: string; durationS: number } }).plan;
    expect(plan.ideaId).toBe(idea.id);
    expect(plan.hooks[0]).toBe(idea.hook);
    expect(new Set(plan.hooks).size).toBe(3);
    expect(plan.durationS).toBe(30);
    expect((await getIdea(workspace.id, idea.id))?.status).toBe("used");

    // Nothing is generated until the user clicks Generate on the plan card.
    const db = await getDb();
    expect(await db.select().from(videos).where(eq(videos.workspaceId, workspace.id))).toEqual([]);
    const generated = await generateFromMessage({ workspaceId: workspace.id, userId, messageId: planMessage.id, tier: "standard", hookIndex: 0 });
    expect(generated.ok).toBe(true);
    const view = await listIdeas(workspace.id);
    const linked = view.find((row) => row.id === idea.id);
    expect(linked?.videoId).toBe(generated.ok ? generated.videoId : null);
    const [video] = await db.select().from(videos).where(and(eq(videos.workspaceId, workspace.id)));
    expect(video?.ideaId).toBe(idea.id);
    expect(video?.title).toBeTruthy();

    const other = await workspaceWithBrief("handoff-other");
    await expect(makeVideoFromIdea({ workspace: other.workspace, userId: other.userId, ideaId: idea.id })).rejects.toThrow(
      /not in this workspace/,
    );
  });

  it("keeps three distinct hooks with the idea's first", () => {
    expect(withIdeaHook(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withIdeaHook(["a", "b", "c"], "z")).toEqual(["z", "a", "b"]);
    expect(withIdeaHook(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
  });
});

describe("research chat tools", () => {
  it("matches trend and idea requests without taking over video requests", () => {
    expect(chatTools.match("What's trending")).toMatchObject({ tool: { name: "find-trends" }, args: {} });
    expect(chatTools.match("find trends on TikTok")?.args).toEqual({ platform: "tiktok" });
    expect(chatTools.match("show me the latest trends in skincare")?.args).toEqual({ niche: "skincare" });
    expect(chatTools.match("give me 3 video ideas")).toMatchObject({ tool: { name: "ideas" }, args: { action: "generate", count: 3 } });
    expect(chatTools.match("Suggest new ideas for my brand")?.args).toEqual({ action: "generate", count: 5 });
    expect(chatTools.match("show my ideas")?.args).toEqual({ action: "list" });
    expect(chatTools.match("make a 20s video about trending ideas")?.tool.name).toBe("plan");
    const definitions = chatTools.definitions().map((definition) => definition.name);
    expect(definitions).toEqual(expect.arrayContaining(["find-trends", "ideas"]));
  });

  it("finds trends, generates ideas, and lists them from chat", async () => {
    const { workspace, userId } = await workspaceWithBrief("chat-research");
    await handleUserMessage({ workspace, userId, text: "what's trending?" });
    let last = (await listChat(workspace.id)).at(-1);
    expect(last?.content).toMatch(/^Trends for Cold brew coffee:/);
    expect(last?.content).toContain("#coffeetok");
    expect(last?.data).toMatchObject({ kind: "trends" });

    await handleUserMessage({ workspace, userId, text: "give me 3 video ideas" });
    last = (await listChat(workspace.id)).at(-1);
    expect(last?.content).toMatch(/^3 new video ideas:/);
    const ids = (last?.data as { ideaIds: string[] }).ideaIds;
    expect(ids).toHaveLength(3);

    await handleUserMessage({ workspace, userId, text: "show my ideas" });
    last = (await listChat(workspace.id)).at(-1);
    expect(last?.content).toMatch(/^Your ideas:/);

    const db = await getDb();
    const stored = await db.select().from(ideasTable).where(eq(ideasTable.workspaceId, workspace.id));
    expect(stored).toHaveLength(3);
  });
});
