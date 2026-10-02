import type { ModelConfig } from "./types";

const PRICING = "https://elevenlabs.io/pricing/api — read 2026-09-26";

/** ElevenLabs v3. https://elevenlabs.io/pricing/api — read 2026-09-26. */
export const ELEVENLABS_V3_USD_PER_1K_CHARS = 0.1;
/** ElevenLabs Flash. https://elevenlabs.io/pricing/api — read 2026-09-26. */
export const ELEVENLABS_FLASH_USD_PER_1K_CHARS = 0.05;

export const models: ModelConfig[] = [
  {
    kind: "voice",
    id: "elevenlabs-v3",
    vendor: "elevenlabs",
    label: "ElevenLabs v3",
    usdPer1KChars: ELEVENLABS_V3_USD_PER_1K_CHARS,
    voiceOverDefault: true,
    source: PRICING,
  },
  {
    kind: "voice",
    id: "elevenlabs-flash",
    vendor: "elevenlabs",
    label: "ElevenLabs Flash",
    usdPer1KChars: ELEVENLABS_FLASH_USD_PER_1K_CHARS,
    source: PRICING,
  },
];
