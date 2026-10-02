import type { ModelConfig } from "./types";

/** Kling avatar, 720p lip-sync. https://kling.ai/document-api/pricing/base/video.md — read 2026-09-26. */
export const KLING_AVATAR_USD_PER_SEC = 0.056;

export const models: ModelConfig[] = [
  {
    kind: "video",
    id: "kling-avatar",
    vendor: "kling",
    label: "Kling Avatar",
    tier: "budget",
    usdPerSecond: KLING_AVATAR_USD_PER_SEC,
    maxDurationS: 60,
    // Report 4B: script + ONE avatar frame + 30 s × $0.056 + ElevenLabs Flash voice = $1.76.
    avatar: { frames: 1, voiceModel: "elevenlabs-flash" },
    source: "https://kling.ai/document-api/pricing/base/video.md — read 2026-09-26",
  },
];
