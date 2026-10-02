import { ResearchError, type SocialPlatform } from "./types";

export type ParsedAccount = { platform: SocialPlatform; handle: string; profileUrl: string };

const HANDLE = /^[a-z0-9._-]{1,60}$/;

const HOSTS: Record<string, SocialPlatform> = {
  "tiktok.com": "tiktok",
  "instagram.com": "instagram",
  "youtube.com": "youtube",
  "facebook.com": "facebook",
  "fb.com": "facebook",
};

export function profileUrl(platform: SocialPlatform, handle: string): string {
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (platform === "instagram") return `https://www.instagram.com/${handle}/`;
  if (platform === "youtube") return `https://www.youtube.com/@${handle}`;
  return `https://www.facebook.com/${handle}`;
}

/**
 * Reads a profile URL (tiktok.com/@x, instagram.com/x, youtube.com/@x, facebook.com/x)
 * or a bare handle. A bare handle needs `platform`. Handles are stored lower-case without `@`.
 */
export function parseAccountInput(input: string, platform?: SocialPlatform | null): ParsedAccount {
  const raw = input.trim();
  if (!raw) throw new ResearchError("Enter a handle or a profile URL");

  const asUrl = /^https?:\/\//i.test(raw) || /^(?:www\.|m\.)?[a-z]+\.com\//i.test(raw) ? toUrl(raw) : null;
  if (asUrl) {
    const host = asUrl.hostname.toLowerCase().replace(/^(?:www|m|vm)\./, "");
    const found = HOSTS[host];
    if (!found) throw new ResearchError("Use a TikTok, Instagram, YouTube, or Facebook profile URL");
    const segment = asUrl.pathname.split("/").filter(Boolean)[0] ?? "";
    const handle = cleanHandle(segment);
    if (!handle || ["p", "reel", "reels", "watch", "shorts", "video", "channel"].includes(handle)) {
      throw new ResearchError("That link is not a profile. Paste the account's profile URL");
    }
    return { platform: found, handle, profileUrl: profileUrl(found, handle) };
  }

  if (!platform) throw new ResearchError("Pick a platform for a bare handle");
  const handle = cleanHandle(raw);
  if (!handle) throw new ResearchError("That handle has characters a profile cannot have");
  return { platform, handle, profileUrl: profileUrl(platform, handle) };
}

function toUrl(raw: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function cleanHandle(value: string): string | null {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  const handle = decoded.trim().replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}
