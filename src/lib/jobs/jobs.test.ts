import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chatMessages, generationAttempts, generationJobs, mediaAssets, videoRenders, videos } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { readMedia } from "@/lib/media/assets";
import { ffmpegRender } from "@/lib/providers/ffmpeg";
import { omniFlash } from "@/lib/providers/google";
import { resetMockRefusals } from "@/lib/providers/mock";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { generateVideo } from "@/lib/router";
import { MAX_POLL_ERRORS, MAX_RENDER_ATTEMPTS } from "./config";
import { enqueueClipJob } from "./clips";
import { queueRender } from "./render";
import { processJobs } from "./worker";

const password = "correct-horse-battery";

async function workspace(label: string) {
  const { workspace, user } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password,
    workspaceName: `${label} Co`,
  });
  return { workspace, user };
}

function input(workspaceId: string, prompt: string, extra: Partial<Parameters<typeof generateVideo>[0]> = {}) {
  return {
    workspaceId,
    tier: "standard" as const,
    title: prompt,
    prompt,
    hook: "Made for commuters",
    voiceLines: ["a", "b"],
    scenes: [
      { visual: "kitchen", line: "Cold brew at home", durationS: 2 },
      { visual: "street", line: "Out the door", durationS: 3 },
    ],
    ...extra,
  };
}

/** Runs worker passes with a clock that jumps ahead, as cron ticks would. */
async function drain(videoId: string, maxPasses = 40) {
  const db = await getDb();
  let now = Date.now();
  for (let pass = 0; pass < maxPasses; pass += 1) {
    await processJobs({ videoId, now: new Date(now) });
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (video?.status !== "generating") return video;
    now += 61_000;
  }
  throw new Error("video did not settle");
}

async function jobsFor(videoId: string) {
  const db = await getDb();
  return db.select().from(generationJobs).where(eq(generationJobs.videoId, videoId)).orderBy(asc(generationJobs.createdAt));
}

beforeEach(() => resetMockRefusals());
afterEach(() => vi.restoreAllMocks());

describe("video job pipeline (mock)", () => {
  it("submits jobs, downloads clips into media_assets and renders a playable mp4", async () => {
    const { workspace: ws } = await workspace("pipeline");
    const result = await generateVideo(input(ws.id, "oat milk cold brew"));
    expect(result).toMatchObject({ ok: true, attemptSummary: null });
    if (!result.ok) return;

    const db = await getDb();
    const [video] = await db.select().from(videos).where(eq(videos.id, result.videoId));
    expect(video?.status).toBe("ready");
    expect(video?.currentRenderId).toBeTruthy();

    const jobs = await jobsFor(result.videoId);
    expect(jobs.filter((job) => job.kind === "clip").map((job) => [job.provider, job.status])).toEqual([
      ["omni-flash", "succeeded"],
      ["omni-flash", "succeeded"],
    ]);
    expect(jobs.find((job) => job.kind === "render")?.status).toBe("succeeded");
    expect(jobs.every((job) => job.providerJobId)).toBe(true);

    const [render] = await db.select().from(videoRenders).where(eq(videoRenders.id, video!.currentRenderId!));
    expect(render).toMatchObject({ status: "ready", captionsBurnedIn: expect.any(Boolean) });
    expect(render?.durationMs).toBeGreaterThan(4500);
    expect(render?.durationMs).toBeLessThan(5500);
    const [mp4] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, render!.outputAssetId!));
    expect(mp4).toMatchObject({ kind: "video", source: "render", storage: "local", mimeType: "video/mp4", url: `/api/media/${mp4!.id}` });
    expect(mp4?.width).toBe(360);
    expect(mp4?.height).toBe(640);
    const bytes = await readMedia(mp4!);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(bytes.byteLength).toBe(mp4?.sizeBytes);

    const clips = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.workspaceId, ws.id), eq(mediaAssets.source, "generated")));
    expect(clips).toHaveLength(2);
    const kinds = (await db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, ws.id), eq(mediaAssets.source, "render")))).map(
      (asset) => asset.kind,
    );
    expect(kinds.sort()).toEqual(["captions", "image", "video"]);
  });

  it("returns early while jobs run, and the worker finishes and posts to chat", async () => {
    const { workspace: ws, user } = await workspace("async");
    const result = await generateVideo(input(ws.id, "async cold brew", { waitMs: 0, notifyUserId: user.id }));
    expect(result).toMatchObject({ ok: true, pending: true });
    if (!result.ok) return;
    const db = await getDb();
    const [before] = await db.select().from(videos).where(eq(videos.id, result.videoId));
    expect(before?.status).toBe("generating");

    const video = await drain(result.videoId);
    expect(video?.status).toBe("ready");
    expect(video?.costActualUsd).toBeGreaterThan(0);
    const messages = await db.select().from(chatMessages).where(eq(chatMessages.workspaceId, ws.id));
    expect(messages.map((message) => message.data?.kind)).toEqual(["ready"]);
    expect(messages[0]?.data?.videoId).toBe(result.videoId);
  });

  it("retries a transient submit error with backoff instead of moving down the chain", async () => {
    const { workspace: ws } = await workspace("retry");
    const submit = vi
      .spyOn(omniFlash, "submitClip")
      .mockRejectedValueOnce(new ProviderUnavailableError("omni-flash", "HTTP 503", { retryable: true }));
    const result = await generateVideo(input(ws.id, "retry cold brew", { waitMs: 0 }));
    if (!result.ok) throw new Error("expected ok");
    await processJobs({ videoId: result.videoId });
    const queued = (await jobsFor(result.videoId)).filter((job) => job.status === "queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.request).toMatchObject({ submitRetries: 1 });
    expect(queued[0]!.nextPollAt!.getTime()).toBeGreaterThan(Date.now());

    const video = await drain(result.videoId);
    expect(video?.status).toBe("ready");
    expect(submit).toHaveBeenCalledTimes(3);
    const attempts = await (await getDb()).select().from(generationAttempts).where(eq(generationAttempts.videoId, result.videoId));
    expect(attempts.map((attempt) => [attempt.provider, attempt.status])).toEqual([
      ["omni-flash", "ok"],
      ["omni-flash", "ok"],
    ]);
  });

  it("times a job out and falls back to the next model", async () => {
    const { workspace: ws } = await workspace("timeout");
    vi.spyOn(omniFlash, "pollClip").mockResolvedValue({ state: "pending" });
    const result = await generateVideo(input(ws.id, "slow cold brew", { waitMs: 0 }));
    if (!result.ok) throw new Error("expected ok");
    await processJobs({ videoId: result.videoId });
    await processJobs({ videoId: result.videoId });
    // Jump past the 20 minute deadline.
    await processJobs({ videoId: result.videoId, now: new Date(Date.now() + 21 * 60_000) });
    const jobs = await jobsFor(result.videoId);
    expect(jobs.filter((job) => job.provider === "omni-flash").map((job) => job.status)).toEqual(["timed_out", "timed_out"]);
    vi.restoreAllMocks();
    const video = await drain(result.videoId);
    expect(video?.status).toBe("ready");
    const providers = (await jobsFor(result.videoId)).filter((job) => job.status === "succeeded" && job.kind === "clip").map((job) => job.provider);
    expect(providers).toEqual(["veo-3.1-lite", "veo-3.1-lite"]);
  });

  it("gives up after repeated poll errors, and fails with no charge when the chain runs out", async () => {
    const { workspace: ws, user } = await workspace("errors");
    const error = new ProviderUnavailableError("x", "HTTP 502", { retryable: true });
    for (const id of ["omni-flash", "veo-3.1-lite", "grok-imagine-video"]) {
      const { videoProvider } = await import("@/lib/providers/registry");
      vi.spyOn(videoProvider(id), "pollClip").mockRejectedValue(error);
    }
    const result = await generateVideo(input(ws.id, "broken cold brew", { waitMs: 0, notifyUserId: user.id }));
    if (!result.ok) throw new Error("expected ok");
    const video = await drain(result.videoId, 200);
    expect(video?.status).toBe("failed");
    expect(video?.costActualUsd).toBe(0);
    const clipJobs = (await jobsFor(result.videoId)).filter((job) => job.kind === "clip");
    expect(clipJobs.every((job) => job.status === "failed" || job.status === "canceled")).toBe(true);
    expect(Math.max(...clipJobs.map((job) => job.pollCount))).toBe(MAX_POLL_ERRORS);
    const db = await getDb();
    const attempts = await db.select().from(generationAttempts).where(eq(generationAttempts.videoId, result.videoId));
    expect(attempts.every((attempt) => attempt.costUsd === 0)).toBe(true);
    const [note] = await db.select().from(chatMessages).where(eq(chatMessages.workspaceId, ws.id));
    expect(note?.content).toMatch(/Nothing was charged/);
    expect((await jobsFor(result.videoId)).some((job) => job.kind === "render")).toBe(false);
  });

  it("falls back to the slideshow when the render keeps failing, and can re-render", async () => {
    const { workspace: ws } = await workspace("render-fail");
    const render = vi.spyOn(ffmpegRender, "render").mockRejectedValue(new Error("ffmpeg exploded"));
    const result = await generateVideo(input(ws.id, "render cold brew", { waitMs: 0 }));
    if (!result.ok) throw new Error("expected ok");
    const video = await drain(result.videoId);
    expect(render).toHaveBeenCalledTimes(MAX_RENDER_ATTEMPTS);
    expect(video?.status).toBe("ready");
    expect(video?.currentRenderId).toBeNull();
    expect(video?.manifest).toBeTruthy();
    const db = await getDb();
    const [failed] = await db.select().from(videoRenders).where(eq(videoRenders.videoId, result.videoId));
    expect(failed).toMatchObject({ status: "failed", error: "ffmpeg exploded" });

    render.mockRestore();
    const queued = await queueRender(result.videoId);
    await processJobs({ videoId: result.videoId });
    const [after] = await db.select().from(videos).where(eq(videos.id, result.videoId));
    expect(after?.currentRenderId).toBe(queued.renderId);
  });

  it("cancels leftover jobs of a failed video without calling the provider", async () => {
    const { workspace: ws } = await workspace("orphan");
    const db = await getDb();
    const [video] = await db.insert(videos).values({ workspaceId: ws.id, title: "x", status: "failed", tier: "standard" }).returning();
    const submit = vi.spyOn(omniFlash, "submitClip");
    const job = await enqueueClipJob({
      workspaceId: ws.id,
      videoId: video!.id,
      request: { sceneIndex: 0, step: 0, chain: ["omni-flash"], prompt: "x", durationS: 1 },
    });
    await processJobs({ videoId: video!.id });
    const [after] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    expect(after?.status).toBe("canceled");
    expect(submit).not.toHaveBeenCalled();
  });
});
