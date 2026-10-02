/**
 * Safe-zone guides for 9:16 video. The margins are approximations of where each
 * app draws its own UI (header, caption and music bar, action buttons). The
 * platforms do not publish exact numbers, so these are conservative guides
 * (unverified) and the previewer labels them that way.
 */

export type SafePlatform = "tiktok" | "instagram" | "facebook";
export type Margins = { top: number; bottom: number; left: number; right: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const SAFE_MARGINS: Record<SafePlatform, Margins> = {
  tiktok: { top: 0.08, bottom: 0.2, left: 0.05, right: 0.13 },
  instagram: { top: 0.12, bottom: 0.2, left: 0.05, right: 0.12 },
  facebook: { top: 0.1, bottom: 0.22, left: 0.05, right: 0.12 },
};

export const SAFE_LABEL: Record<SafePlatform, string> = { tiktok: "TikTok", instagram: "Instagram Reels", facebook: "Facebook Reels" };

export function safeZone(platform: SafePlatform, width: number, height: number): Rect {
  const m = SAFE_MARGINS[platform];
  const x = Math.round(width * m.left);
  const y = Math.round(height * m.top);
  return { x, y, w: Math.round(width * (1 - m.left - m.right)), h: Math.round(height * (1 - m.top - m.bottom)) };
}

/** The zone that is safe on every selected platform at once. */
export function combinedSafeZone(platforms: SafePlatform[], width: number, height: number): Rect {
  if (platforms.length === 0) return { x: 0, y: 0, w: width, h: height };
  const m = platforms.reduce<Margins>(
    (acc, platform) => ({
      top: Math.max(acc.top, SAFE_MARGINS[platform].top),
      bottom: Math.max(acc.bottom, SAFE_MARGINS[platform].bottom),
      left: Math.max(acc.left, SAFE_MARGINS[platform].left),
      right: Math.max(acc.right, SAFE_MARGINS[platform].right),
    }),
    { top: 0, bottom: 0, left: 0, right: 0 },
  );
  const x = Math.round(width * m.left);
  const y = Math.round(height * m.top);
  return { x, y, w: Math.round(width * (1 - m.left - m.right)), h: Math.round(height * (1 - m.top - m.bottom)) };
}

/** Which app UI a text box would sit under, per platform. Empty means safe everywhere. */
export function overlapIssues(box: Rect, frame: { width: number; height: number }, platforms: SafePlatform[]): string[] {
  const issues: string[] = [];
  for (const platform of platforms) {
    const zone = safeZone(platform, frame.width, frame.height);
    const label = SAFE_LABEL[platform];
    if (box.y < zone.y) issues.push(`${label}: top bar covers the top of this text`);
    if (box.y + box.h > zone.y + zone.h) issues.push(`${label}: caption and music bar cover the bottom of this text`);
    if (box.x < zone.x) issues.push(`${label}: too close to the left edge`);
    if (box.x + box.w > zone.x + zone.w) issues.push(`${label}: action buttons cover the right side of this text`);
  }
  return issues;
}

export function isVertical(width: number, height: number): boolean {
  return height > 0 && Math.abs(width / height - 9 / 16) < 0.02;
}
