import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs } from "@/db/schema";
import { roundCents, videoUsdPerSecond } from "@/lib/pricing";
import { generateScenes, type AttemptRecord } from "@/lib/router";
import { storeTakeAsset } from "./store";

/**
 * The seam between the editor and feature a's job path.
 *
 * `regenerateScene` hands one take to a `TakeJobRunner`. Every run writes a
 * `generation_jobs` row (kind `clip`) and returns either a finished take or a
 * submitted job:
 *
 * - `inlineTakeJobRunner` (today) runs the tier's fallback chain in-process
 *   through the provider registry, which returns mock frames with no keys, and
 *   finishes the job before returning.
 * - Feature a's runner submits to the provider, returns `{ status: "submitted" }`
 *   with the job id, and, when its poller sees the job finish, calls
 *   `completeTakeJob` from `regenerate.ts`. Swap it in by pointing
 *   `defaultTakeJobRunner` at it; nothing else in the editor changes.
 */
export type TakeJobInput = {
  workspaceId: string;
  videoId: string;
  takeId: string;
  sceneIndex: number;
  prompt: string;
  durationS: number;
  /** The tier's fallback chain, cheapest-first as the router uses it. */
  chain: readonly string[];
  portraitSvg?: string;
};

export type TakeJobOutcome =
  | {
      status: "succeeded";
      jobId: string;
      model: string;
      frameAssetId: string | null;
      clipAssetId: string | null;
      costUsd: number;
      attempts: AttemptRecord[];
    }
  | { status: "submitted"; jobId: string; attempts: AttemptRecord[] }
  | { status: "failed"; jobId: string | null; error: string; attempts: AttemptRecord[] };

export interface TakeJobRunner {
  run(input: TakeJobInput): Promise<TakeJobOutcome>;
}

/** Charge for one finished clip: the model's list price per second times the take's length. */
export function takeCharge(model: string, durationS: number): number {
  return roundCents(videoUsdPerSecond(model) * durationS);
}

export const inlineTakeJobRunner: TakeJobRunner = {
  async run(input) {
    const db = await getDb();
    const [job] = await db
      .insert(generationJobs)
      .values({
        workspaceId: input.workspaceId,
        videoId: input.videoId,
        kind: "clip",
        provider: input.chain[0] ?? "unknown",
        status: "running",
        request: { takeId: input.takeId, prompt: input.prompt, durationS: input.durationS, chain: [...input.chain] },
        submittedAt: new Date(),
      })
      .returning({ id: generationJobs.id });
    if (!job) return { status: "failed", jobId: null, error: "Could not start the job", attempts: [] };

    const generated = await generateScenes({
      chain: input.chain,
      portraitSvg: input.portraitSvg,
      scenes: [
        {
          // A fresh id per take, so the mock's refuse-once rule applies to each regeneration.
          id: `${input.takeId}`,
          prompt: input.prompt,
          durationS: input.durationS,
          sceneIndex: input.sceneIndex,
        },
      ],
    });
    const attempts = generated.attempts.map((attempt) => ({ ...attempt, sceneIndex: input.sceneIndex }));
    const produced = generated.produced[0];

    if (!generated.ok || !produced?.model) {
      const refused = attempts.length > 0 && attempts.every((attempt) => attempt.status === "refused");
      const error = "Every model refused or failed this scene. Nothing was charged.";
      await db
        .update(generationJobs)
        .set({
          status: refused ? "refused" : "failed",
          error,
          response: { attempts },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id));
      return { status: "failed", jobId: job.id, error, attempts };
    }

    const costUsd = takeCharge(produced.model, input.durationS);
    const frameAssetId = await storeTakeAsset({ workspaceId: input.workspaceId, url: produced.frameUrl });
    await db
      .update(generationJobs)
      .set({
        status: "succeeded",
        provider: produced.model,
        model: produced.model,
        response: { attempts },
        outputAssetId: frameAssetId,
        costUsd,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
    return {
      status: "succeeded",
      jobId: job.id,
      model: produced.model,
      frameAssetId,
      clipAssetId: null,
      costUsd,
      attempts,
    };
  },
};

/** The runner `regenerateScene` uses unless a caller passes one. Feature a points this at its job submitter. */
export const defaultTakeJobRunner: TakeJobRunner = inlineTakeJobRunner;
