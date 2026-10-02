import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { mockPollClip, mockSubmitClip } from "./mock";
import { createRegistry, imageProviders, llmProviders, registry, renderProvider, videoProvider, videoProviders } from "./registry";
import { defineAdapter, ProviderUnavailableError, type VideoProvider } from "./types";

function fakeVideo(id: string): VideoProvider {
  return {
    id,
    vendor: "fake",
    label: id,
    tier: "standard",
    pricePerSecondUsd: 0.01,
    maxDurationS: 10,
    submitClip: (req) => mockSubmitClip(id, req),
    pollClip: (_jobId, req) => mockPollClip(id, req),
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
      "ffmpeg",
      "google",
      "heygen",
      "heygen-lipsync",
      "kling",
      "llm",
      "research",
      "runway",
      "xai",
    ]);
    expect(renderProvider().id).toBe("ffmpeg");
  });

  it("resolves by id and rejects unknown ids", () => {
    expect(videoProvider("omni-flash").label).toBe("Gemini Omni Flash");
    expect(() => videoProvider("missing")).toThrow(ProviderUnavailableError);
  });

  it("adds an adapter without touching the others", async () => {
    const extra = defineAdapter({ id: "fake", video: [fakeVideo("fake-video")] });
    const extended = createRegistry([...registry.adapters, extra]);
    expect(extended.list("video")).toHaveLength(videoProviders.length + 1);
    const job = await extended.get("video", "fake-video").submitClip({ prompt: "hi", durationS: 1 });
    expect(job.providerJobId).toMatch(/^mock:fake-video:/);
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
      live: {
        submit: () => Promise.reject(new Error("must not call live")),
        poll: () => Promise.reject(new Error("must not call live")),
      },
    });
    const job = await provider.submitClip({ prompt: "a kitchen", durationS: 1 });
    expect(job.providerJobId).toMatch(/^mock:veo-3\.1-lite:/);
    const done = await provider.pollClip(job.providerJobId, { prompt: "a kitchen", durationS: 1 });
    expect(done.state).toBe("succeeded");
    if (done.state === "succeeded") expect(done.frameUrl).toMatch(/^data:image\/svg\+xml/);
  });
});
