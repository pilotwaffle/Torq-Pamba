export type SocialPlatform = "tiktok" | "instagram" | "facebook" | "youtube";

export const PLATFORMS: readonly SocialPlatform[] = ["tiktok", "instagram", "youtube", "facebook"];

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
};

/** A public short video as a research source returns it, before it is stored as a `viral_posts` row. */
export type SourcePost = {
  platform: SocialPlatform;
  externalId: string;
  url: string;
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  postedAt: Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  hashtags: string[];
  sound: string | null;
};

export type SourceAccount = {
  platform: SocialPlatform;
  handle: string;
  displayName: string | null;
  profileUrl: string;
  followerCount: number | null;
};

export type SourceTrend = {
  platform: SocialPlatform | null;
  kind: "hashtag" | "sound" | "format" | "topic";
  label: string;
  volume: number | null;
  growthPct: number | null;
  score: number | null;
  url: string | null;
};

/**
 * Where research data comes from. Only lawful sources: official platform APIs,
 * or a reputable data API that reads public pages without logging in. The mock
 * source returns fixtures so research works with no keys.
 */
export interface ResearchSource {
  id: string;
  label: string;
  platforms: readonly SocialPlatform[];
  /** Env vars the live source needs. The mock source has none. */
  envKeys: readonly string[];
  /** True for fixture data, so the UI can label it as sample data. */
  sample: boolean;
  lookupAccount(req: { platform: SocialPlatform; handle: string; limit: number }): Promise<{
    account: SourceAccount;
    posts: SourcePost[];
  }>;
  /** High-performing short videos for a niche. Without `platform`, any platform the source covers. */
  discover(req: { niche: string; platform?: SocialPlatform; limit: number }): Promise<SourcePost[]>;
  /** Sources without their own trend feed get trends derived from discovered posts. */
  trends?(req: { niche: string; platform?: SocialPlatform }): Promise<SourceTrend[]>;
}

declare module "@/lib/providers/types" {
  interface ProviderKinds {
    "research-source": ResearchSource;
  }
}

export class ResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchError";
  }
}
