/**
 * List prices for clip estimates. Each constant cites the page it was read from.
 * Display totals are rounded to cents; the arithmetic below keeps full precision
 * until that final step.
 */

export type Tier = "budget" | "standard" | "premium";

/** https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_TOKENS_PER_SEC = 5792;
/** https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_USD_PER_1M_VIDEO_TOKENS = 17.5;
/** 5,792 tokens/s × $17.50/1M = $0.10136/s. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_USD_PER_SEC =
  (OMNI_FLASH_TOKENS_PER_SEC * OMNI_FLASH_USD_PER_1M_VIDEO_TOKENS) / 1_000_000;

/** Veo 3.1 Lite, 720p with audio. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const VEO_31_LITE_USD_PER_SEC = 0.05;
/** Veo 3.1 Standard, 1080p with audio. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const VEO_31_STANDARD_USD_PER_SEC = 0.4;

/** https://docs.x.ai/developers/pricing — read 2026-09-26. */
export const GROK_IMAGINE_VIDEO_USD_PER_SEC = 0.07;
/** https://docs.x.ai/developers/pricing — read 2026-09-26. */
export const GROK_IMAGINE_IMAGE_USD = 0.02;

/** Seedance 2.0 via Runway, 1080p: 40 credits/s. https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const SEEDANCE_2_RUNWAY_CREDITS_PER_SEC = 40;
/** https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const RUNWAY_USD_PER_CREDIT = 0.01;
/** 40 × $0.01 = $0.40/s. https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const SEEDANCE_2_RUNWAY_USD_PER_SEC = SEEDANCE_2_RUNWAY_CREDITS_PER_SEC * RUNWAY_USD_PER_CREDIT;

/** Kling avatar, 720p lip-sync. https://kling.ai/document-api/pricing/base/video.md — read 2026-09-26. */
export const KLING_AVATAR_USD_PER_SEC = 0.056;

/** HeyGen Avatar IV photo avatar, per minute. https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained — read 2026-09-26. */
export const HEYGEN_AVATAR_IV_USD_PER_MIN = 2.31;
/** $2.31/min = $0.0385/s. https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained — read 2026-09-26. */
export const HEYGEN_AVATAR_IV_USD_PER_SEC = HEYGEN_AVATAR_IV_USD_PER_MIN / 60;

/** Gemini 3.8 Flash, $ per 1M input tokens. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const GEMINI_38_FLASH_INPUT_USD_PER_1M = 0.75;
/** Gemini 3.8 Flash, $ per 1M output tokens. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const GEMINI_38_FLASH_OUTPUT_USD_PER_1M = 3.75;
/** Claude Sonnet 5, $ per 1M input tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_SONNET_5_INPUT_USD_PER_1M = 2;
/** Claude Sonnet 5, $ per 1M output tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_SONNET_5_OUTPUT_USD_PER_1M = 10;
/** Claude Opus 5.5, $ per 1M input tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_OPUS_55_INPUT_USD_PER_1M = 4;
/** Claude Opus 5.5, $ per 1M output tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_OPUS_55_OUTPUT_USD_PER_1M = 20;

/** Design cap per clip. */
export const SCRIPT_INPUT_TOKENS = 20_000;
/** Design cap per clip. */
export const SCRIPT_OUTPUT_TOKENS = 4_000;

/** Nano Banana 2, 1K image. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const NANO_BANANA_2_USD = 0.067;
/** Nano Banana Pro, 1K image. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const NANO_BANANA_PRO_USD = 0.134;
export const FRAMES_PER_CLIP = 3;

/** ElevenLabs v3. https://elevenlabs.io/pricing/api — read 2026-09-26. */
export const ELEVENLABS_V3_USD_PER_1K_CHARS = 0.1;
/** ElevenLabs Flash. https://elevenlabs.io/pricing/api — read 2026-09-26. */
export const ELEVENLABS_FLASH_USD_PER_1K_CHARS = 0.05;
/** About 500 spoken characters per 30 seconds. */
export const VOICE_CHARS_PER_30S = 500;

export const TIER_MODEL: Record<Tier, string> = {
  budget: "veo-3.1-lite",
  standard: "omni-flash",
  premium: "veo-3.1-standard",
};

export const FALLBACK_CHAIN: Record<Tier, readonly string[]> = {
  standard: ["omni-flash", "veo-3.1-lite", "grok-imagine-video"],
  budget: ["veo-3.1-lite", "grok-imagine-video", "omni-flash"],
  premium: ["veo-3.1-standard", "seedance-2-runway", "omni-flash", "grok-imagine-video"],
};

const VIDEO_USD_PER_SEC: Record<string, number> = {
  "omni-flash": OMNI_FLASH_USD_PER_SEC,
  "veo-3.1-lite": VEO_31_LITE_USD_PER_SEC,
  "grok-imagine-video": GROK_IMAGINE_VIDEO_USD_PER_SEC,
  "veo-3.1-standard": VEO_31_STANDARD_USD_PER_SEC,
  "seedance-2-runway": SEEDANCE_2_RUNWAY_USD_PER_SEC,
  "kling-avatar": KLING_AVATAR_USD_PER_SEC,
  "heygen-avatar-iv": HEYGEN_AVATAR_IV_USD_PER_SEC,
};

const SCRIPT_RATES: Record<Tier, { input: number; output: number }> = {
  budget: { input: GEMINI_38_FLASH_INPUT_USD_PER_1M, output: GEMINI_38_FLASH_OUTPUT_USD_PER_1M },
  standard: { input: CLAUDE_SONNET_5_INPUT_USD_PER_1M, output: CLAUDE_SONNET_5_OUTPUT_USD_PER_1M },
  premium: { input: CLAUDE_OPUS_55_INPUT_USD_PER_1M, output: CLAUDE_OPUS_55_OUTPUT_USD_PER_1M },
};

const FRAME_UNIT_USD: Record<Tier, number> = {
  budget: GROK_IMAGINE_IMAGE_USD,
  standard: NANO_BANANA_2_USD,
  premium: NANO_BANANA_PRO_USD,
};

const AVATAR_ENGINES = new Set(["kling-avatar", "heygen-avatar-iv"]);

export type ClipCost = {
  script: number;
  frames: number;
  video: number;
  voice: number;
  total: number;
};

export function formatUsd(amount: number): string {
  return `$${roundCents(amount).toFixed(2)}`;
}

export function roundCents(amount: number): number {
  // Epsilon guards float artifacts such as 1.755 → 175.4999…
  return Math.round((amount + 1e-9) * 100) / 100;
}

export function videoUsdPerSecond(modelId: string): number {
  const rate = VIDEO_USD_PER_SEC[modelId];
  if (rate == null) throw new Error(`Unknown video model: ${modelId}`);
  return rate;
}

function scriptUsd(tier: Tier): number {
  const rate = SCRIPT_RATES[tier];
  return (SCRIPT_INPUT_TOKENS * rate.input + SCRIPT_OUTPUT_TOKENS * rate.output) / 1_000_000;
}

/**
 * Avatar-engine alternatives follow report section 4B exactly:
 * - Kling Avatar (budget lip-sync): script + ONE avatar frame + 30 s × $0.056
 *   + ElevenLabs Flash voice (0.5K chars × $0.05) = $1.76.
 * - HeyGen Avatar IV Photo Avatar: 0.5 min × $2.31 + ElevenLabs v3 voice-over
 *   ($0.05) + script ($0.08, standard tier). The photo avatar needs no scene
 *   frames. = $1.29.
 * Sums keep full precision and round once, like the report's tables.
 */
const AVATAR_PLAN: Record<string, { frames: number; voice: "flash" | "v3" }> = {
  "kling-avatar": { frames: 1, voice: "flash" },
  "heygen-avatar-iv": { frames: 0, voice: "v3" },
};

function voiceUsd(durationS: number, engine: "flash" | "v3" = "v3"): number {
  const chars = VOICE_CHARS_PER_30S * (durationS / 30);
  const rate = engine === "flash" ? ELEVENLABS_FLASH_USD_PER_1K_CHARS : ELEVENLABS_V3_USD_PER_1K_CHARS;
  return (chars / 1000) * rate;
}

export function estimateClipCost(input: {
  tier: Tier;
  durationS: number;
  model?: string;
  voiceOver?: boolean;
  avatarEngine?: string;
}): ClipCost {
  const durationS = Math.max(0, input.durationS);
  const avatar =
    input.avatarEngine && AVATAR_ENGINES.has(input.avatarEngine)
      ? input.avatarEngine
      : input.model && AVATAR_ENGINES.has(input.model)
        ? input.model
        : null;
  const model =
    avatar ?? (input.model && input.model in VIDEO_USD_PER_SEC ? input.model : TIER_MODEL[input.tier]);
  const plan = avatar ? AVATAR_PLAN[avatar] : null;
  const frameCount = plan ? plan.frames : FRAMES_PER_CLIP;
  const voiceOver = input.voiceOver ?? Boolean(plan);

  const script = scriptUsd(input.tier);
  const frames = frameCount * FRAME_UNIT_USD[input.tier];
  const video = videoUsdPerSecond(model) * durationS;
  const voice = voiceOver ? voiceUsd(durationS, plan?.voice) : 0;
  return {
    script: roundCents(script),
    frames: roundCents(frames),
    video: roundCents(video),
    voice: roundCents(voice),
    total: roundCents(script + frames + video + voice),
  };
}
