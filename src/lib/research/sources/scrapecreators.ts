import { isLive } from "@/lib/providers/live";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { profileUrl } from "../handles";
import { hashtagsOf } from "../metrics";
import { ResearchError, type ResearchSource, type SourceAccount, type SourcePost } from "../types";
import { arr, fetchJson, num, obj, str, when } from "./http";

/**
 * ScrapeCreators (https://docs.scrapecreators.com): a data API over public
 * TikTok and Instagram pages. It does not use a logged-in session. Auth is the
 * `x-api-key` header. Endpoints checked against the docs on 1 October 2026:
 * GET /v1/tiktok/profile, /v3/tiktok/profile/videos, /v1/tiktok/search/keyword,
 * /v1/instagram/profile, /v1/instagram/user/reels, /v2/instagram/reels/search.
 */
const BASE = "https://api.scrapecreators.com";
const ENV_KEYS = ["SCRAPECREATORS_API_KEY"] as const;

export function scrapeCreatorsUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** One TikTok `aweme` object from profile videos or keyword search. */
export function parseTikTokAweme(raw: unknown): SourcePost | null {
  const item = obj(raw);
  const id = str(item.aweme_id);
  if (!id) return null;
  const stats = obj(item.statistics);
  const author = obj(item.author);
  const video = obj(item.video);
  const handle = str(author.unique_id);
  const caption = str(item.desc);
  const tags = arr(item.text_extra)
    .map((extra) => str(obj(extra).hashtag_name)?.toLowerCase())
    .filter((tag): tag is string => Boolean(tag));
  return {
    platform: "tiktok",
    externalId: id,
    url: str(item.url) ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : `https://www.tiktok.com/video/${id}`),
    authorHandle: handle,
    caption,
    thumbnailUrl: str(arr(obj(video.cover).url_list)[0]),
    durationMs: num(video.duration),
    postedAt: when(item.create_time),
    views: num(stats.play_count),
    likes: num(stats.digg_count),
    comments: num(stats.comment_count),
    shares: num(stats.share_count),
    saves: num(stats.collect_count),
    hashtags: tags.length ? [...new Set(tags)] : hashtagsOf(caption),
    sound: str(obj(item.music).title),
  };
}

/** One reel from /v1/instagram/user/reels (caption is an object) or /v2/instagram/reels/search (caption is a string). */
export function parseInstagramReel(raw: unknown, fallbackHandle?: string): SourcePost | null {
  const item = obj(raw);
  const code = str(item.code) ?? str(item.shortcode);
  if (!code) return null;
  const caption = str(item.caption) ?? str(obj(item.caption).text);
  const owner = obj(item.owner);
  const user = obj(item.user);
  const seconds = num(item.video_duration);
  return {
    platform: "instagram",
    externalId: code,
    url: str(item.url) ?? `https://www.instagram.com/reel/${code}/`,
    authorHandle: str(owner.username) ?? str(user.username) ?? fallbackHandle ?? null,
    caption,
    thumbnailUrl: str(item.display_uri) ?? str(item.thumbnail_src) ?? str(item.display_url),
    durationMs: seconds === null ? null : Math.round(seconds * 1000),
    postedAt: when(item.taken_at),
    views: num(item.ig_play_count) ?? num(item.play_count) ?? num(item.video_play_count) ?? num(item.video_view_count),
    likes: num(item.like_count),
    comments: num(item.comment_count),
    shares: null,
    saves: null,
    hashtags: hashtagsOf(caption),
    sound: null,
  };
}

export function parseTikTokProfile(raw: unknown, handle: string): SourceAccount {
  const body = obj(raw);
  const user = obj(body.user);
  const stats = obj(body.stats);
  const found = str(user.uniqueId)?.toLowerCase() ?? handle;
  return {
    platform: "tiktok",
    handle: found,
    displayName: str(user.nickname),
    profileUrl: profileUrl("tiktok", found),
    followerCount: num(stats.followerCount),
  };
}

export function parseInstagramProfile(raw: unknown, handle: string): SourceAccount {
  const user = obj(obj(obj(raw).data).user);
  const found = str(user.username)?.toLowerCase() ?? handle;
  return {
    platform: "instagram",
    handle: found,
    displayName: str(user.full_name),
    profileUrl: profileUrl("instagram", found),
    followerCount: num(obj(user.edge_followed_by).count),
  };
}

function get(path: string, params: Record<string, string>) {
  return fetchJson("scrapecreators", scrapeCreatorsUrl(path, params), {
    headers: { "x-api-key": process.env.SCRAPECREATORS_API_KEY?.trim() ?? "" },
    timeoutMs: 45_000,
  });
}

function ensureLive() {
  if (!isLive([...ENV_KEYS])) throw new ProviderUnavailableError("scrapecreators", "not configured");
}

export const scrapeCreatorsSource: ResearchSource = {
  id: "scrapecreators",
  label: "ScrapeCreators",
  platforms: ["tiktok", "instagram"],
  envKeys: ENV_KEYS,
  sample: false,

  async lookupAccount({ platform, handle, limit }) {
    ensureLive();
    if (platform === "tiktok") {
      const [profile, videos] = await Promise.all([
        get("/v1/tiktok/profile", { handle }),
        get("/v3/tiktok/profile/videos", { handle, sort_by: "latest", trim: "true" }),
      ]);
      const posts = arr(obj(videos).aweme_list).map(parseTikTokAweme).filter((post): post is SourcePost => post !== null);
      return { account: parseTikTokProfile(profile, handle), posts: posts.slice(0, limit) };
    }
    if (platform === "instagram") {
      const [profile, reels] = await Promise.all([
        get("/v1/instagram/profile", { handle, trim: "true" }),
        get("/v1/instagram/user/reels", { handle, trim: "true" }),
      ]);
      const posts = arr(obj(reels).items)
        .map((item) => parseInstagramReel(item, handle))
        .filter((post): post is SourcePost => post !== null);
      return { account: parseInstagramProfile(profile, handle), posts: posts.slice(0, limit) };
    }
    throw new ResearchError(`ScrapeCreators is not set up for ${platform} here`);
  },

  async discover({ niche, platform = "tiktok", limit }) {
    ensureLive();
    if (platform === "tiktok") {
      const body = await get("/v1/tiktok/search/keyword", { query: niche, date_posted: "this-month", sort_by: "most-liked" });
      return arr(obj(body).search_item_list)
        .map((item) => parseTikTokAweme(obj(item).aweme_info ?? item))
        .filter((post): post is SourcePost => post !== null)
        .slice(0, limit);
    }
    if (platform === "instagram") {
      const body = await get("/v2/instagram/reels/search", { query: niche });
      return arr(obj(body).reels)
        .map((item) => parseInstagramReel(item))
        .filter((post): post is SourcePost => post !== null)
        .slice(0, limit);
    }
    throw new ResearchError(`ScrapeCreators is not set up for ${platform} here`);
  },
};
