import { describe, expect, it } from "vitest";
import {
  ELEVENLABS_FLASH_USD_PER_1K_CHARS,
  ELEVENLABS_V3_USD_PER_1K_CHARS,
  FALLBACK_CHAIN,
  HEYGEN_AVATAR_IV_USD_PER_SEC,
  KLING_AVATAR_USD_PER_SEC,
  OMNI_FLASH_USD_PER_SEC,
  TIER_MODEL,
  estimateClipCost,
} from "@/lib/pricing";

describe("estimateClipCost", () => {
  it("reproduces the published 30s totals", () => {
    expect(estimateClipCost({ tier: "budget", durationS: 30 })).toEqual({
      script: 0.03,
      frames: 0.06,
      video: 1.5,
      voice: 0,
      total: 1.59,
    });
    expect(estimateClipCost({ tier: "standard", durationS: 30 })).toEqual({
      script: 0.08,
      frames: 0.2,
      video: 3.04,
      voice: 0,
      total: 3.32,
    });
    expect(estimateClipCost({ tier: "standard", durationS: 30, voiceOver: true })).toMatchObject({
      voice: 0.05,
      total: 3.37,
    });
    expect(estimateClipCost({ tier: "premium", durationS: 30 })).toEqual({
      script: 0.16,
      frames: 0.4,
      video: 12,
      voice: 0,
      total: 12.56,
    });
    expect(estimateClipCost({ tier: "premium", durationS: 30, voiceOver: true }).total).toBe(12.61);
  });

  it("prices the kling and heygen avatar alternatives", () => {
    expect(KLING_AVATAR_USD_PER_SEC).toBe(0.056);
    expect(HEYGEN_AVATAR_IV_USD_PER_SEC).toBeCloseTo(0.0385, 6);
    expect(estimateClipCost({ tier: "budget", durationS: 30, avatarEngine: "kling-avatar" })).toEqual({
      script: 0.03,
      frames: 0.02,
      video: 1.68,
      voice: 0.03,
      total: 1.76,
    });
    expect(estimateClipCost({ tier: "standard", durationS: 30, avatarEngine: "heygen-avatar-iv" })).toEqual({
      script: 0.08,
      frames: 0,
      video: 1.16,
      voice: 0.05,
      total: 1.29,
    });
  });

  it("keeps line items that sum to the total", () => {
    for (const tier of ["budget", "standard", "premium"] as const) {
      for (const voiceOver of [false, true]) {
        const cost = estimateClipCost({ tier, durationS: 30, voiceOver });
        const sum = Math.round((cost.script + cost.frames + cost.video + cost.voice) * 100);
        expect(sum / 100).toBe(cost.total);
      }
    }
  });

  it("uses omni-flash as the standard default and the spec fallback order", () => {
    expect(TIER_MODEL.standard).toBe("omni-flash");
    expect(OMNI_FLASH_USD_PER_SEC).toBeCloseTo(0.10136, 6);
    expect(FALLBACK_CHAIN.standard).toEqual(["omni-flash", "veo-3.1-lite", "grok-imagine-video"]);
    expect(FALLBACK_CHAIN.budget).toEqual(["veo-3.1-lite", "grok-imagine-video", "omni-flash"]);
    expect(FALLBACK_CHAIN.premium).toEqual([
      "veo-3.1-standard",
      "seedance-2-runway",
      "omni-flash",
      "grok-imagine-video",
    ]);
    expect(ELEVENLABS_V3_USD_PER_1K_CHARS).toBe(0.1);
    expect(ELEVENLABS_FLASH_USD_PER_1K_CHARS).toBe(0.05);
  });
});
