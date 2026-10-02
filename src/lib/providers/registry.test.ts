import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { mockGenerateClip } from "./mock";
import { createRegistry, imageProviders, llmProviders, registry, videoProvider, videoProviders } from "./registry";
import { defineAdapter, ProviderUnavailableError, type VideoProvider } from "./types";

function fakeVideo(id: string): VideoProvider {
  return {
    id,
    vendor: "fake",
    label: id,
    tier: "standard",
    pricePerSecondUsd: 0.01,
    maxDurationS: 10,
    generateClip: (req) => mockGenerateClip(id, 0.01, req),
  };
}

describe("provider registry", () => {
  it("registers a provider for every catalog video model, and nothing else", () => {
    expect(videoProviders.map((provider) => provider.id).sort()).toEqual(
      catalog
        .modelsOf("video")
        .map((model) => model.id)
        .sort(),
    );
    for (const provider of videoProviders) {
      const model = catalog.video(provider.id);
      expect(provider).toMatchObject({
        vendor: model.vendor,
        label: model.label,
        tier: model.tier,
        pricePerSecondUsd: model.usdPerSecond,
        maxDurationS: model.maxDurationS,
      });
    }
  });

  it("keeps the image and chat providers", () => {
    expect(imageProviders.map((provider) => provider.id)).toEqual(["grok-imagine-image"]);
    expect(imageProviders[0]?.pricePerImageUsd).toBe(catalog.image("grok-imagine-image").usdPerImage);
    expect(llmProviders.map((provider) => provider.id).sort()).toEqual([
      "claude-sonnet-5",
      "gemini-3.8-flash",
      "grok-4.7",
    ]);
    expect(registry.adapters.map((adapter) => adapter.id)).toEqual([
      "elevenlabs",
      "google",
      "heygen",
      "heygen-lipsync",
      "kling",
      "llm",
      "research",
      "runway",
      "xai",
    ]);
  });

  it("resolves by id and rejects unknown ids", () => {
    expect(videoProvider("omni-flash").label).toBe("Gemini Omni Flash");
    expect(() => videoProvider("missing")).toThrow(ProviderUnavailableError);
  });

  it("adds an adapter without touching the others", async () => {
    const extra = defineAdapter({ id: "fake", video: [fakeVideo("fake-video")] });
    const extended = createRegistry([...registry.adapters, extra]);
    expect(extended.list("video")).toHaveLength(videoProviders.length + 1);
    const clip = await extended.get("video", "fake-video").generateClip({ prompt: "hi", durationS: 5 });
    expect(clip).toMatchObject({ providerId: "fake-video", costUsd: 0.05 });
  });

  it("refuses duplicate adapter or provider ids", () => {
    expect(() => createRegistry([defineAdapter({ id: "a" }), defineAdapter({ id: "a" })])).toThrow(
      "Duplicate provider adapter a",
    );
    expect(() =>
      createRegistry([
        defineAdapter({ id: "a", video: [fakeVideo("same")] }),
        defineAdapter({ id: "b", video: [fakeVideo("same")] }),
      ]),
    ).toThrow("Duplicate video provider same");
  });

  it("mocks catalog providers when no keys are set", async () => {
    const provider = catalogVideoProvider("veo-3.1-lite", {
      envKeys: ["DEFINITELY_UNSET_KEY"],
      live: () => Promise.reject(new Error("must not call live")),
    });
    const clip = await provider.generateClip({ prompt: "a kitchen", durationS: 4 });
    expect(clip.providerId).toBe("veo-3.1-lite");
    expect(clip.costUsd).toBeCloseTo(0.2, 10);
    expect(clip.frameUrls[0]).toMatch(/^data:image\/svg\+xml/);
  });
});
