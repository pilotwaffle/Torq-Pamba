import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs, videos, type GenerationJob } from "@/db/schema";
import { advanceClipJob } from "./clips";
import { CLAIM_LEASE_MS } from "./config";
import { advanceRenderJob } from "./render";
import { ACTIVE_JOB_STATUSES, settleVideo } from "./settle";

export type ProcessResult = { processed: number; clips: number; renders: number; errors: number };

/** Takes a job for this worker by pushing `next_poll_at` out; another worker that read the same row loses the race. */
async function claim(job: GenerationJob, now: Date): Promise<boolean> {
  const db = await getDb();
  const [claimed] = await db
    .update(generationJobs)
    .set({ nextPollAt: new Date(now.getTime() + CLAIM_LEASE_MS), updatedAt: now })
    .where(
      and(
        eq(generationJobs.id, job.id),
        inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES]),
        or(isNull(generationJobs.nextPollAt), lte(generationJobs.nextPollAt, now)),
      ),
    )
    .returning({ id: generationJobs.id });
  return Boolean(claimed);
}

/**
 * One worker pass: every due clip and render job (optionally for one video)
 * moves one step, then the videos they belong to are settled. Called by the
 * cron tick, `npm run worker`, and inline by Generate.
 */
export async function processJobs(options: { now?: Date; videoId?: string; limit?: number } = {}): Promise<ProcessResult> {
  const now = options.now ?? new Date();
  const db = await getDb();
  const due = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.kind, ["clip", "render"]),
        inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES]),
        or(isNull(generationJobs.nextPollAt), lte(generationJobs.nextPollAt, now)),
        options.videoId ? eq(generationJobs.videoId, options.videoId) : undefined,
      ),
    )
    .orderBy(asc(generationJobs.nextPollAt))
    .limit(options.limit ?? 25);

  const result: ProcessResult = { processed: 0, clips: 0, renders: 0, errors: 0 };
  const touched = new Set<string>();
  const clipJobs = due.filter((job) => job.kind === "clip");
  // Clip jobs wait on the network, so they run side by side; renders are CPU-bound and run one at a time.
  await Promise.all(
    clipJobs.map(async (job) => {
      if (!(await claim(job, now))) return;
      try {
        await advanceClipJob(job, now);
        result.clips += 1;
      } catch (error) {
        result.errors += 1;
        console.error("clip job failed", job.id, error);
      }
      result.processed += 1;
      if (job.videoId) touched.add(job.videoId);
    }),
  );
  for (const videoId of touched) await settleVideo(videoId);

  for (const job of due.filter((item) => item.kind === "render")) {
    if (!(await claim(job, now))) continue;
    try {
      await advanceRenderJob(job, now);
      result.renders += 1;
    } catch (error) {
      result.errors += 1;
      console.error("render job failed", job.id, error);
    }
    result.processed += 1;
  }
  return result;
}

/**
 * Runs passes for one video until it leaves `generating` or `timeoutMs`
 * passes. Mock jobs finish in a few passes; live ones usually outlast the
 * wait and are finished by the cron tick or worker.
 */
export async function driveVideo(videoId: string, timeoutMs: number): Promise<string> {
  const db = await getDb();
  const started = Date.now();
  for (;;) {
    const pass = await processJobs({ videoId });
    const [video] = await db.select({ status: videos.status }).from(videos).where(eq(videos.id, videoId)).limit(1);
    const status = video?.status ?? "failed";
    if (status !== "generating") return status;
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return status;
    if (pass.processed === 0) await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, timeoutMs - elapsed)));
  }
}
