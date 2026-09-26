import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { generationAttempts, videos, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { monthlySpendUsd } from "@/lib/budget";
import { omniFlash } from "@/lib/providers/google";
import { mockGenerateClip, resetMockRefusals } from "@/lib/providers/mock";
import { ProviderRefusedError, type VideoProvider } from "@/lib/providers/types";
import { roundCents, type Tier } from "@/lib/pricing";
import { BudgetExceededError, FALLBACK_CHAIN, generateScenes, generateVideo, stitch } from "@/lib/router";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function scenes(prompt: string) {
  return [0, 1, 2].map((index) => ({
    visual: `${prompt} scene ${index}`,
    line: `Line ${index} about the clip`,
    durationS: 10,
  }));
}

beforeEach(() => {
  resetMockRefusals();
});

describe("mock provider", () => {
  it("refuses once when the prompt contains [refuse], then returns an SVG frame", async () => {
    const req = { prompt: "cold brew [refuse]", durationS: 5, sceneId: "scene-a" };
    await expect(mockGenerateClip("omni-flash", 0.1, req)).rejects.toBeInstanceOf(ProviderRefusedError);
    const ok = await mockGenerateClip("veo-3.1-lite", 0.05, req);
    expect(ok.frameUrls[0]).toMatch(/^data:image\/svg\+xml/);
    expect(ok.frameUrls[0]).not.toMatch(/watermark|torq-pamba/i);
    const svg = decodeURIComponent(ok.frameUrls[0]!.slice(ok.frameUrls[0]!.indexOf(",") + 1));
    expect(svg).toContain('viewBox="0 0 360 640"');
    expect(svg).toMatch(/Scene \d · veo-3\.1-lite/);
    expect(svg).not.toContain("cold brew");
  });

  it("does not call the network in mock mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await omniFlash.generateClip({ prompt: "hello", durationS: 4, sceneId: "net" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("generateScenes", () => {
  it("runs every scene at once", async () => {
    let current = 0;
    let max = 0;
    const slow: VideoProvider = {
      id: "slow",
      vendor: "test",
      label: "Slow",
      tier: "standard",
      pricePerSecondUsd: 0,
      maxDurationS: 60,
      async generateClip() {
        current += 1;
        max = Math.max(max, current);
        await new Promise((resolve) => setTimeout(resolve, 40));
        current -= 1;
        return { providerId: "slow", durationS: 1, frameUrls: ["data:image/svg+xml,x"], costUsd: 0 };
      },
    };
    const result = await generateScenes({
      chain: ["slow"],
      scenes: ["a", "b", "c"].map((id) => ({ id, prompt: id, durationS: 1 })),
      resolve: () => slow,
    });
    expect(result.ok).toBe(true);
    expect(max).toBe(3);
  });
});

describe("stitch", () => {
  it("builds an ordered manifest with captions and aiGenerated", () => {
    const manifest = stitch({
      hook: "Watch this",
      scenes: [
        { visual: "one", line: "First line", durationS: 10, model: "omni-flash", frameUrl: "data:a" },
        { visual: "two", line: "Second line", durationS: 10, model: "omni-flash", frameUrl: "data:b" },
      ],
    });
    expect(manifest.aiGenerated).toBe(true);
    expect(manifest.hook).toBe("Watch this");
    expect(manifest.totalDurationS).toBe(20);
    expect(manifest.scenes.map((scene) => scene.line)).toEqual(["First line", "Second line"]);
    expect(manifest.captions).toEqual([
      { text: "First line", startS: 0, endS: 10 },
      { text: "Second line", startS: 10, endS: 20 },
    ]);
    expect("watermark" in manifest).toBe(false);
    expect("logo" in manifest).toBe(false);
  });
});

describe("generateVideo", () => {
  it("follows each tier's fallback chain when the prompt contains [refuse]", async () => {
    const { workspace } = await signupAccount({
      email: email("refuse"),
      password,
      workspaceName: "Refuse Co",
    });
    const cases: { tier: Tier; first: string; second: string }[] = [
      { tier: "standard", first: "omni-flash", second: "veo-3.1-lite" },
      { tier: "budget", first: "veo-3.1-lite", second: "grok-imagine-video" },
      { tier: "premium", first: "veo-3.1-standard", second: "seedance-2-runway" },
    ];
    for (const item of cases) {
      resetMockRefusals();
      const result = await generateVideo({
        workspaceId: workspace.id,
        tier: item.tier,
        title: item.tier,
        prompt: `${item.tier} [refuse]`,
        hook: "Hook",
        voiceLines: ["a", "b", "c"],
        scenes: scenes(`${item.tier} [refuse]`),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.attemptSummary).toBe(`${item.first} refused → ${item.second} ok`);
      expect(FALLBACK_CHAIN[item.tier][0]).toBe(item.first);
      expect(FALLBACK_CHAIN[item.tier][1]).toBe(item.second);
    }
  });

  it("refuses when the estimate exceeds the remaining monthly budget", async () => {
    const { workspace } = await signupAccount({
      email: email("cap"),
      password,
      workspaceName: "Cap Co",
    });
    const db = await getDb();
    await db.update(workspaces).set({ budgetCapUsd: 1 }).where(eq(workspaces.id, workspace.id));
    await expect(
      generateVideo({
        workspaceId: workspace.id,
        tier: "standard",
        title: "Too expensive",
        prompt: "oat milk",
        hook: "Hook",
        voiceLines: ["a", "b", "c"],
        scenes: scenes("oat milk"),
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    const rows = await db.select().from(videos).where(eq(videos.workspaceId, workspace.id));
    expect(rows).toHaveLength(0);
    expect(await monthlySpendUsd(workspace.id, "UTC")).toBe(0);
  });

  it("charges only successful clips and ignores spend from earlier months", async () => {
    const { workspace } = await signupAccount({
      email: email("spend"),
      password,
      workspaceName: "Spend Co",
    });
    const db = await getDb();
    await db.update(workspaces).set({ budgetCapUsd: 5 }).where(eq(workspaces.id, workspace.id));
    const [old] = await db
      .insert(videos)
      .values({
        workspaceId: workspace.id,
        title: "Old",
        status: "ready",
        tier: "standard",
        createdAt: new Date("2020-01-15T00:00:00Z"),
      })
      .returning();
    await db.insert(generationAttempts).values({
      videoId: old!.id,
      provider: "omni-flash",
      status: "ok",
      costUsd: 4,
      createdAt: new Date("2020-01-15T00:00:00Z"),
    });

    const refused = await generateVideo({
      workspaceId: workspace.id,
      tier: "standard",
      title: "Refused",
      prompt: "launch [refuse-all]",
      hook: "Hook",
      voiceLines: ["a", "b", "c"],
      scenes: scenes("launch [refuse-all]"),
    });
    expect(refused.ok).toBe(false);
    expect(await monthlySpendUsd(workspace.id, "UTC")).toBe(0);

    const ready = await generateVideo({
      workspaceId: workspace.id,
      tier: "standard",
      title: "Ready",
      prompt: "oat milk cold brew",
      hook: "Made for commuters",
      voiceLines: ["a", "b", "c"],
      scenes: scenes("oat milk cold brew"),
    });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const [video] = await db.select().from(videos).where(eq(videos.id, ready.videoId));
    expect(video?.status).toBe("ready");
    expect(video?.costActualUsd).toBe(3.32);
    expect(video?.aiGenerated).toBe(true);
    const manifest = video?.manifest as { aiGenerated?: boolean; captions?: unknown[] };
    expect(manifest.aiGenerated).toBe(true);
    expect(manifest.captions?.length).toBe(3);

    const attempts = await db
      .select()
      .from(generationAttempts)
      .where(eq(generationAttempts.videoId, ready.videoId));
    expect(attempts.every((attempt) => attempt.status === "ok")).toBe(true);
    const spent = roundCents(attempts.reduce((sum, attempt) => sum + Number(attempt.costUsd), 0));
    expect(spent).toBe(3.32);
    expect(await monthlySpendUsd(workspace.id, "UTC")).toBe(3.32);

    const failedRows = await db
      .select({ title: videos.title, costUsd: generationAttempts.costUsd })
      .from(generationAttempts)
      .innerJoin(videos, eq(generationAttempts.videoId, videos.id))
      .where(eq(videos.workspaceId, workspace.id));
    const failedCosts = failedRows.filter((row) => row.title === "Refused");
    expect(failedCosts.length).toBeGreaterThan(0);
    expect(failedCosts.every((row) => Number(row.costUsd) === 0)).toBe(true);

    await expect(
      generateVideo({
        workspaceId: workspace.id,
        tier: "standard",
        title: "Second",
        prompt: "another",
        hook: "Hook",
        voiceLines: ["a", "b", "c"],
        scenes: scenes("another"),
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
