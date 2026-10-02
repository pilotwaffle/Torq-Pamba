import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { publishAttempts, publishEvents, publishingConnections, videos, type PublishTarget } from "@/db/schema";
import { handleOf } from "./accounts";
import { asPlatform } from "./config";
import { runPublishJob, type PublisherOverride } from "./dispatch";

/**
 * The publish queue is the foundation's `publish_attempts` table: one row per
 * target account, `pending` until the dispatcher claims it. Each row carries
 * `ai_disclosure`, copied from the video, which the dispatcher sends as the
 * platform's AI-generated flag (TikTok `is_aigc`, Instagram `is_ai_generated`).
 */
export async function enqueuePublishJobs(input: {
  workspaceId: string;
  videoId: string;
  scheduleItemId: string | null;
  targets: PublishTarget[];
}): Promise<string[]> {
  if (input.targets.length === 0) return [];
  const db = await getDb();
  const [video] = await db.select({ aiGenerated: videos.aiGenerated }).from(videos).where(eq(videos.id, input.videoId)).limit(1);
  const accounts = await db
    .select({ id: publishingConnections.id, platform: publishingConnections.platform })
    .from(publishingConnections)
    .where(inArray(publishingConnections.id, input.targets.map((target) => target.accountId)));
  const rows = input.targets.flatMap((target) => {
    const account = accounts.find((entry) => entry.id === target.accountId);
    if (!account) return [];
    return [
      {
        workspaceId: input.workspaceId,
        videoId: input.videoId,
        scheduleItemId: input.scheduleItemId,
        connectionId: account.id,
        platform: asPlatform(account.platform),
        mode: target.mode,
        // Disclosed unless the approver confirmed the video is not AI-generated.
        aiDisclosure: video?.aiGenerated ?? true,
      },
    ];
  });
  if (rows.length === 0) return [];
  const created = await db.insert(publishAttempts).values(rows).returning({ id: publishAttempts.id });
  return created.map((row) => row.id);
}

export async function processPublishQueue(
  options: { workspaceId?: string; limit?: number; publishers?: PublisherOverride } = {},
): Promise<{ succeeded: number; failed: number }> {
  const db = await getDb();
  const queued = await db
    .select({ id: publishAttempts.id })
    .from(publishAttempts)
    .where(
      options.workspaceId
        ? and(eq(publishAttempts.status, "pending"), eq(publishAttempts.workspaceId, options.workspaceId))
        : eq(publishAttempts.status, "pending"),
    )
    .orderBy(asc(publishAttempts.createdAt))
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
  const rows = await db
    .select({
      id: publishAttempts.id,
      videoId: publishAttempts.videoId,
      platform: publishAttempts.platform,
      mode: publishAttempts.mode,
      status: publishAttempts.status,
      privacy: publishAttempts.privacy,
      aiDisclosure: publishAttempts.aiDisclosure,
      externalId: publishAttempts.externalPostId,
      lastError: publishAttempts.error,
      displayName: publishingConnections.displayName,
      externalAccountId: publishingConnections.externalAccountId,
      accountMode: publishingConnections.mode,
      createdAt: publishAttempts.createdAt,
      submittedAt: publishAttempts.submittedAt,
      completedAt: publishAttempts.completedAt,
    })
    .from(publishAttempts)
    .leftJoin(publishingConnections, eq(publishingConnections.id, publishAttempts.connectionId))
    .where(
      videoId
        ? and(eq(publishAttempts.workspaceId, workspaceId), eq(publishAttempts.videoId, videoId))
        : eq(publishAttempts.workspaceId, workspaceId),
    )
    .orderBy(desc(publishAttempts.createdAt));
  return rows.map(({ displayName, externalAccountId, createdAt, submittedAt, completedAt, platform, ...row }) => ({
    ...row,
    platform: asPlatform(platform),
    handle: externalAccountId ? handleOf({ displayName, externalAccountId }) : "(disconnected)",
    updatedAt: completedAt ?? submittedAt ?? createdAt,
  }));
}

export async function listPublishEvents(jobId: string) {
  const db = await getDb();
  return db.select().from(publishEvents).where(eq(publishEvents.jobId, jobId)).orderBy(asc(publishEvents.createdAt));
}

export function publishStatusLabel(status: string, privacy: string): string {
  if (status === "published") {
    if (privacy === "SELF_ONLY") return "Posted (private — Only me)";
    if (privacy === "DRAFT") return "Sent to TikTok drafts";
    if (privacy === "TRIAL_NON_FOLLOWERS") return "Posted as Trial Reel";
    return "Posted";
  }
  if (status === "submitted") return "Processing";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  return "Queued";
}
