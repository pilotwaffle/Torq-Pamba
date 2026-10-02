import { describe, expect, it } from "vitest";
import { catalog, catalogProblems, createCatalog, MODELS, type ModelConfig, type VideoModel } from "@/lib/models";

const fake: VideoModel = {
  kind: "video",
  id: "fake-video",
  vendor: "fake",
  label: "Fake Video",
  tier: "standard",
  usdPerSecond: 0.02,
  maxDurationS: 30,
  chains: { standard: 1.5 },
  source: "test fixture",
};

describe("model catalog", () => {
  it("is valid as shipped", () => {
    expect(catalogProblems(MODELS)).toEqual([]);
  });

  it("collects every vendor file", () => {
    expect(new Set(MODELS.map((model) => model.vendor))).toEqual(
      new Set(["anthropic", "elevenlabs", "google", "heygen", "kling", "runway", "xai"]),
    );
    expect(catalog.modelsOf("video").map((model) => model.id).sort()).toEqual([
      "grok-imagine-video",
      "heygen-avatar-iv",
      "kling-avatar",
      "omni-flash",
      "seedance-2-runway",
      "veo-3.1-lite",
      "veo-3.1-standard",
    ]);
  });

  it("orders chains by position and keeps avatar engines out of them", () => {
    expect(catalog.fallbackChain("standard")).toEqual(["omni-flash", "veo-3.1-lite", "grok-imagine-video"]);
    expect(catalog.tierDefault("premium")).toBe("veo-3.1-standard");
    for (const tier of ["budget", "standard", "premium"] as const) {
      expect(catalog.fallbackChain(tier)).not.toContain("kling-avatar");
      expect(catalog.fallbackChain(tier)).not.toContain("heygen-avatar-iv");
    }
  });

  it("slots a new entry into a chain without editing its neighbours", () => {
    const extended = createCatalog([...MODELS, fake]);
    expect(catalogProblems([...MODELS, fake])).toEqual([]);
    expect(extended.fallbackChain("standard")).toEqual([
      "omni-flash",
      "veo-3.1-lite",
      "fake-video",
      "grok-imagine-video",
    ]);
    expect(extended.fallbackChain("budget")).not.toContain("fake-video");
    expect(extended.video("fake-video").usdPerSecond).toBe(0.02);
  });

  it("resolves tier script, frame and voice models", () => {
    expect(catalog.scriptModel("budget").id).toBe("gemini-3.8-flash");
    expect(catalog.scriptModel("standard").id).toBe("claude-sonnet-5");
    expect(catalog.frameModel("premium").id).toBe("nano-banana-pro");
    expect(catalog.voiceOver().id).toBe("elevenlabs-v3");
    expect(catalog.voice("elevenlabs-flash").usdPer1KChars).toBe(0.05);
  });

  it("throws on unknown or wrong-kind lookups", () => {
    expect(() => catalog.video("nope")).toThrow("Unknown video model: nope");
    expect(() => catalog.video("claude-sonnet-5")).toThrow("Unknown video model");
    expect(() => catalog.voice("omni-flash")).toThrow("Unknown voice model");
    expect(catalog.isVideo("nano-banana-2")).toBe(false);
    expect(catalog.isVideo(undefined)).toBe(false);
  });

  it("reports configuration mistakes", () => {
    const clash: ModelConfig = { ...fake, id: "omni-flash", chains: { standard: 1 } };
    const problems = catalogProblems([
      ...MODELS.filter((model) => model.id !== "gemini-3.8-flash"),
      clash,
      { ...fake, id: "broken-avatar", chains: undefined, avatar: { frames: 0, voiceModel: "omni-flash" } },
      { kind: "voice", id: "v2", vendor: "x", label: "V", usdPer1KChars: 1, voiceOverDefault: true, source: "" },
    ]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "duplicate id omni-flash",
        "standard chain has duplicate positions",
        "budget tier needs exactly one script model, found 0",
        "need exactly one voice-over default, found 2",
        "broken-avatar avatar voice omni-flash is not a voice model",
        "v2 has no pricing source",
      ]),
    );
  });
});
