import { afterEach, describe, expect, it, vi } from "vitest";
import { registry } from "@/lib/providers/registry";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { liveResearchSources, researchSource } from "./source";
import { apifyProfileInput, apifyRunUrl, parseApifyTikTok } from "./sources/apify";
import { createMockSource } from "./sources/mock";
import {
  parseInstagramProfile,
  parseInstagramReel,
  parseTikTokAweme,
  parseTikTokProfile,
  scrapeCreatorsSource,
  scrapeCreatorsUrl,
} from "./sources/scrapecreators";
import { isoDurationMs, parseYouTubeChannel, parseYouTubeVideo, youtubeUrl } from "./sources/youtube";
import { ResearchError } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function goLive(env: Record<string, string>) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PROVIDER_MODE", "live");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

describe("research sources", () => {
  it("registers mock, YouTube, ScrapeCreators, and Apify under the research-source kind", () => {
    expect(registry.list("research-source").map((source) => source.id)).toEqual(["mock", "youtube", "scrapecreators", "apify"]);
    for (const source of registry.list("research-source")) {
      expect(source.sample).toBe(source.id === "mock");
      expect(source.envKeys.length === 0).toBe(source.id === "mock");
    }
  });

  it("uses the mock source with no keys, in tests, and outside live mode", () => {
    vi.stubEnv("RESEARCH_SOURCE", "scrapecreators");
    vi.stubEnv("SCRAPECREATORS_API_KEY", "sc-test");
    expect(researchSource("tiktok").id).toBe("mock");
    goLive({ RESEARCH_SOURCE: "scrapecreators" });
    vi.stubEnv("SCRAPECREATORS_API_KEY", "");
    expect(researchSource("tiktok").id).toBe("mock");
  });

  it("picks the first configured live source that covers the platform", () => {
    goLive({ RESEARCH_SOURCE: "youtube, scrapecreators,unknown", YOUTUBE_API_KEY: "yt-test", SCRAPECREATORS_API_KEY: "sc-test" });
    expect(liveResearchSources().map((source) => source.id)).toEqual(["youtube", "scrapecreators"]);
    expect(researchSource("youtube").id).toBe("youtube");
    expect(researchSource("instagram").id).toBe("scrapecreators");
    expect(researchSource().id).toBe("youtube");
    expect(() => researchSource("facebook")).toThrow(ResearchError);
  });

  it("sends the ScrapeCreators key as x-api-key and reads keyword search results", async () => {
    goLive({ RESEARCH_SOURCE: "scrapecreators", SCRAPECREATORS_API_KEY: "sc-test" });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, search_item_list: [{ aweme_info: AWEME }], cursor: 20 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const posts = await scrapeCreatorsSource.discover({ niche: "cold brew", limit: 5 });
    expect(posts).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.scrapecreators.com/v1/tiktok/search/keyword?query=cold+brew&date_posted=this-month&sort_by=most-liked");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sc-test");
  });

  it("reports a vendor error without leaking the key", async () => {
    goLive({ SCRAPECREATORS_API_KEY: "sc-secret" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const error = await scrapeCreatorsSource.discover({ niche: "x", limit: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(String((error as Error).message)).toMatch(/HTTP 429/);
    expect(String((error as Error).message)).not.toContain("sc-secret");
  });

  it("refuses live calls when not configured, even if called directly", async () => {
    await expect(scrapeCreatorsSource.discover({ niche: "x", limit: 1 })).rejects.toThrow(ProviderUnavailableError);
  });
});

/** Shaped like the documented ScrapeCreators /v1/tiktok/search/keyword example. */
const AWEME = {
  aweme_id: "7268287584244124971",
  desc: "Iced coffee hack #coffeetok #coldbrew",
  create_time: 1692300000,
  url: "https://www.tiktok.com/@thatgreygentleman/video/7268287584244124971",
  statistics: { play_count: 1282645, digg_count: 481608, comment_count: 187, share_count: 2721, collect_count: 6978 },
  video: { duration: 22874, cover: { url_list: ["https://p16-sign.tiktokcdn-us.com/cover.jpeg"] } },
  author: { unique_id: "thatgreygentleman", nickname: "That Grey Gentleman" },
  music: { title: "original sound" },
  text_extra: [{ hashtag_name: "CoffeeTok" }, { hashtag_name: "coldbrew" }],
};

describe("source parsers", () => {
  it("parses ScrapeCreators TikTok and Instagram payloads", () => {
    expect(parseTikTokAweme(AWEME)).toMatchObject({
      platform: "tiktok",
      externalId: "7268287584244124971",
      authorHandle: "thatgreygentleman",
      views: 1282645,
      likes: 481608,
      shares: 2721,
      saves: 6978,
      durationMs: 22874,
      hashtags: ["coffeetok", "coldbrew"],
      postedAt: new Date(1692300000 * 1000),
      thumbnailUrl: "https://p16-sign.tiktokcdn-us.com/cover.jpeg",
    });
    expect(parseTikTokAweme({})).toBeNull();
    expect(
      parseTikTokProfile({ user: { uniqueId: "StoolPresidente", nickname: "Dave" }, stats: { followerCount: 4100000 } }, "x"),
    ).toEqual({
      platform: "tiktok",
      handle: "stoolpresidente",
      displayName: "Dave",
      profileUrl: "https://www.tiktok.com/@stoolpresidente",
      followerCount: 4100000,
    });
    expect(
      parseInstagramReel({ code: "DKKtpqaxg0C", taken_at: 1748371310, caption: { text: "Dogs are family #rescuedog" }, ig_play_count: 1685367, like_count: 71768, comment_count: 1096 }, "fetchmycamera_"),
    ).toMatchObject({ externalId: "DKKtpqaxg0C", url: "https://www.instagram.com/reel/DKKtpqaxg0C/", views: 1685367, authorHandle: "fetchmycamera_", hashtags: ["rescuedog"] });
    expect(
      parseInstagramReel({ shortcode: "DOq6eV6iIgD", url: "https://www.instagram.com/reel/DOq6eV6iIgD/", caption: "Hi", taken_at: "2025-09-16T16:56:45.000Z", video_duration: 75.7, owner: { username: "fetchmycamera_" } }),
    ).toMatchObject({ durationMs: 75700, postedAt: new Date("2025-09-16T16:56:45.000Z"), views: null });
    expect(parseInstagramProfile({ data: { user: { username: "adrianhorning", full_name: "Adrian", edge_followed_by: { count: 24555 } } } }, "x")).toMatchObject({
      handle: "adrianhorning",
      followerCount: 24555,
    });
    expect(scrapeCreatorsUrl("/v3/tiktok/profile/videos", { handle: "a b" })).toBe("https://api.scrapecreators.com/v3/tiktok/profile/videos?handle=a+b");
  });

  it("parses YouTube Data API resources", () => {
    expect(isoDurationMs("PT59S")).toBe(59_000);
    expect(isoDurationMs("PT1M5S")).toBe(65_000);
    expect(isoDurationMs("P0D")).toBe(0);
    expect(isoDurationMs("garbage")).toBeNull();
    expect(
      parseYouTubeVideo({
        id: "abc123",
        snippet: { title: "Why is your cold brew bitter? #shorts", description: "Grind it coarse.\nMore", channelTitle: "HomeBaristaClub", publishedAt: "2026-09-20T10:00:00Z", tags: ["cold brew"], thumbnails: { high: { url: "https://i.ytimg.com/vi/abc123/hq.jpg" } } },
        statistics: { viewCount: "640000", likeCount: "31000", commentCount: "980" },
        contentDetails: { duration: "PT33S" },
      }),
    ).toMatchObject({
      platform: "youtube",
      url: "https://www.youtube.com/shorts/abc123",
      caption: "Why is your cold brew bitter? #shorts\nGrind it coarse.",
      views: 640000,
      durationMs: 33000,
      hashtags: ["shorts", "coldbrew"],
      shares: null,
    });
    expect(
      parseYouTubeChannel(
        { items: [{ id: "UC1", snippet: { title: "Home Barista", customUrl: "@homebaristaclub" }, statistics: { subscriberCount: "120000" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] },
        "x",
      ),
    ).toEqual({
      account: { platform: "youtube", handle: "homebaristaclub", displayName: "Home Barista", profileUrl: "https://www.youtube.com/@homebaristaclub", followerCount: 120000 },
      uploads: "UU1",
    });
    expect(parseYouTubeChannel({ items: [] }, "x")).toBeNull();
    expect(youtubeUrl("channels", { forHandle: "@a" }, "k")).toBe("https://www.googleapis.com/youtube/v3/channels?forHandle=%40a&key=k");
  });

  it("parses Apify TikTok Scraper items and builds its run request", () => {
    expect(
      parseApifyTikTok({
        id: "7534061113365859586",
        text: "🤣 #comeramabanana",
        diggCount: 5344,
        shareCount: 701,
        playCount: 55700,
        commentCount: 24,
        collectCount: 291,
        createTimeISO: "2025-08-02T18:45:03.000Z",
        webVideoUrl: "https://www.tiktok.com/@bruniela_/video/7534061113365859586",
        authorMeta: { name: "bruniela_", fans: 1200 },
        videoMeta: { duration: 16, coverUrl: "https://example.com/c.jpg" },
        musicMeta: { musicName: "som original" },
        hashtags: [{ name: "comeramabanana" }],
      }),
    ).toMatchObject({ externalId: "7534061113365859586", views: 55700, durationMs: 16000, sound: "som original", hashtags: ["comeramabanana"] });
    expect(parseApifyTikTok({ id: "1" })).toBeNull();
    expect(apifyRunUrl()).toBe("https://api.apify.com/v2/actors/clockworks~tiktok-scraper/run-sync-get-dataset-items?timeout=120");
    expect(apifyProfileInput("brewbybea", 12)).toMatchObject({ profiles: ["brewbybea"], resultsPerPage: 12 });
  });
});

describe("mock source", () => {
  const source = createMockSource(() => new Date("2026-10-01T12:00:00Z"));

  it("returns niche fixtures, filtered by platform", async () => {
    const all = await source.discover({ niche: "Cold brew coffee", limit: 20 });
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.every((post) => post.views && post.url.startsWith("https://"))).toBe(true);
    const youtube = await source.discover({ niche: "Cold brew coffee", platform: "youtube", limit: 20 });
    expect(youtube.every((post) => post.platform === "youtube")).toBe(true);
    const generic = await source.discover({ niche: "Underwater basket weaving", limit: 20 });
    expect(generic[0]?.caption).toMatch(/underwater basket weaving/);
  });

  it("gives each handle stable profile numbers and posts on the requested platform", async () => {
    const first = await source.lookupAccount({ platform: "instagram", handle: "slowpourstudio", limit: 5 });
    const again = await source.lookupAccount({ platform: "instagram", handle: "slowpourstudio", limit: 5 });
    expect(first).toEqual(again);
    expect(first.account).toMatchObject({ handle: "slowpourstudio", profileUrl: "https://www.instagram.com/slowpourstudio/" });
    expect(first.posts.length).toBeGreaterThan(0);
    expect(first.posts.every((post) => post.platform === "instagram" && post.authorHandle === "slowpourstudio")).toBe(true);
  });

  it("has trends for fixture and unfamiliar niches", async () => {
    expect((await source.trends?.({ niche: "Wellness" }))?.map((trend) => trend.label)).toContain("wallpilates");
    expect((await source.trends?.({ niche: "Ceramics", platform: "instagram" }))?.length).toBeGreaterThan(0);
  });
});
