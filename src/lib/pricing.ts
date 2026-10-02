/**
 * Clip cost estimates. Prices live on the per-model entries in
 * `src/lib/models/<vendor>.ts`, each citing the page it was read from.
 * Display totals are rounded to cents; the arithmetic below keeps full
 * precision until that final step.
 */
import { catalog, TIERS, type Tier } from "@/lib/models";

export type { Tier };
export {
  CLAUDE_OPUS_55_INPUT_USD_PER_1M,
  CLAUDE_OPUS_55_OUTPUT_USD_PER_1M,
  CLAUDE_SONNET_5_INPUT_USD_PER_1M,
  CLAUDE_SONNET_5_OUTPUT_USD_PER_1M,
} from "@/lib/models/anthropic";
export { ELEVENLABS_FLASH_USD_PER_1K_CHARS, ELEVENLABS_V3_USD_PER_1K_CHARS } from "@/lib/models/elevenlabs";
export {
  GEMINI_38_FLASH_INPUT_USD_PER_1M,
  GEMINI_38_FLASH_OUTPUT_USD_PER_1M,
  NANO_BANANA_2_USD,
  NANO_BANANA_PRO_USD,
  OMNI_FLASH_TOKENS_PER_SEC,
  OMNI_FLASH_USD_PER_1M_VIDEO_TOKENS,
  OMNI_FLASH_USD_PER_SEC,
  VEO_31_LITE_USD_PER_SEC,
  VEO_31_STANDARD_USD_PER_SEC,
} from "@/lib/models/google";
export { HEYGEN_AVATAR_IV_USD_PER_MIN, HEYGEN_AVATAR_IV_USD_PER_SEC } from "@/lib/models/heygen";
export { KLING_AVATAR_USD_PER_SEC } from "@/lib/models/kling";
export {
  RUNWAY_USD_PER_CREDIT,
  SEEDANCE_2_RUNWAY_CREDITS_PER_SEC,
  SEEDANCE_2_RUNWAY_USD_PER_SEC,
} from "@/lib/models/runway";
export { GROK_IMAGINE_IMAGE_USD, GROK_IMAGINE_VIDEO_USD_PER_SEC } from "@/lib/models/xai";

/** Design cap per clip. */
export const SCRIPT_INPUT_TOKENS = 20_000;
/** Design cap per clip. */
export const SCRIPT_OUTPUT_TOKENS = 4_000;
export const FRAMES_PER_CLIP = 3;
/** About 500 spoken characters per 30 seconds. */
export const VOICE_CHARS_PER_30S = 500;

function byTier<T>(pick: (tier: Tier) => T): Record<Tier, T> {
  return Object.fromEntries(TIERS.map((tier) => [tier, pick(tier)])) as Record<Tier, T>;
}

/** Each tier's default video model: position 0 of its chain. */
export const TIER_MODEL: Record<Tier, string> = byTier(catalog.tierDefault);

/** Built from each video model's `chains` positions. */
export const FALLBACK_CHAIN: Record<Tier, readonly string[]> = byTier(catalog.fallbackChain);

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
  return catalog.video(modelId).usdPerSecond;
}

function scriptUsd(tier: Tier): number {
  const rate = catalog.scriptModel(tier);
  return (SCRIPT_INPUT_TOKENS * rate.inputUsdPer1M + SCRIPT_OUTPUT_TOKENS * rate.outputUsdPer1M) / 1_000_000;
}

function voiceUsd(durationS: number, voiceModel = catalog.voiceOver().id): number {
  const chars = VOICE_CHARS_PER_30S * (durationS / 30);
  return (chars / 1000) * catalog.voice(voiceModel).usdPer1KChars;
}

function avatarEngine(id: string | undefined): string | null {
  return id && catalog.isVideo(id) && catalog.video(id).avatar ? id : null;
}

/**
 * Avatar engines (entries with `avatar`) price their own frame count and voice
 * model, following report section 4B: Kling Avatar $1.76, HeyGen Avatar IV
 * $1.29 for 30 s. Sums keep full precision and round once, like the report's
 * tables.
 */
export function estimateClipCost(input: {
  tier: Tier;
  durationS: number;
  model?: string;
  voiceOver?: boolean;
  avatarEngine?: string;
}): ClipCost {
  const durationS = Math.max(0, input.durationS);
  const avatar = avatarEngine(input.avatarEngine) ?? avatarEngine(input.model);
  const model = avatar ?? (catalog.isVideo(input.model) ? input.model : TIER_MODEL[input.tier]);
  const plan = avatar ? catalog.video(avatar).avatar : undefined;
  const frameCount = plan ? plan.frames : FRAMES_PER_CLIP;
  const voiceOver = input.voiceOver ?? Boolean(plan);

  const script = scriptUsd(input.tier);
  const frames = frameCount * catalog.frameModel(input.tier).usdPerImage;
  const video = videoUsdPerSecond(model) * durationS;
  const voice = voiceOver ? voiceUsd(durationS, plan?.voiceModel) : 0;
  return {
    script: roundCents(script),
    frames: roundCents(frames),
    video: roundCents(video),
    voice: roundCents(voice),
    total: roundCents(script + frames + video + voice),
  };
}
