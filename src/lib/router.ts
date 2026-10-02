import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { avatars, generationAttempts, videos, workspaces } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { remainingBudgetUsd } from "@/lib/budget";
import { stitchClips } from "@/lib/media/stitch";
import {
  estimateClipCost,
  FALLBACK_CHAIN,
  formatUsd,
  TIER_MODEL,
  videoUsdPerSecond,
  type Tier,
} from "@/lib/pricing";
import { videoProvider } from "@/lib/providers/registry";
import {
  ProviderRefusedError,
  type VideoProvider,
} from "@/lib/providers/types";

export { FALLBACK_CHAIN, TIER_MODEL };
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

export type AttemptStatus = "ok" | "refused" | "error";

export type AttemptRecord = {
  sceneIndex: number;
  step: number;
  provider: string;
  status: AttemptStatus;
  detail?: Record<string, unknown>;
};

export type GeneratedScene = {
  index: number;
  visual: string;
  line: string;
  durationS: number;
  model: string;
  frameUrl: string;
  /** Downloaded live clip (storage key). Absent for mock frames. */
  mediaKey?: string;
};

export type StitchedManifest = {
  aiGenerated: boolean;
  hook: string;
  totalDurationS: number;
  scenes: GeneratedScene[];
  captions: { text: string; startS: number; endS: number }[];
};

type SceneRun = {
  ok: boolean;
  model: string;
  frameUrl: string;
  mediaKey?: string;
  attempts: AttemptRecord[];
};

export function parseManifest(value: unknown): StitchedManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StitchedManifest>;
  if (typeof record.hook !== "string" || typeof record.totalDurationS !== "number") return null;
  if (!Array.isArray(record.scenes) || !Array.isArray(record.captions)) return null;
  return {
    aiGenerated: record.aiGenerated !== false,
    hook: record.hook,
    totalDurationS: record.totalDurationS,
    scenes: record.scenes as GeneratedScene[],
    captions: record.captions as StitchedManifest["captions"],
  };
}

export function stitch(input: { hook: string; scenes: Omit<GeneratedScene, "index">[] }): StitchedManifest {
  let cursor = 0;
  const scenes = input.scenes.map((scene, index) => ({ ...scene, index }));
  const captions = scenes.map((scene) => {
    const startS = cursor;
    cursor += scene.durationS;
    return { text: scene.line, startS, endS: roundDuration(cursor) };
  });
  return {
    aiGenerated: true,
    hook: input.hook,
    totalDurationS: roundDuration(cursor),
    scenes,
    captions,
  };
}

function roundDuration(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function formatAttempts(attempts: AttemptRecord[]): string | null {
  if (!attempts.some((attempt) => attempt.status !== "ok")) return null;
  const byScene = new Map<number, AttemptRecord[]>();
  for (const attempt of attempts) {
    const list = byScene.get(attempt.sceneIndex) ?? [];
    list.push(attempt);
    byScene.set(attempt.sceneIndex, list);
  }
  const lines = [...byScene.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) =>
      list
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((attempt) => `${attempt.provider} ${attempt.status}`)
        .join(" → "),
    );
  return [...new Set(lines)].join("; ");
}

export async function generateScenes(input: {
  scenes: { id: string; prompt: string; durationS: number; sceneIndex?: number }[];
  chain: readonly string[];
  resolve?: (id: string) => VideoProvider;
  portraitSvg?: string;
}): Promise<{
  ok: boolean;
  produced: { index: number; model: string; frameUrl: string; durationS: number; mediaKey?: string }[];
  attempts: AttemptRecord[];
}> {
  const resolve = input.resolve ?? videoProvider;
  const settled = await Promise.all(
    input.scenes.map((scene, index) => runScene(scene, index, input.chain, resolve, input.portraitSvg)),
  );
  return {
    ok: settled.every((scene) => scene.ok),
    produced: settled.map((scene, index) => ({
      index,
      model: scene.model,
      frameUrl: scene.frameUrl,
      durationS: input.scenes[index]?.durationS ?? 0,
      ...(scene.mediaKey ? { mediaKey: scene.mediaKey } : {}),
    })),
    attempts: settled.flatMap((scene) => scene.attempts),
  };
}

async function runScene(
  scene: { id: string; prompt: string; durationS: number; sceneIndex?: number },
  index: number,
  chain: readonly string[],
  resolve: (id: string) => VideoProvider,
  portraitSvg?: string,
): Promise<SceneRun> {
  const attempts: AttemptRecord[] = [];
  for (let step = 0; step < chain.length; step += 1) {
    const providerId = chain[step] ?? "";
    try {
      const provider = resolve(providerId);
      const result = await provider.generateClip({
        prompt: scene.prompt,
        durationS: scene.durationS,
        sceneId: scene.id,
        sceneIndex: scene.sceneIndex ?? index,
        portraitSvg,
      });
      attempts.push({ sceneIndex: index, step, provider: providerId, status: "ok" });
      return {
        ok: true,
        model: result.providerId,
        frameUrl: result.frameUrls[0] ?? "",
        ...(result.mediaKey ? { mediaKey: result.mediaKey } : {}),
        attempts,
      };
    } catch (error) {
      const status: AttemptStatus = error instanceof ProviderRefusedError ? "refused" : "error";
      const message = error instanceof Error ? error.message : "failed";
      attempts.push({
        sceneIndex: index,
        step,
        provider: providerId,
        status,
        detail: { message: message.slice(0, 300) },
      });
    }
  }
  return { ok: false, model: "", frameUrl: "", attempts };
}

export function chargeForScenes(
  tier: Tier,
  scenes: { durationS: number; model: string }[],
  voiceOver = false,
): number {
  const durationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const models = new Set(scenes.map((scene) => scene.model));
  if (models.size <= 1) {
    return estimateClipCost({ tier, durationS, model: scenes[0]?.model, voiceOver }).total;
  }
  const fixed = estimateClipCost({ tier, durationS, voiceOver });
  const videoCents = scenes.reduce(
    (sum, scene) => sum + Math.round(videoUsdPerSecond(scene.model) * scene.durationS * 100),
    0,
  );
  return (Math.round(fixed.script * 100) + Math.round(fixed.frames * 100) + Math.round(fixed.voice * 100) + videoCents) / 100;
}

function splitCents(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const raw = weights.map((weight) => (totalCents * weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value));
  let leftover = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - (floors[index] ?? 0) }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of order) {
    if (leftover <= 0) break;
    floors[item.index] = (floors[item.index] ?? 0) + 1;
    leftover -= 1;
  }
  return floors;
}

export async function generateVideo(input: {
  workspaceId: string;
  tier: Tier;
  title: string;
  prompt: string;
  avatarId?: string | null;
  hook: string;
  voiceLines: string[];
  scenes: { visual: string; line: string; durationS: number }[];
}): Promise<{ ok: true; videoId: string; attemptSummary: string | null } | { ok: false; error: string }> {
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
      plan: { hook: input.hook, scenes: input.scenes, voiceLines: input.voiceLines },
      costEstimate: estimate,
      aiGenerated: workspace.aiDisclosureDefault,
    })
    .returning();
  if (!video) return { ok: false, error: "Could not start generation" };

  try {
    const chain = FALLBACK_CHAIN[input.tier];
    const generated = await generateScenes({
      chain,
      portraitSvg,
      scenes: input.scenes.map((scene, index) => ({
        id: `${video.id}:${index}`,
        prompt: `${input.prompt}\n${scene.visual}`,
        durationS: scene.durationS,
        sceneIndex: index,
      })),
    });

    const clipOk = generated.ok;
    const models = generated.produced.map((scene, index) => ({
      durationS: input.scenes[index]?.durationS ?? scene.durationS,
      model: scene.model || TIER_MODEL[input.tier],
    }));
    const charge = clipOk ? chargeForScenes(input.tier, models) : 0;
    const shares = clipOk
      ? splitCents(
          Math.round(charge * 100),
          input.scenes.map((scene) => scene.durationS),
        )
      : [];
    const shareByScene = new Map<number, number>();
    shares.forEach((cents, index) => shareByScene.set(index, cents / 100));

    if (generated.attempts.length > 0) {
      await db.insert(generationAttempts).values(
        generated.attempts.map((attempt) => ({
          videoId: video.id,
          provider: attempt.provider,
          status: attempt.status,
          costUsd: clipOk && attempt.status === "ok" ? (shareByScene.get(attempt.sceneIndex) ?? 0) : 0,
          detail: { sceneIndex: attempt.sceneIndex, step: attempt.step, ...(attempt.detail ?? {}) },
        })),
      );
    }

    const attemptSummary = formatAttempts(generated.attempts);
    if (!clipOk) {
      await db
        .update(videos)
        .set({ status: "failed", model: TIER_MODEL[input.tier], costActualUsd: 0, updatedAt: new Date() })
        .where(eq(videos.id, video.id));
      return { ok: false, error: "Every model refused or failed this prompt. Nothing was charged." };
    }

    const manifest = stitch({
      hook: input.hook,
      scenes: input.scenes.map((scene, index) => ({
        visual: scene.visual,
        line: scene.line,
        durationS: scene.durationS,
        model: generated.produced[index]?.model || TIER_MODEL[input.tier],
        frameUrl: generated.produced[index]?.frameUrl || "",
        ...(generated.produced[index]?.mediaKey ? { mediaKey: generated.produced[index]?.mediaKey } : {}),
      })),
    });
    const mediaKey = await renderIfLive(workspace.id, video.id, manifest);
    const usedModel = manifest.scenes[0]?.model ?? TIER_MODEL[input.tier];
    await db
      .update(videos)
      .set({
        status: "ready",
        model: usedModel,
        manifest,
        mediaKey,
        costActualUsd: charge,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, video.id));
    return { ok: true, videoId: video.id, attemptSummary };
  } catch (error) {
    await db
      .update(videos)
      .set({ status: "failed", costActualUsd: 0, updatedAt: new Date() })
      .where(eq(videos.id, video.id));
    throw error;
  }
}

/**
 * When every scene came back as a real clip (live mode), stitch them with ffmpeg
 * and return the stored MP4 key. Mock scenes are SVG frames and stay a manifest.
 * A stitch failure keeps the video reviewable and is written to the audit log.
 */
export async function renderIfLive(workspaceId: string, videoId: string, manifest: StitchedManifest): Promise<string | null> {
  const keys = manifest.scenes.map((scene) => scene.mediaKey ?? "");
  if (keys.length === 0 || keys.some((key) => !key)) return null;
  try {
    return await stitchClips({ sceneKeys: keys, captions: manifest.captions });
  } catch (error) {
    await writeAudit({
      workspaceId,
      actor: "system",
      action: "video.stitch_failed",
      data: { videoId, message: error instanceof Error ? error.message.slice(0, 300) : "failed" },
    });
    return null;
  }
}
