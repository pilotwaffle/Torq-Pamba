import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { chatMessages, creditCharges, creditLedger, generationAttempts, generationJobs, sceneTakes, videos } from "@/db/schema";
import { isPlanMessage } from "@/lib/agent/plan";
import { generateFromMessage, handleUserMessage, listChat } from "@/lib/agent/run";
import { signupAccount } from "@/lib/auth/account";
import { saveStockAvatar } from "@/lib/avatars/store";
import { getCreditBalance } from "@/lib/credits/ledger";
import { quoteClipCredits } from "@/lib/credits/pricing";
import { regenerateScene } from "@/lib/editor/regenerate";
import { loadEditor } from "@/lib/editor/store";
import { resetMockRefusals } from "@/lib/providers/mock";
import { registry, videoProvider } from "@/lib/providers/registry";
import { FALLBACK_CHAIN, generateVideo } from "@/lib/router";
import { lipsyncLine, pollDueVoiceJobs } from "@/lib/voices/pipeline";
import type { LipsyncProvider } from "@/lib/voices/types";
import { renderInputFor } from "./render";
import { settleVideo } from "./settle";
import { processJobs } from "./worker";

beforeEach(() => resetMockRefusals());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function plannedMessage(label: string) {
  const { user, workspace } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "correct-horse-battery",
    workspaceName: `${label} Co`,
  });
  const turn = await handleUserMessage({
    workspace,
    userId: user.id,
    text: "Make a 30s video about our oat-milk cold brew for busy commuters",
  });
  const planMessage = (await listChat(workspace.id)).find((message) => isPlanMessage(message.data));
  if (!turn || !planMessage) throw new Error("no plan");
  return { user, workspace, conversationId: turn.conversationId, planMessage };
}

/** Worker passes with a clock that jumps ahead, as cron ticks would. */
async function drain(videoId: string) {
  const db = await getDb();
  let now = Date.now();
  for (let pass = 0; pass < 40; pass += 1) {
    await processJobs({ videoId, now: new Date(now) });
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (video?.status !== "generating") return video;
    now += 61_000;
  }
  throw new Error("video did not settle");
}

describe("chat agent x video jobs", () => {
  it("posts the still-generating note and the later ready message into the plan's conversation", async () => {
    vi.stubEnv("VIDEO_INLINE_WAIT_MS", "0");
    const { user, workspace, conversationId, planMessage } = await plannedMessage("pending-chat");
    const result = await generateFromMessage({
      workspaceId: workspace.id,
      userId: user.id,
      messageId: planMessage.id,
      tier: "standard",
      hookIndex: 0,
    });
    if (!result.ok) throw new Error(result.error);
    const db = await getDb();
    const assistant = () =>
      db
        .select()
        .from(chatMessages)
        .where(and(eq(chatMessages.workspaceId, workspace.id), eq(chatMessages.role, "assistant")))
        .orderBy(asc(chatMessages.createdAt));
    const [note] = (await assistant()).filter((message) => /still generating/.test(message.content));
    expect(note?.conversationId).toBe(conversationId);

    expect((await drain(result.videoId))?.status).toBe("ready");
    const ready = (await assistant()).filter((message) => message.data?.kind === "ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ conversationId, userId: user.id });
    expect(ready[0]?.data?.videoId).toBe(result.videoId);
  });
});

describe("editor x render", () => {
  it("renders the selected takes, including a regenerated one, and queues a re-render after the change", async () => {
    const { user, workspace, planMessage } = await plannedMessage("editor-render");
    const result = await generateFromMessage({
      workspaceId: workspace.id,
      userId: user.id,
      messageId: planMessage.id,
      tier: "standard",
      hookIndex: 0,
    });
    if (!result.ok) throw new Error(result.error);
    const before = await loadEditor(workspace.id, result.videoId);
    const db = await getDb();
    const firstTakes = await db.select().from(sceneTakes).where(eq(sceneTakes.number, 1));
    const seeded = firstTakes.filter((take) => before?.scenes.some((scene) => scene.selectedTakeId === take.id));
    expect(seeded.length).toBe(before?.scenes.length);
    expect(seeded.every((take) => take.clipAssetId)).toBe(true);

    const regen = await regenerateScene({ workspace, videoId: result.videoId, sceneNumber: 2, actor: user.id });
    expect(regen.status).toBe("ready");
    const after = await loadEditor(workspace.id, result.videoId);
    const [take] = await db.select().from(sceneTakes).where(eq(sceneTakes.id, after!.scenes[1]!.selectedTakeId!));
    expect(take?.number).toBe(2);
    expect(take?.clipAssetId).toBeTruthy();

    const input = await renderInputFor(result.videoId);
    expect(input.scenes[1]?.clipAssetId).toBe(take?.clipAssetId);
    expect(input.scenes[1]?.mock).toBe(true);
    const renders = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, result.videoId), eq(generationJobs.kind, "render"), eq(generationJobs.status, "queued")));
    expect(renders).toHaveLength(1);
    expect(renders[0]?.request).toMatchObject({ reason: "edit" });
  });
});

describe("credits x video jobs", () => {
  async function asyncVideo(label: string) {
    const { workspace } = await signupAccount({
      email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: "correct-horse-battery",
      workspaceName: `${label} Co`,
    });
    const before = await getCreditBalance(workspace.id);
    const scenes = [
      { visual: "kitchen", line: "Cold brew at home", durationS: 2 },
      { visual: "street", line: "Out the door", durationS: 3 },
    ];
    const result = await generateVideo({
      workspaceId: workspace.id,
      tier: "standard",
      title: label,
      prompt: `${label} cold brew`,
      hook: "Made for commuters",
      voiceLines: ["a", "b"],
      scenes,
      waitMs: 0,
    });
    if (!result.ok || !result.pending) throw new Error("expected a pending video");
    const quote = quoteClipCredits({ tier: "standard", durationS: 5 }).total;
    return { workspace, videoId: result.videoId, before, quote };
  }

  async function chargesFor(videoId: string) {
    const db = await getDb();
    return db.select().from(creditCharges).where(eq(creditCharges.videoId, videoId));
  }

  async function ledgerCount(workspaceId: string) {
    const db = await getDb();
    return (await db.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspaceId))).length;
  }

  it("reserves before the jobs run and captures once when the worker finishes the video", async () => {
    const { workspace, videoId, before, quote } = await asyncVideo("credits-async");
    expect(await getCreditBalance(workspace.id)).toBe(before - quote);
    expect(await chargesFor(videoId)).toMatchObject([{ status: "reserved", credits: quote }]);

    expect((await drain(videoId))?.status).toBe("ready");
    const [charge] = await chargesFor(videoId);
    expect(charge?.status).toBe("captured");
    expect(charge!.credits).toBeGreaterThan(0);
    expect(charge!.credits).toBeLessThanOrEqual(quote);
    expect(await getCreditBalance(workspace.id)).toBe(before - charge!.credits);
    const db = await getDb();
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.creditsCharged).toBe(charge!.credits);

    // Re-polling and re-settling the finished video changes nothing.
    const entries = await ledgerCount(workspace.id);
    await db.update(videos).set({ status: "generating" }).where(eq(videos.id, videoId));
    await settleVideo(videoId);
    await processJobs({ videoId, now: new Date(Date.now() + 3_600_000) });
    expect(await ledgerCount(workspace.id)).toBe(entries);
    expect(await getCreditBalance(workspace.id)).toBe(before - charge!.credits);
    expect((await chargesFor(videoId))[0]?.status).toBe("captured");
  });

  it("releases the whole reservation once when every model times out in the worker", async () => {
    for (const id of FALLBACK_CHAIN.standard) vi.spyOn(videoProvider(id), "pollClip").mockResolvedValue({ state: "pending" });
    const { workspace, videoId, before, quote } = await asyncVideo("credits-timeout");
    expect(await getCreditBalance(workspace.id)).toBe(before - quote);

    let now = Date.now();
    const db = await getDb();
    for (let pass = 0; pass < 40; pass += 1) {
      await processJobs({ videoId, now: new Date(now) });
      const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
      if (video?.status !== "generating") break;
      now += 21 * 60_000;
    }
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.status).toBe("failed");
    expect(video?.creditsCharged).toBe(0);
    const jobs = await db.select().from(generationJobs).where(eq(generationJobs.videoId, videoId));
    expect(jobs.some((job) => job.status === "timed_out")).toBe(true);
    expect(await chargesFor(videoId)).toMatchObject([{ status: "released" }]);
    expect(await getCreditBalance(workspace.id)).toBe(before);

    // A second settle pass (a retried tick) refunds nothing more.
    const entries = await ledgerCount(workspace.id);
    await db.update(videos).set({ status: "generating" }).where(eq(videos.id, videoId));
    await settleVideo(videoId);
    expect(await ledgerCount(workspace.id)).toBe(entries);
    expect(await getCreditBalance(workspace.id)).toBe(before);
  });
});

describe("voices x job poller", () => {
  it("advances a due lip-sync job through processJobs, the entry point of the cron tick and the worker", async () => {
    const { user, workspace } = await signupAccount({
      email: `voice-poll-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: "correct-horse-battery",
      workspaceName: "Voice poll Co",
    });
    const avatar = await saveStockAvatar({ workspaceId: workspace.id, actorUserId: user.id, avatarId: "mina-cole" });
    // A vendor job that is still running after submit, like a live HeyGen render.
    const engine = registry.get("lipsync", "heygen-avatar-iv");
    const slow: LipsyncProvider = {
      ...engine,
      isLive: () => true,
      submit: async () => ({ providerJobId: `slow_${crypto.randomUUID()}`, status: "running" }),
    };
    const running = await lipsyncLine({
      workspaceId: workspace.id,
      avatarId: avatar.id,
      text: "Still going.",
      resolve: { lipsync: () => slow },
    });
    expect(running.status).toBe("running");

    // A clip job that is due in the same tick, to check each poller keeps to its own kinds.
    const clipVideo = await generateVideo({
      workspaceId: workspace.id,
      tier: "standard",
      title: "Clip",
      prompt: "voice tick cold brew",
      hook: "Hook",
      voiceLines: ["a"],
      scenes: [{ visual: "kitchen", line: "Cold brew", durationS: 2 }],
      waitMs: 0,
    });
    if (!clipVideo.ok) throw new Error(clipVideo.error);
    const db = await getDb();
    const clipJobs = async () =>
      db.select().from(generationJobs).where(and(eq(generationJobs.videoId, clipVideo.videoId), eq(generationJobs.kind, "clip")));
    const clipsBefore = await clipJobs();
    // Now the clip jobs are due but the lip-sync job is not: c's poller polls nothing and leaves the clips alone.
    expect(clipsBefore.some((job) => ["queued", "submitted", "running"].includes(job.status))).toBe(true);
    expect(await pollDueVoiceJobs(new Date())).toBe(0);
    expect(await clipJobs()).toEqual(clipsBefore);

    // A pass for one video (Generate's inline drive) leaves voice jobs alone.
    const poll = vi.spyOn(engine, "poll").mockResolvedValue({
      status: "succeeded",
      output: { url: "https://cdn.example.com/talk.mp4", mimeType: "video/mp4", durationMs: 2000, posterUrl: null },
    });
    await processJobs({ videoId: clipVideo.videoId, now: new Date(Date.now() + 60_000) });
    expect(poll).not.toHaveBeenCalled();

    const result = await processJobs({ now: new Date(Date.now() + 60_000) });
    expect(result.voice).toBeGreaterThanOrEqual(1);
    expect(poll).toHaveBeenCalled();
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, running.jobId));
    expect(job).toMatchObject({ kind: "lipsync", status: "succeeded" });
    expect(job?.outputAssetId).toBeTruthy();
    // a's clip pipeline recorded nothing for it.
    expect(await db.select().from(generationAttempts).where(eq(generationAttempts.jobId, running.jobId))).toEqual([]);
  });
});
