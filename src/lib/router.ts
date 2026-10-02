import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, videos, workspaces } from "@/db/schema";
import { remainingBudgetUsd } from "@/lib/budget";
import { enqueueClipJob } from "@/lib/jobs/clips";
import { inlineWaitMs } from "@/lib/jobs/config";
import { attemptSummaryForVideo, type GenerationPlan } from "@/lib/jobs/settle";
import { driveVideo } from "@/lib/jobs/worker";
import { estimateClipCost, FALLBACK_CHAIN, formatUsd, TIER_MODEL, type Tier } from "@/lib/pricing";

export { FALLBACK_CHAIN, TIER_MODEL };
export {
  chargeForScenes,
  formatAttempts,
  parseManifest,
  stitch,
  type AttemptRecord,
  type AttemptStatus,
  type GeneratedScene,
  type StitchedManifest,
} from "@/lib/jobs/manifest";
export const DEFAULT_TIER: Tier = "standard";
export const DEFAULT_MODEL = TIER_MODEL.standard;

export class BudgetExceededError extends Error {
  readonly estimateUsd: number;
  readonly remainingUsd: number;

  constructor(estimateUsd: number, remainingUsd: number) {
    super(
      `This clip is estimated at ${formatUsd(estimateUsd)}, which is over the ${formatUsd(remainingUsd)} left in this month's budget.`,
    );
    this.name = "BudgetExceededError";
    this.estimateUsd = estimateUsd;
    this.remainingUsd = remainingUsd;
  }
}

export type GenerateVideoResult =
  | { ok: true; videoId: string; attemptSummary: string | null; pending?: false }
  /** The jobs are still running; the cron tick or worker finishes them and posts to chat. */
  | { ok: true; videoId: string; attemptSummary: null; pending: true }
  | { ok: false; error: string };

/**
 * Checks the budget, records a `generating` video, and queues one clip job per
 * scene on the first model of the tier's fallback chain. It then drives the
 * job queue for up to `VIDEO_INLINE_WAIT_MS` (mock jobs settle well within
 * that). Anything still running is finished by `/api/cron/tick` or
 * `npm run worker`, not by this request.
 */
export async function generateVideo(input: {
  workspaceId: string;
  tier: Tier;
  title: string;
  prompt: string;
  avatarId?: string | null;
  hook: string;
  voiceLines: string[];
  scenes: { visual: string; line: string; durationS: number }[];
  /** Who to tell in chat when the video settles after Generate has returned. */
  notifyUserId?: string | null;
  /** The chat conversation that message goes to. */
  notifyConversationId?: string | null;
  waitMs?: number;
}): Promise<GenerateVideoResult> {
  const db = await getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
  if (!workspace) return { ok: false, error: "Workspace not found" };

  const durationS = input.scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const estimate = estimateClipCost({ tier: input.tier, durationS });
  const budget = await remainingBudgetUsd(workspace);
  if (Math.round(estimate.total * 100) > Math.round(budget.remainingUsd * 100)) {
    throw new BudgetExceededError(estimate.total, budget.remainingUsd);
  }

  let portraitSvg = "";
  if (input.avatarId) {
    const [avatar] = await db
      .select({ image: avatars.image })
      .from(avatars)
      .where(eq(avatars.id, input.avatarId))
      .limit(1);
    portraitSvg = avatar?.image ?? "";
  }

  const plan: GenerationPlan = { hook: input.hook, scenes: input.scenes, voiceLines: input.voiceLines };
  const [video] = await db
    .insert(videos)
    .values({
      workspaceId: workspace.id,
      avatarId: input.avatarId ?? null,
      title: input.title || "Untitled",
      prompt: input.prompt,
      status: "generating",
      tier: input.tier,
      model: TIER_MODEL[input.tier],
      plan,
      costEstimate: estimate,
      aiGenerated: workspace.aiDisclosureDefault,
    })
    .returning();
  if (!video) return { ok: false, error: "Could not start generation" };

  try {
    const chain = [...FALLBACK_CHAIN[input.tier]];
    for (const [index, scene] of input.scenes.entries()) {
      await enqueueClipJob({
        workspaceId: workspace.id,
        videoId: video.id,
        request: {
          sceneIndex: index,
          step: 0,
          chain,
          prompt: `${input.prompt}\n${scene.visual}`,
          durationS: scene.durationS,
          sceneId: `${video.id}:${index}`,
          ...(portraitSvg ? { portraitSvg } : {}),
        },
      });
    }
  } catch (error) {
    await db
      .update(videos)
      .set({ status: "failed", costActualUsd: 0, updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    throw error;
  }

  const status = await driveVideo(video.id, input.waitMs ?? inlineWaitMs());
  if (status === "generating") {
    // Ask the worker to post the outcome. If the video settled in the meantime, report it now instead.
    const [still] = await db
      .update(videos)
      .set({
        plan: {
          ...plan,
          notifyChat: true,
          notifyUserId: input.notifyUserId ?? null,
          notifyConversationId: input.notifyConversationId ?? null,
        },
      })
      .where(and(eq(videos.id, video.id), eq(videos.status, "generating")))
      .returning({ id: videos.id });
    if (still) return { ok: true, videoId: video.id, attemptSummary: null, pending: true };
  }
  return settledResult(video.id);
}

async function settledResult(videoId: string): Promise<GenerateVideoResult> {
  const db = await getDb();
  const [video] = await db.select({ status: videos.status }).from(videos).where(eq(videos.id, videoId)).limit(1);
  if (video?.status === "failed") {
    return { ok: false, error: "Every model refused or failed this prompt. Nothing was charged." };
  }
  return { ok: true, videoId, attemptSummary: await attemptSummaryForVideo(videoId) };
}
