import { isLive } from "@/lib/providers/live";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { profileUrl } from "../handles";
import { hashtagsOf } from "../metrics";
import { ResearchError, type ResearchSource, type SourceAccount, type SourcePost } from "../types";
import { arr, fetchJson, num, obj, str, when } from "./http";

/**
 * The official YouTube Data API v3 with an API key (public data only, no OAuth).
 * Checked against https://developers.google.com/youtube/v3/docs on 1 October 2026:
 * channels.list `forHandle`, playlistItems.list, videos.list (1 quota unit each),
 * and search.list with `videoDuration=short` (under four minutes; 100 quota units).
 */
const BASE = "https://www.googleapis.com/youtube/v3";
const ENV_KEYS = ["YOUTUBE_API_KEY"] as const;

export function youtubeUrl(resource: string, params: Record<string, string>, key: string): string {
  const url = new URL(`${BASE}/${resource}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  return url.toString();
}

/** ISO 8601 duration (PT1M5S) to milliseconds. */
export function isoDurationMs(value: string | null): number | null {
  const match = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total = Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return Math.round(total * 1000);
}

/** One `videos#video` resource with snippet, statistics, and contentDetails. */
export function parseYouTubeVideo(raw: unknown): SourcePost | null {
  const item = obj(raw);
  const id = str(item.id);
  if (!id) return null;
  const snippet = obj(item.snippet);
  const stats = obj(item.statistics);
  const thumbs = obj(snippet.thumbnails);
  const title = str(snippet.title);
  const description = str(snippet.description);
  const caption = [title, description?.split("\n")[0]].filter(Boolean).join("\n") || null;
  const tags = arr(snippet.tags).map((tag) => str(tag)?.toLowerCase().replace(/\s+/g, "")).filter((tag): tag is string => Boolean(tag));
  return {
    platform: "youtube",
    externalId: id,
    url: `https://www.youtube.com/shorts/${id}`,
    authorHandle: str(snippet.channelTitle),
    caption,
    thumbnailUrl: str(obj(thumbs.high).url) ?? str(obj(thumbs.medium).url) ?? str(obj(thumbs.default).url),
    durationMs: isoDurationMs(str(obj(item.contentDetails).duration)),
    postedAt: when(snippet.publishedAt),
    views: num(stats.viewCount),
    likes: num(stats.likeCount),
    comments: num(stats.commentCount),
    shares: null,
    saves: null,
    hashtags: [...new Set([...hashtagsOf(caption), ...tags.slice(0, 5)])],
    sound: null,
  };
}

export function parseYouTubeChannel(raw: unknown, handle: string): { account: SourceAccount; uploads: string | null } | null {
  const item = obj(arr(obj(raw).items)[0]);
  if (!str(item.id)) return null;
  const snippet = obj(item.snippet);
  const found = str(snippet.customUrl)?.replace(/^@/, "").toLowerCase() ?? handle;
  return {
    account: {
      platform: "youtube",
      handle: found,
      displayName: str(snippet.title),
      profileUrl: profileUrl("youtube", found),
      followerCount: num(obj(item.statistics).subscriberCount),
    },
    uploads: str(obj(obj(item.contentDetails).relatedPlaylists).uploads),
  };
}

function key(): string {
  if (!isLive([...ENV_KEYS])) throw new ProviderUnavailableError("youtube", "not configured");
  return process.env.YOUTUBE_API_KEY?.trim() ?? "";
}

async function videosById(ids: string[], apiKey: string): Promise<SourcePost[]> {
  if (ids.length === 0) return [];
  const body = await fetchJson(
    "youtube",
    youtubeUrl("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(0, 50).join(",") }, apiKey),
  );
  return arr(obj(body).items)
    .map(parseYouTubeVideo)
    .filter((post): post is SourcePost => post !== null);
}

export const youtubeSource: ResearchSource = {
  id: "youtube",
  label: "YouTube Data API",
  platforms: ["youtube"],
  envKeys: ENV_KEYS,
  sample: false,

  async lookupAccount({ handle, limit }) {
    const apiKey = key();
    const channel = parseYouTubeChannel(
      await fetchJson("youtube", youtubeUrl("channels", { part: "snippet,statistics,contentDetails", forHandle: `@${handle}` }, apiKey)),
      handle,
    );
    if (!channel) throw new ResearchError(`No YouTube channel found for @${handle}`);
    if (!channel.uploads) return { account: channel.account, posts: [] };
    const uploads = await fetchJson(
      "youtube",
      youtubeUrl("playlistItems", { part: "contentDetails", playlistId: channel.uploads, maxResults: String(Math.min(50, limit)) }, apiKey),
    );
    const ids = arr(obj(uploads).items)
      .map((item) => str(obj(obj(item).contentDetails).videoId))
      .filter((id): id is string => Boolean(id));
    return { account: channel.account, posts: await videosById(ids, apiKey) };
  },

  async discover({ niche, limit }) {
    const apiKey = key();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const search = await fetchJson(
      "youtube",
      youtubeUrl(
        "search",
        {
          part: "snippet",
          type: "video",
          q: `${niche} #shorts`,
          videoDuration: "short",
          order: "viewCount",
          publishedAfter: since,
          maxResults: String(Math.min(50, limit)),
        },
        apiKey,
      ),
    );
    const ids = arr(obj(search).items)
      .map((item) => str(obj(obj(item).id).videoId))
      .filter((id): id is string => Boolean(id));
    return videosById(ids, apiKey);
  },
};
