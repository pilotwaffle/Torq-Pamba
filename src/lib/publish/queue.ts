import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { publishEvents, publishJobs, socialAccounts, type PublishTarget } from "@/db/schema";
import { runPublishJob, type PublisherOverride } from "./dispatch";

export async function enqueuePublishJobs(input: {
  workspaceId: string;
  videoId: string;
  scheduleItemId: string | null;
  targets: PublishTarget[];
}): Promise<string[]> {
  if (input.targets.length === 0) return [];
  const db = await getDb();
  const accounts = await db
    .select({ id: socialAccounts.id, platform: socialAccounts.platform })
    .from(socialAccounts)
    .where(inArray(socialAccounts.id, input.targets.map((target) => target.accountId)));
  const rows = input.targets.flatMap((target) => {
    const account = accounts.find((entry) => entry.id === target.accountId);
    if (!account) return [];
    return [
      {
        workspaceId: input.workspaceId,
        videoId: input.videoId,
        scheduleItemId: input.scheduleItemId,
        accountId: account.id,
        platform: account.platform,
        mode: target.mode,
      },
    ];
  });
  if (rows.length === 0) return [];
  const created = await db.insert(publishJobs).values(rows).returning({ id: publishJobs.id });
  return created.map((row) => row.id);
}

export async function processPublishQueue(
  options: { workspaceId?: string; limit?: number; publishers?: PublisherOverride } = {},
): Promise<{ succeeded: number; failed: number }> {
  const db = await getDb();
  const queued = await db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .where(
      options.workspaceId
        ? and(eq(publishJobs.status, "queued"), eq(publishJobs.workspaceId, options.workspaceId))
        : eq(publishJobs.status, "queued"),
    )
    .orderBy(asc(publishJobs.createdAt))
    .limit(options.limit ?? 20);
  let succeeded = 0;
  let failed = 0;
  for (const job of queued) {
    const result = await runPublishJob(job.id, { publishers: options.publishers });
    if (result.status === "succeeded") succeeded += 1;
    else failed += 1;
  }
  return { succeeded, failed };
}

export async function listPublishJobs(workspaceId: string, videoId?: string) {
  const db = await getDb();
  return db
    .select({
      id: publishJobs.id,
      videoId: publishJobs.videoId,
      platform: publishJobs.platform,
      mode: publishJobs.mode,
      status: publishJobs.status,
      privacy: publishJobs.privacy,
      externalId: publishJobs.externalId,
      lastError: publishJobs.lastError,
      handle: socialAccounts.handle,
      accountMode: socialAccounts.mode,
      updatedAt: publishJobs.updatedAt,
    })
    .from(publishJobs)
    .innerJoin(socialAccounts, eq(socialAccounts.id, publishJobs.accountId))
    .where(videoId ? and(eq(publishJobs.workspaceId, workspaceId), eq(publishJobs.videoId, videoId)) : eq(publishJobs.workspaceId, workspaceId))
    .orderBy(desc(publishJobs.createdAt));
}

export async function listPublishEvents(jobId: string) {
  const db = await getDb();
  return db.select().from(publishEvents).where(eq(publishEvents.jobId, jobId)).orderBy(asc(publishEvents.createdAt));
}

export function publishStatusLabel(status: string, privacy: string): string {
  if (status === "succeeded") {
    if (privacy === "SELF_ONLY") return "Posted (private — Only me)";
    if (privacy === "DRAFT") return "Sent to TikTok drafts";
    if (privacy === "TRIAL_NON_FOLLOWERS") return "Posted as Trial Reel";
    return "Posted";
  }
  if (status === "processing") return "Processing";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Queued";
}
