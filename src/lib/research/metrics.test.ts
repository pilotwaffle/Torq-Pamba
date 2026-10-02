import { describe, expect, it } from "vitest";
import { adaptHook, ideaPrompt, parseIdeaResponse, templateIdeas, type IdeaContext } from "./drafts";
import { FIXTURE_NICHES, matchFixtureNiche, toSourcePost } from "./fixtures";
import {
  deriveTrends,
  engagementRate,
  extractHook,
  formatCount,
  growthPct,
  hashtagsOf,
  median,
  outlierScores,
  whyItWorked,
} from "./metrics";
import type { SourcePost } from "./types";

function post(overrides: Partial<SourcePost>): SourcePost {
  return {
    platform: "tiktok",
    externalId: "1",
    url: "https://www.tiktok.com/@a/video/1",
    authorHandle: "a",
    caption: null,
    thumbnailUrl: null,
    durationMs: null,
    postedAt: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    hashtags: [],
    sound: null,
    ...overrides,
  };
}

describe("research metrics", () => {
  it("scores each post against the batch median", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(outlierScores([{ views: 100 }, { views: 200 }, { views: 1000 }, { views: null }])).toEqual([0.5, 1, 5, 0]);
  });

  it("computes engagement, growth, hooks, hashtags, and compact counts", () => {
    expect(engagementRate(post({ views: 1000, likes: 80, comments: 5, shares: 10, saves: 5 }))).toBe(10);
    expect(engagementRate(post({ views: 0, likes: 5 }))).toBe(0);
    expect(growthPct(150, 100)).toBe(50);
    expect(growthPct(150, null)).toBeNull();
    expect(extractHook("POV: you finally stopped paying $7 for cold brew ☕ #coldbrew #coffeetok")).toBe(
      "POV: you finally stopped paying $7 for cold brew ☕",
    );
    expect(extractHook("Why is your cold brew bitter? (it's the grind) #shorts")).toBe("Why is your cold brew bitter?");
    expect(extractHook("#only #tags")).toBeNull();
    expect(hashtagsOf("a #ColdBrew b #coldbrew #oat_milk")).toEqual(["coldbrew", "oat_milk"]);
    expect(formatCount(2_840_000)).toBe("2.8M");
    expect(formatCount(61_200)).toBe("61.2K");
    expect(formatCount(950)).toBe("950");
    expect(formatCount(null)).toBe("—");
  });

  it("explains why a post worked from its numbers and caption", () => {
    const notes = whyItWorked(
      post({
        caption: "POV: you finally stopped paying $7 for cold brew",
        durationMs: 14_000,
        views: 2_840_000,
        likes: 312_000,
        shares: 38_500,
        saves: 61_200,
        comments: 4_100,
        sound: "Espresso (sped up)",
      }),
      4.2,
    );
    expect(notes[0]).toBe("4.2× the usual views for this set of posts.");
    expect(notes).toContain("POV framing puts the viewer inside the scene.");
    expect(notes).toContain("Short (14s), so it gets rewatched.");
    expect(notes.length).toBeLessThanOrEqual(4);
  });

  it("derives hashtag, sound, and format trends weighted by views", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const coffee = matchFixtureNiche("Cold brew coffee");
    expect(coffee?.key).toBe("coffee");
    const trends = deriveTrends((coffee?.posts ?? []).map((item) => toSourcePost(item, now)));
    const labels = trends.map((trend) => `${trend.kind}:${trend.label}`);
    expect(labels).toContain("hashtag:coldbrew");
    expect(labels).toContain("hashtag:coffeetok");
    expect(labels).toContain("sound:Espresso (sped up)");
    expect(labels).toContain("format:Taste test");
    expect(trends[0]?.score).toBe(100);
    expect(trends.find((trend) => trend.label === "coldbrew")?.url).toBe("https://www.tiktok.com/tag/coldbrew");
  });

  it("ships unique fixture niches whose posts parse into source posts", () => {
    expect(new Set(FIXTURE_NICHES.map((niche) => niche.key)).size).toBe(FIXTURE_NICHES.length);
    const now = new Date();
    for (const niche of FIXTURE_NICHES) {
      const ids = niche.posts.map((item) => toSourcePost(item, now).externalId);
      expect(new Set(ids).size, niche.key).toBe(ids.length);
    }
    expect(matchFixtureNiche("underwater basket weaving")).toBeNull();
  });
});

const ctx: IdeaContext = {
  brief: {
    companyName: "Northwind Cold Brew",
    products: ["Oat-milk cold brew"],
    audience: "busy commuters",
    tone: "warm",
  },
  niche: "Cold brew coffee",
  posts: [
    {
      id: "p1",
      platform: "tiktok",
      authorHandle: "commutecoffee",
      hook: "3 mistakes you're making with oat milk cold brew.",
      caption: null,
      views: 1_190_000,
      outlierScore: 2.1,
      notes: ["2.1× the usual views for this set of posts."],
    },
  ],
  trends: [{ id: "t1", kind: "format", label: "Taste test", growthPct: 22 }],
};

describe("idea drafts", () => {
  it("writes brand-specific template ideas tied to their post or trend", () => {
    const ideas = templateIdeas(ctx, 5);
    expect(ideas).toHaveLength(5);
    expect(ideas[0]).toMatchObject({
      source: "viral_post",
      viralPostId: "p1",
      hook: "3 mistakes people make with Oat-milk cold brew",
    });
    expect(ideas[0]?.angle).toMatch(/@commutecoffee/);
    expect(ideas[1]).toMatchObject({ source: "trend", trendId: "t1", title: "Taste test with Oat-milk cold brew" });
    expect(ideas[1]?.angle).toMatch(/up 22%/);
    expect(ideas[2]).toMatchObject({ source: "viral_post", viralPostId: "p1", title: "The @commutecoffee format, starring Oat-milk cold brew" });
    expect(ideas[3]).toMatchObject({ source: "trend", trendId: "t1" });
    expect(ideas[4]).toMatchObject({ source: "agent", title: "How busy commuters actually use Oat-milk cold brew" });
    const seeded = templateIdeas({ ...ctx, trends: [], seeded: true }, 10);
    expect(seeded).toHaveLength(2);
    expect(seeded.every((idea) => idea.viralPostId === "p1")).toBe(true);
    const briefOnly = templateIdeas({ ...ctx, posts: [], trends: [] }, 20);
    expect(briefOnly.length).toBeGreaterThanOrEqual(8);
    expect(briefOnly.every((idea) => idea.source === "agent")).toBe(true);
  });

  it("adapts winning hook structures to the product", () => {
    expect(adaptHook("POV: you found it", "X", "you")).toBe("POV: you just switched to X");
    expect(adaptHook("Is it worth it?", "X", "you")).toBe("Is X actually worth it?");
    expect(adaptHook("Something else", "X", "commuters")).toBe("What commuters get wrong about X");
  });

  it("prompts with the brief and research, and parses the model's JSON back to sources", () => {
    const prompt = ideaPrompt(ctx, 3);
    expect(prompt.system).toMatch(/JSON array/);
    expect(prompt.user).toContain("Brand: Northwind Cold Brew");
    expect(prompt.user).toContain("post 1: [tiktok] @commutecoffee");
    expect(prompt.user).toContain("trend 1: format “Taste test” (+22%)");
    const reply = `Here you go:\n[{"title":"Commuter cold brew taste test","hook":"I tried every cold brew on my train line","angle":"Fits the commute.","basis":"trend 1"},{"title":"Oat milk mistakes","hook":"Stop shaking it","angle":"x","basis":"post 1"},{"title":"x"},{"nope":true},{"title":"Free idea","basis":null}]`;
    const drafts = parseIdeaResponse(reply, ctx);
    expect(drafts.map((draft) => draft.source)).toEqual(["trend", "viral_post", "agent"]);
    expect(drafts[0]).toMatchObject({ trendId: "t1", viralPostId: null, title: "Commuter cold brew taste test" });
    expect(drafts[1]?.viralPostId).toBe("p1");
    expect(parseIdeaResponse("no json here", ctx)).toEqual([]);
    expect(parseIdeaResponse("[not json]", ctx)).toEqual([]);
  });
});
