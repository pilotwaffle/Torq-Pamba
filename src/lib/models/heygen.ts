import type { ModelConfig } from "./types";

/** HeyGen Avatar IV photo avatar, per minute. https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained — read 2026-09-26. */
export const HEYGEN_AVATAR_IV_USD_PER_MIN = 2.31;
/** $2.31/min = $0.0385/s. https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained — read 2026-09-26. */
export const HEYGEN_AVATAR_IV_USD_PER_SEC = HEYGEN_AVATAR_IV_USD_PER_MIN / 60;

export const models: ModelConfig[] = [
  {
    kind: "video",
    id: "heygen-avatar-iv",
    vendor: "heygen",
    label: "HeyGen Avatar IV",
    tier: "budget",
    usdPerSecond: HEYGEN_AVATAR_IV_USD_PER_SEC,
    maxDurationS: 60,
    // Report 4B: 0.5 min × $2.31 + ElevenLabs v3 voice-over + script. The photo avatar needs no scene frames. = $1.29.
    avatar: { frames: 0, voiceModel: "elevenlabs-v3" },
    source: "https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained — read 2026-09-26",
  },
];
