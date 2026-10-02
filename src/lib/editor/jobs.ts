import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs } from "@/db/schema";
import { clipDeadlineMs, pollDelayMs } from "@/lib/jobs/config";
import { fetchBytes, storeMedia } from "@/lib/media/assets";
import { roundCents, videoUsdPerSecond } from "@/lib/pricing";
import { videoProvider } from "@/lib/providers/registry";
import { ProviderRefusedError, type ClipOutput, type ClipRequest } from "@/lib/providers/types";
import type { AttemptRecord, AttemptStatus } from "@/lib/router";
import { storeTakeAsset } from "./store";

/**
 * The seam between the editor and feature a's job path.
 *
 * `regenerateScene` hands one take to a `TakeJobRunner`. Every run writes a
 * `generation_jobs` row (kind `clip`) and returns either a finished take or a
 * submitted job:
 *
 * - `inlineTakeJobRunner` (today) runs the tier's fallback chain in-process
 *   through the provider registry's submit-and-poll adapters (mock clips with
 *   no keys), stores the clip in `media_assets` for the render, and finishes
 *   the job before returning.
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
        request: {
          takeId: input.takeId,
          sceneIndex: input.sceneIndex,
          prompt: input.prompt,
          durationS: input.durationS,
          chain: [...input.chain],
        },
        submittedAt: new Date(),
        // This runner finishes the job itself; the worker only picks it up after the deadline (a crashed request).
        deadlineAt: new Date(Date.now() + clipDeadlineMs()),
        nextPollAt: new Date(Date.now() + clipDeadlineMs()),
      })
      .returning({ id: generationJobs.id });
    if (!job) return { status: "failed", jobId: null, error: "Could not start the job", attempts: [] };

    const generated = await runTakeChain(input);
    const attempts = generated.attempts;
    const produced = generated.produced;

    if (!produced) {
      const refused = attempts.length > 0 && attempts.every((attempt) => attempt.status === "refused");
      const error = "Every model refused or failed this scene. Nothing was charged.";
      await db
        .update(generationJobs)
        .set({
          status: refused ? "refused" : "failed",
          error,
          response: { attempts },
          nextPollAt: null,
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
        // Lets the render tell a mock take from a real one.
        providerJobId: produced.providerJobId,
        response: { attempts },
        outputAssetId: frameAssetId,
        costUsd,
        nextPollAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
    return {
      status: "succeeded",
      jobId: job.id,
      model: produced.model,
      frameAssetId,
      clipAssetId: produced.clipAssetId,
      costUsd,
      attempts,
    };
  },
};

/** The runner `regenerateScene` uses unless a caller passes one. Feature a points this at its job submitter. */
export const defaultTakeJobRunner: TakeJobRunner = inlineTakeJobRunner;

type TakeChainResult = {
  produced: { model: string; providerJobId: string; frameUrl: string; clipAssetId: string } | null;
  attempts: AttemptRecord[];
};

/**
 * Tries the chain's models in order through feature a's submit-and-poll
 * adapters, waiting for each clip, and stores the winning clip in
 * `media_assets` so the render can use the take.
 */
async function runTakeChain(input: TakeJobInput): Promise<TakeChainResult> {
  const attempts: AttemptRecord[] = [];
  const request: ClipRequest = {
    prompt: input.prompt,
    durationS: input.durationS,
    // A fresh id per take, so the mock's refuse-once rule applies to each regeneration.
    sceneId: input.takeId,
    sceneIndex: input.sceneIndex,
    portraitSvg: input.portraitSvg,
  };
  for (const [step, providerId] of input.chain.entries()) {
    const record = (status: AttemptStatus, message?: string) =>
      attempts.push({
        sceneIndex: input.sceneIndex,
        step,
        provider: providerId,
        status,
        ...(message ? { detail: { message: message.slice(0, 300) } } : {}),
      });
    try {
      const provider = videoProvider(providerId);
      const { providerJobId } = await provider.submitClip(request);
      const deadline = Date.now() + clipDeadlineMs();
      for (let polls = 0; ; polls += 1) {
        const result = await provider.pollClip(providerJobId, request);
        if (result.state === "succeeded") {
          const { bytes, mimeType } = await download(result.output);
          const asset = await storeMedia({ workspaceId: input.workspaceId, kind: "video", source: "generated", bytes, mimeType });
          record("ok");
          return {
            produced: { model: provider.id, providerJobId, frameUrl: result.frameUrl ?? "", clipAssetId: asset.id },
            attempts,
          };
        }
        if (result.state === "failed") {
          record(result.refused ? "refused" : "error", result.message);
          break;
        }
        if (Date.now() + pollDelayMs(polls) > deadline) {
          record("error", "Timed out waiting for the provider");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs(polls)));
      }
    } catch (error) {
      record(error instanceof ProviderRefusedError ? "refused" : "error", error instanceof Error ? error.message : "failed");
    }
  }
  return { produced: null, attempts };
}

async function download(output: ClipOutput): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (output.kind === "bytes") return { bytes: output.bytes, mimeType: output.mimeType };
  return { bytes: await fetchBytes(output.url, output.headers), mimeType: output.mimeType ?? "video/mp4" };
}
