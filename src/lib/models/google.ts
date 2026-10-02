import type { ModelConfig } from "./types";

const PRICING = "https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26";

/** https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_TOKENS_PER_SEC = 5792;
/** https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_USD_PER_1M_VIDEO_TOKENS = 17.5;
/** 5,792 tokens/s × $17.50/1M = $0.10136/s. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const OMNI_FLASH_USD_PER_SEC = (OMNI_FLASH_TOKENS_PER_SEC * OMNI_FLASH_USD_PER_1M_VIDEO_TOKENS) / 1_000_000;
/** Veo 3.1 Lite, 720p with audio. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const VEO_31_LITE_USD_PER_SEC = 0.05;
/** Veo 3.1 Standard, 1080p with audio. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const VEO_31_STANDARD_USD_PER_SEC = 0.4;
/** Gemini 3.8 Flash, $ per 1M input tokens. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const GEMINI_38_FLASH_INPUT_USD_PER_1M = 0.75;
/** Gemini 3.8 Flash, $ per 1M output tokens. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const GEMINI_38_FLASH_OUTPUT_USD_PER_1M = 3.75;
/** Nano Banana 2, 1K image. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const NANO_BANANA_2_USD = 0.067;
/** Nano Banana Pro, 1K image. https://ai.google.dev/gemini-api/docs/pricing — read 2026-09-26. */
export const NANO_BANANA_PRO_USD = 0.134;

export const models: ModelConfig[] = [
  {
    kind: "video",
    id: "omni-flash",
    vendor: "google",
    label: "Gemini Omni Flash",
    tier: "standard",
    usdPerSecond: OMNI_FLASH_USD_PER_SEC,
    maxDurationS: 60,
    chains: { standard: 0, budget: 2, premium: 2 },
    source: PRICING,
  },
  {
    kind: "video",
    id: "veo-3.1-lite",
    vendor: "google",
    label: "Veo 3.1 Lite",
    tier: "budget",
    usdPerSecond: VEO_31_LITE_USD_PER_SEC,
    maxDurationS: 60,
    chains: { standard: 1, budget: 0 },
    source: PRICING,
  },
  {
    kind: "video",
    id: "veo-3.1-standard",
    vendor: "google",
    label: "Veo 3.1 Standard",
    tier: "premium",
    usdPerSecond: VEO_31_STANDARD_USD_PER_SEC,
    maxDurationS: 60,
    chains: { premium: 0 },
    source: PRICING,
  },
  {
    kind: "script",
    id: "gemini-3.8-flash",
    vendor: "google",
    label: "Gemini 3.8 Flash",
    tier: "budget",
    inputUsdPer1M: GEMINI_38_FLASH_INPUT_USD_PER_1M,
    outputUsdPer1M: GEMINI_38_FLASH_OUTPUT_USD_PER_1M,
    source: PRICING,
  },
  {
    kind: "image",
    id: "nano-banana-2",
    vendor: "google",
    label: "Nano Banana 2",
    tier: "standard",
    usdPerImage: NANO_BANANA_2_USD,
    source: PRICING,
  },
  {
    kind: "image",
    id: "nano-banana-pro",
    vendor: "google",
    label: "Nano Banana Pro",
    tier: "premium",
    usdPerImage: NANO_BANANA_PRO_USD,
    source: PRICING,
  },
];
