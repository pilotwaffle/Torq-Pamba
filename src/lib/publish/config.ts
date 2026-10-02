import type { PublishTarget } from "@/db/schema";

export type Platform = "tiktok" | "instagram" | "facebook";
export const PLATFORMS: Platform[] = ["tiktok", "instagram", "facebook"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook Page",
};

/** Publish modes per platform, in UI order. The first is the default. */
export const PLATFORM_MODES: Record<Platform, { value: string; label: string }[]> = {
  tiktok: [
    { value: "direct", label: "Direct Post" },
    { value: "draft", label: "Upload to TikTok drafts" },
  ],
  instagram: [
    { value: "reel", label: "Reel" },
    { value: "trial_reel", label: "Trial Reel (non-followers first)" },
  ],
  facebook: [{ value: "reel", label: "Page Reel" }],
};

const CREDENTIALS: Record<Platform, string[]> = {
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  facebook: ["META_APP_ID", "META_APP_SECRET"],
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as string[]).includes(value);
}

export function isValidMode(platform: Platform, mode: string): boolean {
  return PLATFORM_MODES[platform].some((option) => option.value === mode);
}

export function credentialNames(platform: Platform): string[] {
  return CREDENTIALS[platform];
}

/** Real platform calls need PUBLISH_MODE=live, that platform's app credentials, and not a test run. */
export function isPublishLive(platform: Platform, env: Record<string, string | undefined> = process.env): boolean {
  if (env.PUBLISH_MODE !== "live") return false;
  if (env.NODE_ENV === "test") return false;
  return CREDENTIALS[platform].every((name) => Boolean(env[name]?.trim()));
}

/** TikTok lifts private-only posting and the 5-user cap only after its Content Posting audit. */
export function tiktokAudited(env: Record<string, string | undefined> = process.env): boolean {
  return env.TIKTOK_AUDITED?.trim() === "1";
}

export const TIKTOK_UNAUDITED_USER_CAP = 5;

export function graphVersion(env: Record<string, string | undefined> = process.env): string {
  return env.META_GRAPH_VERSION?.trim() || "v24.0";
}

export function parseTargets(value: unknown): PublishTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.accountId !== "string" || typeof record.mode !== "string") return [];
    return [{ accountId: record.accountId, mode: record.mode }];
  });
}
