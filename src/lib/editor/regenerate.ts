import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, generationAttempts, sceneTakes, videoScenes, videos, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { remainingBudgetUsd } from "@/lib/budget";
import { FALLBACK_CHAIN, TIER_MODEL, type Tier } from "@/lib/pricing";
import { BudgetExceededError, type AttemptRecord } from "@/lib/router";
import { defaultTakeJobRunner, takeCharge, type TakeJobRunner } from "./jobs";
import { requireEditable, syncManifest } from "./store";
import { EditorError, MAX_TAKES_PER_SCENE, nextTakeNumber, takePrompt } from "./state";

export type RegenerateResult =
  | { status: "ready"; sceneNumber: number; takeNumber: number; costUsd: number; model: string }
  | { status: "generating"; sceneNumber: number; takeNumber: number }
  | { status: "failed"; sceneNumber: number; takeNumber: number; error: string };

/**
 * Makes a new take for one scene and leaves the other scenes alone. The new
 * take is selected when it finishes; the earlier takes stay available.
 * Checks the monthly budget first and charges only a finished take.
 */
export async function regenerateScene(input: {
  workspace: Pick<Workspace, "id" | "budgetCapUsd" | "timezone">;
  videoId: string;
  sceneNumber: number;
  actor: string;
  direction?: string;
  runner?: TakeJobRunner;
}): Promise<RegenerateResult> {
  const { video, state } = await requireEditable(input.workspace.id, input.videoId);
  const scene = state.scenes.find((item) => item.position === input.sceneNumber - 1);
  if (!scene) throw new EditorError(`This video has no scene ${input.sceneNumber}.`);
  if (scene.takes.some((take) => take.status === "generating" || take.status === "pending")) {
    throw new EditorError(`Scene ${input.sceneNumber} is already regenerating.`);
  }
  if (scene.takes.length >= MAX_TAKES_PER_SCENE) {
    throw new EditorError(`Scene ${input.sceneNumber} already has ${MAX_TAKES_PER_SCENE} takes.`);
  }

  const tier: Tier = video.tier ?? "standard";
  const durationS = scene.durationMs / 1000;
  const estimate = takeCharge(TIER_MODEL[tier], durationS);
  const budget = await remainingBudgetUsd(input.workspace);
  if (Math.round(estimate * 100) > Math.round(budget.remainingUsd * 100)) {
    throw new BudgetExceededError(estimate, budget.remainingUsd);
  }

  const db = await getDb();
  let portraitSvg = "";
  if (video.avatarId) {
    const [avatar] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.id, video.avatarId)).limit(1);
    portraitSvg = avatar?.image ?? "";
  }

  const prompt = takePrompt({ videoPrompt: video.prompt, visual: scene.visual, direction: input.direction });
  const number = nextTakeNumber(scene.takes);
  const [take] = await db
    .insert(sceneTakes)
    .values({ sceneId: scene.id, number, status: "generating", prompt, durationMs: scene.durationMs })
    .onConflictDoNothing()
    .returning({ id: sceneTakes.id });
  if (!take) throw new EditorError(`Scene ${input.sceneNumber} is already regenerating.`);

  const runner = input.runner ?? defaultTakeJobRunner;
  let outcome: Awaited<ReturnType<TakeJobRunner["run"]>>;
  try {
    outcome = await runner.run({
      workspaceId: input.workspace.id,
      videoId: video.id,
      takeId: take.id,
      sceneIndex: scene.position,
      prompt,
      durationS,
      chain: FALLBACK_CHAIN[tier],
      portraitSvg,
    });
  } catch (error) {
    outcome = {
      status: "failed",
      jobId: null,
      error: error instanceof Error ? error.message.slice(0, 300) : "The job failed",
      attempts: [],
    };
  }

  await writeAudit({
    workspaceId: input.workspace.id,
    actor: input.actor,
    action: "video.scene_regenerated",
    data: { videoId: video.id, scene: input.sceneNumber, take: number, status: outcome.status },
  });

  if (outcome.status === "submitted") {
    await db
      .update(sceneTakes)
      .set({ jobId: outcome.jobId, updatedAt: new Date() })
      .where(eq(sceneTakes.id, take.id));
    return { status: "generating", sceneNumber: input.sceneNumber, takeNumber: number };
  }
  if (outcome.status === "failed") {
    await finishTake({ takeId: take.id, ok: false, jobId: outcome.jobId, error: outcome.error, attempts: outcome.attempts });
    return { status: "failed", sceneNumber: input.sceneNumber, takeNumber: number, error: outcome.error };
  }
  await finishTake({ takeId: take.id, ok: true, ...outcome });
  return {
    status: "ready",
    sceneNumber: input.sceneNumber,
    takeNumber: number,
    costUsd: outcome.costUsd,
    model: outcome.model,
  };
}

type FinishInput =
  | {
      takeId: string;
      ok: true;
      jobId: string;
      model: string;
      frameAssetId: string | null;
      clipAssetId: string | null;
      costUsd: number;
      attempts: AttemptRecord[];
    }
  | { takeId: string; ok: false; jobId: string | null; error: string; attempts: AttemptRecord[] };

type WithoutTake<T> = T extends unknown ? Omit<T, "takeId"> : never;
export type JobCompletion = WithoutTake<FinishInput> & { jobId: string };

/**
 * Finishes a take whose job was submitted earlier. Feature a's poller calls
 * this when a `clip` job tied to a take succeeds or fails.
 */
export async function completeTakeJob(input: JobCompletion): Promise<boolean> {
  const db = await getDb();
  const [take] = await db
    .select({ id: sceneTakes.id, status: sceneTakes.status })
    .from(sceneTakes)
    .where(eq(sceneTakes.jobId, input.jobId))
    .limit(1);
  if (!take || take.status !== "generating") return false;
  await finishTake({ ...input, takeId: take.id });
  return true;
}

async function finishTake(input: FinishInput): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .select({ take: sceneTakes, videoId: videoScenes.videoId, sceneId: videoScenes.id, position: videoScenes.position })
    .from(sceneTakes)
    .innerJoin(videoScenes, eq(videoScenes.id, sceneTakes.sceneId))
    .where(eq(sceneTakes.id, input.takeId))
    .limit(1);
  if (!row) return;

  // One attempt row per provider try, so the monthly budget counts the charge and failures cost nothing.
  if (input.attempts.length > 0) {
    const okStep = input.ok ? lastOkStep(input.attempts) : -1;
    await db.insert(generationAttempts).values(
      input.attempts.map((attempt) => ({
        videoId: row.videoId,
        provider: attempt.provider,
        status: attempt.status,
        costUsd: input.ok && attempt.step === okStep ? input.costUsd : 0,
        jobId: input.jobId,
        detail: {
          sceneIndex: row.position,
          step: attempt.step,
          takeNumber: row.take.number,
          ...(attempt.detail ?? {}),
        },
      })),
    );
  }

  if (!input.ok) {
    await db
      .update(sceneTakes)
      .set({ status: "failed", jobId: input.jobId, error: input.error, costUsd: 0, updatedAt: new Date() })
      .where(eq(sceneTakes.id, input.takeId));
    return;
  }

  await db
    .update(sceneTakes)
    .set({
      status: "ready",
      provider: input.model,
      model: input.model,
      jobId: input.jobId,
      posterAssetId: input.frameAssetId,
      clipAssetId: input.clipAssetId,
      costUsd: input.costUsd,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(sceneTakes.id, input.takeId));
  await db
    .update(videoScenes)
    .set({ selectedTakeId: input.takeId, updatedAt: new Date() })
    .where(eq(videoScenes.id, row.sceneId));
  await db
    .update(videos)
    .set({ costActualUsd: sql`coalesce(${videos.costActualUsd}, 0) + ${input.costUsd}`, updatedAt: new Date() })
    .where(eq(videos.id, row.videoId));
  await syncManifest(row.videoId);
}

function lastOkStep(attempts: AttemptRecord[]): number {
  return attempts.filter((attempt) => attempt.status === "ok").reduce((max, attempt) => Math.max(max, attempt.step), -1);
}

/** The most recent video in this workspace that the editor can still change. */
export async function latestEditableVideoId(workspaceId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.workspaceId, workspaceId), inArray(videos.status, ["ready"])))
    .orderBy(desc(videos.createdAt))
    .limit(1);
  return row?.id ?? null;
}
