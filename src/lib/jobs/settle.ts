import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  chatMessages,
  creditCharges,
  generationAttempts,
  generationJobs,
  videoRenders,
  videos,
  type GenerationJob,
} from "@/db/schema";
import { captureCredits, releaseCredits } from "@/lib/credits/charges";
import { creditsForScenes } from "@/lib/credits/pricing";
import { TIER_MODEL, type Tier } from "@/lib/pricing";
import { clipRequestOf, type ClipJobResponse } from "./clips";
import { chargeForScenes, formatAttempts, splitCents, stitch, type AttemptRecord } from "./manifest";

type Video = typeof videos.$inferSelect;

export const ACTIVE_JOB_STATUSES = ["queued", "submitted", "running"] as const;

/** What `generateVideo` keeps in `videos.plan`. */
export type GenerationPlan = {
  hook: string;
  scenes: { visual: string; line: string; durationS: number }[];
  voiceLines?: string[];
  /** Set when Generate returned before the video settled; the worker then posts the outcome to chat. */
  notifyChat?: boolean;
  notifyUserId?: string | null;
  notifyConversationId?: string | null;
};

export function generationPlanOf(video: Pick<Video, "plan">): GenerationPlan {
  const plan = (video.plan ?? {}) as Partial<GenerationPlan>;
  return {
    hook: typeof plan.hook === "string" ? plan.hook : "",
    scenes: Array.isArray(plan.scenes) ? plan.scenes : [],
    voiceLines: plan.voiceLines,
    notifyChat: plan.notifyChat === true,
    notifyUserId: plan.notifyUserId ?? null,
    notifyConversationId: plan.notifyConversationId ?? null,
  };
}

export async function attemptSummaryForVideo(videoId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ provider: generationAttempts.provider, status: generationAttempts.status, detail: generationAttempts.detail })
    .from(generationAttempts)
    .where(eq(generationAttempts.videoId, videoId))
    .orderBy(asc(generationAttempts.createdAt));
  const attempts: AttemptRecord[] = rows.map((row) => ({
    sceneIndex: typeof row.detail?.sceneIndex === "number" ? row.detail.sceneIndex : 0,
    step: typeof row.detail?.step === "number" ? row.detail.step : 0,
    provider: row.provider,
    status: row.status,
  }));
  return formatAttempts(attempts);
}

type SceneState = { state: "ok"; job: GenerationJob } | { state: "pending" } | { state: "failed" };

function sceneStates(sceneCount: number, jobs: GenerationJob[]): SceneState[] {
  return Array.from({ length: sceneCount }, (_, index) => {
    const mine = jobs.filter((job) => clipRequestOf(job).sceneIndex === index);
    const ok = mine.find((job) => job.status === "succeeded");
    if (ok) return { state: "ok", job: ok };
    if (mine.some((job) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status))) return { state: "pending" };
    return { state: "failed" };
  });
}

/**
 * Checks a generating video after its jobs moved. When a scene has used up its
 * chain the video fails, open jobs are canceled and nothing is charged. When
 * every scene has a clip, the charge is split over the winning attempts, the
 * manifest is written, and a render job is queued (once per video).
 */
export async function settleVideo(videoId: string): Promise<void> {
  const db = await getDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video || video.status !== "generating") return;
  const plan = generationPlanOf(video);
  const jobs = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.videoId, videoId), eq(generationJobs.kind, "clip")));
  const states = sceneStates(plan.scenes.length, jobs);

  if (states.some((scene) => scene.state === "failed")) {
    // Settle credits before the status flips, so a retry after a crash still refunds them.
    for (const chargeId of await reservedCharges(videoId)) await releaseCredits(chargeId);
    await db
      .update(generationJobs)
      .set({ status: "canceled", nextPollAt: null, completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(generationJobs.videoId, videoId), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES])));
    const [failed] = await db
      .update(videos)
      .set({ status: "failed", costActualUsd: 0, updatedAt: new Date() })
      .where(and(eq(videos.id, videoId), eq(videos.status, "generating")))
      .returning();
    if (failed) await notify(failed, "failed");
    return;
  }
  if (states.some((scene) => scene.state === "pending")) return;

  const winners = states.map((scene) => (scene.state === "ok" ? scene.job : null)).filter((job): job is GenerationJob => !!job);
  const tier = (video.tier ?? "standard") as Tier;
  const models = plan.scenes.map((scene, index) => ({
    durationS: scene.durationS,
    model: winners[index]?.provider || TIER_MODEL[tier],
  }));
  const charge = chargeForScenes(tier, models);
  // Capture what actually ran (capped at the reservation) before the render is queued; repeat calls change nothing.
  for (const chargeId of await reservedCharges(videoId)) {
    await captureCredits(chargeId, { credits: creditsForScenes(tier, models), costUsd: charge });
  }
  const [render] = await db
    .insert(generationJobs)
    .values({
      workspaceId: video.workspaceId,
      videoId,
      kind: "render",
      provider: "ffmpeg",
      // The unique (provider, provider_job_id) index makes this insert happen once per video.
      providerJobId: `render:${videoId}:1`,
      status: "queued",
      request: { reason: "generate" },
      nextPollAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (!render) return;

  const shares = splitCents(
    Math.round(charge * 100),
    plan.scenes.map((scene) => scene.durationS),
  );
  for (const [index, job] of winners.entries()) {
    await db
      .update(generationAttempts)
      .set({ costUsd: (shares[index] ?? 0) / 100 })
      .where(eq(generationAttempts.jobId, job.id));
  }

  const manifest = stitch({
    hook: plan.hook,
    scenes: plan.scenes.map((scene, index) => ({
      visual: scene.visual,
      line: scene.line,
      durationS: scene.durationS,
      model: models[index]?.model ?? TIER_MODEL[tier],
      frameUrl: ((winners[index]?.response ?? {}) as ClipJobResponse).frameUrl ?? "",
    })),
  });
  manifest.aiGenerated = video.aiGenerated;
  await db.insert(videoRenders).values({ videoId, status: "queued", jobId: render.id, manifest: { reason: "generate" } });
  await db
    .update(videos)
    .set({ model: models[0]?.model ?? TIER_MODEL[tier], manifest, costActualUsd: charge, updatedAt: new Date() })
    .where(eq(videos.id, videoId));
}

/** The video's credit reservations that are not settled yet (normally the one made by `generateVideo`). */
async function reservedCharges(videoId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: creditCharges.id })
    .from(creditCharges)
    .where(and(eq(creditCharges.videoId, videoId), eq(creditCharges.kind, "clip"), eq(creditCharges.status, "reserved")));
  return rows.map((row) => row.id);
}

/** Marks the video ready (with or without a render) and tells the chat if Generate already returned. */
export async function markVideoReady(videoId: string, renderId: string | null): Promise<void> {
  const db = await getDb();
  const [ready] = await db
    .update(videos)
    .set({ status: "ready", ...(renderId ? { currentRenderId: renderId } : {}), updatedAt: new Date() })
    .where(and(eq(videos.id, videoId), eq(videos.status, "generating")))
    .returning();
  if (ready) await notify(ready, "ready");
}

async function notify(video: Video, outcome: "ready" | "failed"): Promise<void> {
  const plan = generationPlanOf(video);
  if (!plan.notifyChat) return;
  const db = await getDb();
  if (outcome === "ready") {
    await db.insert(chatMessages).values({
      workspaceId: video.workspaceId,
      userId: plan.notifyUserId ?? null,
      conversationId: plan.notifyConversationId ?? null,
      role: "assistant",
      content: "The clip finished generating.",
      data: { kind: "ready", videoId: video.id, attemptSummary: await attemptSummaryForVideo(video.id) },
    });
    return;
  }
  await db.insert(chatMessages).values({
    workspaceId: video.workspaceId,
    userId: plan.notifyUserId ?? null,
    conversationId: plan.notifyConversationId ?? null,
    role: "assistant",
    content: `“${video.title}” failed: every model refused or failed this prompt. Nothing was charged.`,
    data: { kind: "note" },
  });
}
