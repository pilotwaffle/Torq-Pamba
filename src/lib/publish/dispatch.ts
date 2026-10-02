import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { members, publishAttempts, publishEvents, publishingConnections, videos } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { parseManifest } from "@/lib/router";
import { accessTokenOf, handleOf } from "./accounts";
import { asPlatform, isPublishLive, tiktokAudited, type Platform } from "./config";
import { facebookPublisher } from "./live/facebook";
import { instagramPublisher } from "./live/instagram";
import { tiktokPublisher } from "./live/tiktok";
import { mockPublisher } from "./mock";
import {
  assertAiDisclosure,
  assertMetaPrivacy,
  assertOwnerApproval,
  assertPublishConsent,
  postCaption,
  PublishRuleError,
  type ApprovalRecord,
} from "./rules";
import type { PublishContext, Publisher } from "./types";

/**
 * The only place a publish happens. Every attempt re-checks the approval
 * (given by a workspace owner, privacy chosen, music and posting consent), the
 * platform rules and the AI disclosure (always on), and every state change lands in publish_events plus the
 * workspace audit log. Rows are the foundation's `publish_attempts`:
 * pending -> submitted (claimed) -> published | failed.
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

async function ownerUserIds(workspaceId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.role, "owner")));
  return rows.map((row) => row.userId);
}

async function recentTikTokAccounts(now: Date): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ accountId: publishAttempts.connectionId })
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.platform, "tiktok"),
        eq(publishAttempts.mode, "direct"),
        inArray(publishAttempts.status, ["submitted", "published"]),
        gte(publishAttempts.submittedAt, new Date(now.getTime() - 24 * 3_600_000)),
      ),
    );
  return [...new Set(rows.flatMap((row) => (row.accountId ? [row.accountId] : [])))];
}

export async function runPublishJob(
  jobId: string,
  options: { publishers?: PublisherOverride; now?: Date; poll?: PublishContext["poll"] } = {},
): Promise<{ ok: boolean; status: "succeeded" | "failed"; error?: string }> {
  const db = await getDb();
  const now = options.now ?? new Date();
  const [job] = await db.select().from(publishAttempts).where(eq(publishAttempts.id, jobId)).limit(1);
  if (!job) throw new PublishRuleError("Publish job not found");
  if (job.status !== "pending") return { ok: job.status === "published", status: job.status === "published" ? "succeeded" : "failed" };

  const recent = job.platform === "tiktok" ? await recentTikTokAccounts(now) : [];
  const [claimed] = await db
    .update(publishAttempts)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(and(eq(publishAttempts.id, job.id), eq(publishAttempts.status, "pending")))
    .returning({ id: publishAttempts.id });
  if (!claimed) return { ok: false, status: "failed", error: "Job was claimed by another worker" };
  const log = (status: string, detail?: Record<string, unknown>) =>
    logPublishEvent({ jobId: job.id, workspaceId: job.workspaceId, status, detail });
  await log("processing", { platform: job.platform, mode: job.mode, attempt: job.attempt, aiDisclosure: job.aiDisclosure });

  try {
    const platform = asPlatform(job.platform);
    const [account] = job.connectionId
      ? await db.select().from(publishingConnections).where(eq(publishingConnections.id, job.connectionId)).limit(1)
      : [];
    if (!account || account.revokedAt || account.status === "revoked") {
      throw new PublishRuleError("The account was disconnected. Nothing was sent.");
    }
    const [video] = await db.select().from(videos).where(eq(videos.id, job.videoId)).limit(1);
    if (!video || (video.status !== "approved" && video.status !== "scheduled")) {
      throw new PublishRuleError("Only an approved video can be posted.");
    }
    const approval = (video.approval ?? null) as ApprovalRecord | null;
    assertOwnerApproval(approval, await ownerUserIds(job.workspaceId));
    assertPublishConsent(approval);
    assertMetaPrivacy(platform, String(approval?.privacy ?? ""));
    // Every video is AI-generated, so the AI label is always sent, whatever the video row says.
    assertAiDisclosure(job.aiDisclosure);
    const manifest = parseManifest(video.manifest);
    const publisher = selectPublisher({ mode: account.mode, platform }, options.publishers);
    const outcome = await publisher.publish({
      jobId: job.id,
      platform,
      mode: job.mode,
      account: { id: account.id, externalId: account.externalAccountId, handle: handleOf(account), accessToken: accessTokenOf(account) },
      video: {
        id: video.id,
        title: video.title,
        durationS: manifest?.totalDurationS ?? 0,
        caption: postCaption({ hook: manifest?.hook ?? "", title: video.title, captions: (manifest?.captions ?? []).map((c) => c.text) }),
        aiGenerated: true,
        approval: approval ?? {},
        // Wave 1 merge: the old media_key files are gone. The follow-up commit points this at the
        // current render. Until then live publishers refuse (no MP4 URL); mock publishing is unaffected.
        mediaUrl: null,
      },
      audited: tiktokAudited(),
      recentTikTokAccountIds: recent,
      log,
      poll: options.poll,
    });
    await db
      .update(publishAttempts)
      .set({
        status: "published",
        externalPostId: outcome.externalId,
        mode: outcome.mode,
        privacy: outcome.privacy,
        error: null,
        response: { externalId: outcome.externalId, mode: outcome.mode, privacy: outcome.privacy },
        completedAt: new Date(),
      })
      .where(eq(publishAttempts.id, job.id));
    await log("succeeded", { externalId: outcome.externalId, mode: outcome.mode, privacy: outcome.privacy });
    await writeAudit({
      workspaceId: job.workspaceId,
      actor: "publisher",
      action: "publish.succeeded",
      data: {
        jobId: job.id,
        videoId: job.videoId,
        platform: job.platform,
        mode: outcome.mode,
        privacy: outcome.privacy,
        accountMode: account.mode,
        aiDisclosure: job.aiDisclosure,
      },
    });
    return { ok: true, status: "succeeded" };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Publish failed").slice(0, 500);
    await db.update(publishAttempts).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(publishAttempts.id, job.id));
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
