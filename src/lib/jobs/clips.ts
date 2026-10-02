import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationAttempts, generationJobs, videos, type GenerationJob } from "@/db/schema";
import { fetchBytes, storeMedia } from "@/lib/media/assets";
import { isMockJob } from "@/lib/providers/mock";
import { videoProvider } from "@/lib/providers/registry";
import {
  ProviderRefusedError,
  ProviderUnavailableError,
  type ClipOutput,
  type ClipRequest,
} from "@/lib/providers/types";
import { clipDeadlineMs, MAX_POLL_ERRORS, MAX_SUBMIT_RETRIES, pollDelayMs, retryDelayMs } from "./config";

/** What a clip job row stores in `request`. One job is one scene on one step of the fallback chain. */
export type ClipJobRequest = {
  sceneIndex: number;
  step: number;
  chain: string[];
  prompt: string;
  durationS: number;
  sceneId?: string;
  portraitSvg?: string;
  imageUrl?: string;
  audioUrl?: string;
  submitRetries?: number;
};

export type ClipJobResponse = {
  pollErrors?: number;
  progress?: number;
  durationS?: number;
  frameUrl?: string;
  message?: string;
};

export function clipRequestOf(job: GenerationJob): ClipJobRequest {
  const request = (job.request ?? {}) as Partial<ClipJobRequest>;
  return {
    sceneIndex: request.sceneIndex ?? 0,
    step: request.step ?? 0,
    chain: request.chain ?? [job.provider],
    prompt: request.prompt ?? "",
    durationS: request.durationS ?? 0,
    sceneId: request.sceneId,
    portraitSvg: request.portraitSvg,
    imageUrl: request.imageUrl,
    audioUrl: request.audioUrl,
    submitRetries: request.submitRetries ?? 0,
  };
}

function providerRequest(request: ClipJobRequest): ClipRequest {
  return {
    prompt: request.prompt,
    durationS: request.durationS,
    sceneId: request.sceneId,
    sceneIndex: request.sceneIndex,
    portraitSvg: request.portraitSvg,
    imageUrl: request.imageUrl,
    audioUrl: request.audioUrl,
  };
}

export async function enqueueClipJob(input: {
  workspaceId: string;
  videoId: string;
  request: ClipJobRequest;
  now?: Date;
}): Promise<GenerationJob> {
  const provider = input.request.chain[input.request.step] ?? "";
  const db = await getDb();
  const [job] = await db
    .insert(generationJobs)
    .values({
      workspaceId: input.workspaceId,
      videoId: input.videoId,
      kind: "clip",
      provider,
      model: provider,
      status: "queued",
      request: input.request,
      nextPollAt: input.now ?? new Date(),
    })
    .returning();
  if (!job) throw new Error("Could not queue the clip job");
  return job;
}

async function update(jobId: string, values: Partial<typeof generationJobs.$inferInsert>) {
  const db = await getDb();
  await db
    .update(generationJobs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(generationJobs.id, jobId));
}

/**
 * Moves one clip job forward: submit a queued job, or poll a submitted one.
 * Refusals, permanent errors, exhausted retries and timeouts end the job and
 * queue the next model in the chain. Success downloads the clip into media_assets.
 */
export async function advanceClipJob(job: GenerationJob, now = new Date()): Promise<void> {
  if (job.videoId) {
    // A video that already failed (another scene ran out of models) needs no more provider calls.
    // Ready videos still take jobs, so the editor can regenerate a single scene.
    const db = await getDb();
    const [video] = await db.select({ status: videos.status }).from(videos).where(eq(videos.id, job.videoId)).limit(1);
    if (!video || video.status === "failed") {
      await update(job.id, { status: "canceled", nextPollAt: null, completedAt: now });
      return;
    }
  }
  if (job.status === "queued") {
    await submit(job, now);
    return;
  }
  if (job.status === "submitted" || job.status === "running") {
    await poll(job, now);
  }
}

async function submit(job: GenerationJob, now: Date): Promise<void> {
  const request = clipRequestOf(job);
  try {
    const provider = videoProvider(job.provider);
    const submitted = await provider.submitClip(providerRequest(request));
    const mock = isMockJob(submitted.providerJobId);
    await update(job.id, {
      status: "submitted",
      providerJobId: submitted.providerJobId,
      submittedAt: now,
      // Mock jobs are ready at once; live ones get their first poll a few seconds later.
      nextPollAt: mock ? now : new Date(now.getTime() + pollDelayMs(0)),
      deadlineAt: new Date(now.getTime() + clipDeadlineMs()),
      error: null,
    });
  } catch (error) {
    const message = errorMessage(error);
    if (error instanceof ProviderRefusedError) {
      await finish(job, request, "refused", message);
      return;
    }
    const retries = request.submitRetries ?? 0;
    if (error instanceof ProviderUnavailableError && error.retryable && retries < MAX_SUBMIT_RETRIES) {
      await update(job.id, {
        request: { ...request, submitRetries: retries + 1 },
        nextPollAt: new Date(now.getTime() + retryDelayMs(retries)),
        error: message,
      });
      return;
    }
    await finish(job, request, "failed", message);
  }
}

async function poll(job: GenerationJob, now: Date): Promise<void> {
  const request = clipRequestOf(job);
  const response = (job.response ?? {}) as ClipJobResponse;
  if (job.deadlineAt && now.getTime() > job.deadlineAt.getTime()) {
    await finish(job, request, "timed_out", "Timed out waiting for the provider");
    return;
  }
  try {
    const provider = videoProvider(job.provider);
    const result = await provider.pollClip(job.providerJobId ?? "", providerRequest(request));
    if (result.state === "pending") {
      await update(job.id, {
        status: "running",
        pollCount: job.pollCount + 1,
        lastPolledAt: now,
        nextPollAt: new Date(now.getTime() + pollDelayMs(job.pollCount + 1)),
        response: { ...response, pollErrors: 0, progress: result.progress },
      });
      return;
    }
    if (result.state === "failed") {
      await finish(job, request, result.refused ? "refused" : "failed", result.message);
      return;
    }
    const { bytes, mimeType } = await download(result.output);
    const asset = await storeMedia({
      workspaceId: job.workspaceId,
      kind: "video",
      source: "generated",
      bytes,
      mimeType,
    });
    const durationS = result.durationS ?? (asset.durationMs ? asset.durationMs / 1000 : request.durationS);
    await finish(job, request, "succeeded", undefined, {
      outputAssetId: asset.id,
      pollCount: job.pollCount + 1,
      lastPolledAt: now,
      costUsd: Math.round(provider.pricePerSecondUsd * request.durationS * 100) / 100,
      response: { ...response, pollErrors: 0, durationS, frameUrl: result.frameUrl },
    });
  } catch (error) {
    const pollErrors = (response.pollErrors ?? 0) + 1;
    const retryable = !(error instanceof ProviderUnavailableError) || error.retryable;
    if (retryable && pollErrors < MAX_POLL_ERRORS) {
      await update(job.id, {
        pollCount: job.pollCount + 1,
        lastPolledAt: now,
        nextPollAt: new Date(now.getTime() + retryDelayMs(pollErrors)),
        response: { ...response, pollErrors },
        error: errorMessage(error),
      });
      return;
    }
    await finish(job, request, error instanceof ProviderRefusedError ? "refused" : "failed", errorMessage(error), {
      pollCount: job.pollCount + 1,
      lastPolledAt: now,
      response: { ...response, pollErrors },
    });
  }
}

async function download(output: ClipOutput): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (output.kind === "bytes") return { bytes: output.bytes, mimeType: output.mimeType };
  const bytes = await fetchBytes(output.url, output.headers);
  return { bytes, mimeType: output.mimeType ?? "video/mp4" };
}

type Terminal = "succeeded" | "refused" | "failed" | "timed_out";

/** Ends the job, records the attempt (cost 0 until the whole video succeeds), and queues the next chain step on failure. */
async function finish(
  job: GenerationJob,
  request: ClipJobRequest,
  status: Terminal,
  message?: string,
  extra: Partial<typeof generationJobs.$inferInsert> = {},
): Promise<void> {
  const now = new Date();
  await update(job.id, {
    ...extra,
    status,
    completedAt: now,
    nextPollAt: null,
    error: message ? message.slice(0, 500) : null,
  });
  const db = await getDb();
  if (job.videoId) {
    await db.insert(generationAttempts).values({
      videoId: job.videoId,
      jobId: job.id,
      provider: job.provider,
      status: status === "succeeded" ? "ok" : status === "refused" ? "refused" : "error",
      costUsd: 0,
      detail: {
        sceneIndex: request.sceneIndex,
        step: request.step,
        ...(message ? { message: message.slice(0, 300) } : {}),
      },
    });
  }
  const nextStep = request.step + 1;
  if (status !== "succeeded" && job.videoId && nextStep < request.chain.length) {
    await enqueueClipJob({
      workspaceId: job.workspaceId,
      videoId: job.videoId,
      request: { ...request, step: nextStep, submitRetries: 0 },
    });
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
