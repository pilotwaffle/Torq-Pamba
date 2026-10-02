import type { ModelConfig } from "./types";

const PRICING = "https://www.anthropic.com/pricing — read 2026-09-26";

/** Claude Sonnet 5, $ per 1M input tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_SONNET_5_INPUT_USD_PER_1M = 2;
/** Claude Sonnet 5, $ per 1M output tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_SONNET_5_OUTPUT_USD_PER_1M = 10;
/** Claude Opus 5.5, $ per 1M input tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_OPUS_55_INPUT_USD_PER_1M = 4;
/** Claude Opus 5.5, $ per 1M output tokens. https://www.anthropic.com/pricing — read 2026-09-26. */
export const CLAUDE_OPUS_55_OUTPUT_USD_PER_1M = 20;

export const models: ModelConfig[] = [
  {
    kind: "script",
    id: "claude-sonnet-5",
    vendor: "anthropic",
    label: "Claude Sonnet 5",
    tier: "standard",
    inputUsdPer1M: CLAUDE_SONNET_5_INPUT_USD_PER_1M,
    outputUsdPer1M: CLAUDE_SONNET_5_OUTPUT_USD_PER_1M,
    source: PRICING,
  },
  {
    kind: "script",
    id: "claude-opus-5.5",
    vendor: "anthropic",
    label: "Claude Opus 5.5",
    tier: "premium",
    inputUsdPer1M: CLAUDE_OPUS_55_INPUT_USD_PER_1M,
    outputUsdPer1M: CLAUDE_OPUS_55_OUTPUT_USD_PER_1M,
    source: PRICING,
  },
];
