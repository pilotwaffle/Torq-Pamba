import type { ModelConfig } from "./types";

const PRICING = "https://docs.x.ai/developers/pricing — read 2026-09-26";

/** https://docs.x.ai/developers/pricing — read 2026-09-26. */
export const GROK_IMAGINE_VIDEO_USD_PER_SEC = 0.07;
/** https://docs.x.ai/developers/pricing — read 2026-09-26. */
export const GROK_IMAGINE_IMAGE_USD = 0.02;

export const models: ModelConfig[] = [
  {
    kind: "video",
    id: "grok-imagine-video",
    vendor: "xai",
    label: "Grok Imagine Video",
    tier: "budget",
    usdPerSecond: GROK_IMAGINE_VIDEO_USD_PER_SEC,
    maxDurationS: 60,
    chains: { standard: 2, budget: 1, premium: 3 },
    source: PRICING,
  },
  {
    kind: "image",
    id: "grok-imagine-image",
    vendor: "xai",
    label: "Grok Imagine Image",
    tier: "budget",
    usdPerImage: GROK_IMAGINE_IMAGE_USD,
    source: PRICING,
  },
];
