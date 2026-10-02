import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { publishEvents, publishJobs, socialAccounts, videos } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { publicMediaUrl } from "@/lib/media/storage";
import { parseManifest } from "@/lib/router";
import { accessTokenOf } from "./accounts";
import { isPublishLive, tiktokAudited, type Platform } from "./config";
import { facebookPublisher } from "./live/facebook";
import { instagramPublisher } from "./live/instagram";
import { tiktokPublisher } from "./live/tiktok";
import { mockPublisher } from "./mock";
import { assertMetaPrivacy, assertPublishConsent, postCaption, PublishRuleError, type ApprovalRecord } from "./rules";
import type { PublishContext, Publisher } from "./types";

/**
 * The only place a publish happens. Every job re-checks the approval (privacy
 * chosen, music and posting consent) and the platform rules, and every state
 * change lands in publish_events plus the workspace audit log.
 */

const LIVE: Record<Platform, Publisher> = { tiktok: tiktokPublisher, instagram: instagramPublisher, facebook: facebookPublisher };

export type PublisherOverride = Partial<Record<Platform, Publisher>>;

export function selectPublisher(account: { mode: string; platform: Platform }, override?: PublisherOverride): Publisher {
  const injected = override?.[account.platform];
  if (injected) return injected;
  if (account.mode !== "live") return mockPublisher(account.platform);
  if (!isPublishLive(account.platform)) {
    throw new PublishRuleError("This is a live account but PUBLISH_MODE is not live (or app credentials are missing). Nothing was sent.");
  }
  return LIVE[account.platform];
}

export async function logPublishEvent(input: { jobId: string; workspaceId: string; status: string; detail?: Record<string, unknown> }) {
  const db = await getDb();
  await db.insert(publishEvents).values({
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    status: input.status,
    detail: input.detail ?? {},
  });
}

async function recentTikTokAccounts(now: Date): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ accountId: publishJobs.accountId })
    .from(publishJobs)
    .where(
      and(
        eq(publishJobs.platform, "tiktok"),
        eq(publishJobs.mode, "direct"),
        inArray(publishJobs.status, ["processing", "succeeded"]),
        gte(publishJobs.updatedAt, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    );
  return [...new Set(rows.map((row) => row.accountId))];
}

export async function runPublishJob(
  jobId: string,
  options: { publishers?: PublisherOverride; now?: Date; poll?: PublishContext["poll"] } = {},
): Promise<{ ok: boolean; status: "succeeded" | "failed"; error?: string }> {
  const db = await getDb();
  const now = options.now ?? new Date();
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId)).limit(1);
  if (!job) throw new PublishRuleError("Publish job not found");
  if (job.status !== "queued") return { ok: job.status === "succeeded", status: job.status === "succeeded" ? "succeeded" : "failed" };

  const recent = job.platform === "tiktok" ? await recentTikTokAccounts(now) : [];
  const [claimed] = await db
    .update(publishJobs)
    .set({ status: "processing", attempts: job.attempts + 1, updatedAt: new Date() })
    .where(and(eq(publishJobs.id, job.id), eq(publishJobs.status, "queued")))
    .returning({ id: publishJobs.id });
  if (!claimed) return { ok: false, status: "failed", error: "Job was claimed by another worker" };
  const log = (status: string, detail?: Record<string, unknown>) =>
    logPublishEvent({ jobId: job.id, workspaceId: job.workspaceId, status, detail });
  await log("processing", { platform: job.platform, mode: job.mode, attempt: job.attempts + 1 });

  try {
    const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, job.accountId)).limit(1);
    if (!account || account.revokedAt) throw new PublishRuleError("The account was disconnected. Nothing was sent.");
    const [video] = await db.select().from(videos).where(eq(videos.id, job.videoId)).limit(1);
    if (!video || (video.status !== "approved" && video.status !== "scheduled")) {
      throw new PublishRuleError("Only an approved video can be posted.");
    }
    const approval = (video.approval ?? null) as ApprovalRecord | null;
    assertPublishConsent(approval);
    assertMetaPrivacy(job.platform, String(approval?.privacy ?? ""));
    const manifest = parseManifest(video.manifest);
    const publisher = selectPublisher({ mode: account.mode, platform: job.platform }, options.publishers);
    const outcome = await publisher.publish({
      jobId: job.id,
      platform: job.platform,
      mode: job.mode,
      account: { id: account.id, externalId: account.externalId, handle: account.handle, accessToken: accessTokenOf(account) },
      video: {
        id: video.id,
        title: video.title,
        durationS: manifest?.totalDurationS ?? 0,
        caption: postCaption({ hook: manifest?.hook ?? "", title: video.title, captions: (manifest?.captions ?? []).map((c) => c.text) }),
        aiGenerated: video.aiGenerated,
        approval: approval ?? {},
        mediaUrl: video.mediaKey ? publicMediaUrl(video.mediaKey) : null,
      },
      audited: tiktokAudited(),
      recentTikTokAccountIds: recent,
      log,
      poll: options.poll,
    });
    await db
      .update(publishJobs)
      .set({ status: "succeeded", externalId: outcome.externalId, mode: outcome.mode, privacy: outcome.privacy, lastError: null, updatedAt: new Date() })
      .where(eq(publishJobs.id, job.id));
    await log("succeeded", { externalId: outcome.externalId, mode: outcome.mode, privacy: outcome.privacy });
    await writeAudit({
      workspaceId: job.workspaceId,
      actor: "publisher",
      action: "publish.succeeded",
      data: { jobId: job.id, videoId: job.videoId, platform: job.platform, mode: outcome.mode, privacy: outcome.privacy, accountMode: account.mode },
    });
    return { ok: true, status: "succeeded" };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Publish failed").slice(0, 500);
    await db.update(publishJobs).set({ status: "failed", lastError: message, updatedAt: new Date() }).where(eq(publishJobs.id, job.id));
    await log("failed", { message });
    await writeAudit({
      workspaceId: job.workspaceId,
      actor: "publisher",
      action: "publish.failed",
      data: { jobId: job.id, videoId: job.videoId, platform: job.platform, message },
    });
    return { ok: false, status: "failed", error: message };
  }
}
