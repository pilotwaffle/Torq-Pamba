import { isLive } from "@/lib/providers/live";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { profileUrl } from "../handles";
import { hashtagsOf } from "../metrics";
import { ResearchError, type ResearchSource, type SourcePost } from "../types";
import { arr, fetchJson, num, obj, str, when } from "./http";

/**
 * Apify's TikTok Scraper actor (clockworks/tiktok-scraper), which reads public
 * TikTok pages without logging in. Run synchronously through
 * POST /v2/actors/:actorId/run-sync-get-dataset-items with a Bearer token.
 * Checked against docs.apify.com and the actor's input schema on 1 October 2026.
 * A sync run that passes 300 seconds returns 408, so runs are capped at 120.
 */
const ACTOR = "clockworks~tiktok-scraper";
const ENV_KEYS = ["APIFY_TOKEN"] as const;

export function apifyRunUrl(actor = ACTOR, timeoutS = 120): string {
  return `https://api.apify.com/v2/actors/${actor}/run-sync-get-dataset-items?timeout=${timeoutS}`;
}

export function apifyProfileInput(handle: string, limit: number) {
  return { profiles: [handle], resultsPerPage: limit, profileSorting: "latest", excludePinnedPosts: true };
}

export function apifySearchInput(niche: string, limit: number) {
  return { searchQueries: [niche], resultsPerPage: limit };
}

/** One dataset item from the TikTok Scraper actor. */
export function parseApifyTikTok(raw: unknown): SourcePost | null {
  const item = obj(raw);
  const id = str(item.id);
  const url = str(item.webVideoUrl);
  if (!id || !url) return null;
  const author = obj(item.authorMeta);
  const video = obj(item.videoMeta);
  const caption = str(item.text);
  const seconds = num(video.duration);
  const tags = arr(item.hashtags)
    .map((tag) => str(obj(tag).name)?.toLowerCase())
    .filter((tag): tag is string => Boolean(tag));
  return {
    platform: "tiktok",
    externalId: id,
    url,
    authorHandle: str(author.name),
    caption,
    thumbnailUrl: str(video.coverUrl),
    durationMs: seconds === null ? null : Math.round(seconds * 1000),
    postedAt: when(item.createTimeISO) ?? when(item.createTime),
    views: num(item.playCount),
    likes: num(item.diggCount),
    comments: num(item.commentCount),
    shares: num(item.shareCount),
    saves: num(item.collectCount),
    hashtags: tags.length ? [...new Set(tags)] : hashtagsOf(caption),
    sound: str(obj(item.musicMeta).musicName),
  };
}

async function run(input: unknown): Promise<unknown[]> {
  if (!isLive([...ENV_KEYS])) throw new ProviderUnavailableError("apify", "not configured");
  const body = await fetchJson("apify", apifyRunUrl(), {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.APIFY_TOKEN?.trim() ?? ""}` },
    body: input,
    timeoutMs: 150_000,
  });
  return arr(body);
}

export const apifySource: ResearchSource = {
  id: "apify",
  label: "Apify TikTok Scraper",
  platforms: ["tiktok"],
  envKeys: ENV_KEYS,
  sample: false,

  async lookupAccount({ platform, handle, limit }) {
    if (platform !== "tiktok") throw new ResearchError(`Apify is set up for TikTok only, not ${platform}`);
    const items = await run(apifyProfileInput(handle, limit));
    const author = obj(obj(items[0]).authorMeta);
    const posts = items.map(parseApifyTikTok).filter((post): post is SourcePost => post !== null);
    const found = str(author.name)?.toLowerCase() ?? handle;
    return {
      account: {
        platform: "tiktok",
        handle: found,
        displayName: str(author.nickName),
        profileUrl: profileUrl("tiktok", found),
        followerCount: num(author.fans),
      },
      posts,
    };
  },

  async discover({ niche, platform = "tiktok", limit }) {
    if (platform !== "tiktok") throw new ResearchError(`Apify is set up for TikTok only, not ${platform}`);
    const items = await run(apifySearchInput(niche, limit));
    return items.map(parseApifyTikTok).filter((post): post is SourcePost => post !== null);
  },
};
