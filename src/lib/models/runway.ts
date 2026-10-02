import type { ModelConfig } from "./types";

/** Seedance 2.0 via Runway, 1080p: 40 credits/s. https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const SEEDANCE_2_RUNWAY_CREDITS_PER_SEC = 40;
/** https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const RUNWAY_USD_PER_CREDIT = 0.01;
/** 40 × $0.01 = $0.40/s. https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26. */
export const SEEDANCE_2_RUNWAY_USD_PER_SEC = SEEDANCE_2_RUNWAY_CREDITS_PER_SEC * RUNWAY_USD_PER_CREDIT;

export const models: ModelConfig[] = [
  {
    kind: "video",
    id: "seedance-2-runway",
    vendor: "runway",
    label: "Seedance 2.0 via Runway",
    tier: "premium",
    usdPerSecond: SEEDANCE_2_RUNWAY_USD_PER_SEC,
    maxDurationS: 60,
    chains: { premium: 1 },
    source: "https://docs.dev.runwayml.com/guides/pricing/ — read 2026-09-26",
  },
];
