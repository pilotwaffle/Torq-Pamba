import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { adHandoffs, publishJobs, videos, type AdHandoff } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sealToken } from "@/lib/publish/crypto";
import { getWorkspaceVideo } from "@/lib/videos";

/**
 * Paid-amplification hand-off. Torq-Pamba never calls the TikTok or Meta
 * marketing APIs (that programmatic path is later and needs its own app
 * review). It tracks the steps, keeps the Spark Ads authorization code sealed,
 * and the customer boosts the post in their own Ads Manager.
 */

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

export type HandoffKind = AdHandoff["kind"];

export const HANDOFF_LABEL: Record<HandoffKind, string> = {
  tiktok_spark: "TikTok Spark Ads",
  meta_partnership: "Meta partnership ads",
};

export const HANDOFF_STEPS: Record<HandoffKind, string[]> = {
  tiktok_spark: [
    "The post must be public on the creator's TikTok account. While the TikTok audit is pending, API posts are private (Only me): switch it to Everyone in the TikTok app first.",
    "The creator opens the post in TikTok, then ... > Ad settings, turns on Ad authorization, and generates a code (choose 7, 30, 60 or 365 days).",
    "Paste that code here so the team has it in one place. It is stored encrypted.",
    "In TikTok Ads Manager, create an ad, choose Spark Ads, and apply the code. Budget, targeting and billing stay in your own Ads Manager.",
  ],
  meta_partnership: [
    "The creator turns on partnership ads in Instagram (Settings > Business tools > Partnership ads) or in their Facebook Page settings, and adds your brand as a partner.",
    "Your brand accepts the partner request in Meta Business Suite.",
    "In Meta Ads Manager, create an ad, choose Partnership ad, and select this post. The ad shows both handles.",
    "Mark the hand-off ready here once the post shows in Ads Manager.",
  ],
};

/** Shape check only; TikTok does not publish a code format (unverified). */
export function validateSparkCode(raw: string): string {
  const code = raw.trim();
  if (!code) throw new HandoffError("Paste the authorization code from TikTok");
  if (/\s/.test(code)) throw new HandoffError("The code has spaces in it. Paste it exactly as TikTok shows it");
  if (code.length < 8 || code.length > 256) throw new HandoffError("That does not look like a Spark Ads code (8-256 characters)");
  if (!/^[A-Za-z0-9#+/=_\-.:]+$/.test(code)) throw new HandoffError("The code has characters TikTok does not use");
  return code;
}

export function codeHint(code: string): string {
  return `…${code.slice(-4)}`;
}

export async function startHandoff(input: {
  workspaceId: string;
  videoId: string;
  kind: HandoffKind;
  creatorHandle: string;
  actor: string;
}): Promise<AdHandoff> {
  const video = await getWorkspaceVideo(input.workspaceId, input.videoId);
  if (!video) throw new HandoffError("Video not found");
  if (video.status !== "approved" && video.status !== "scheduled") throw new HandoffError("Only an approved video can be handed off for ads");
  const handle = input.creatorHandle.trim();
  if (!/^@?[A-Za-z0-9._]{2,30}$/.test(handle)) throw new HandoffError("Enter the creator's handle, for example @creator");
  const db = await getDb();
  const [open] = await db
    .select({ id: adHandoffs.id })
    .from(adHandoffs)
    .where(
      and(
        eq(adHandoffs.workspaceId, input.workspaceId),
        eq(adHandoffs.videoId, video.id),
        eq(adHandoffs.kind, input.kind),
        ne(adHandoffs.status, "revoked"),
      ),
    )
    .limit(1);
  if (open) throw new HandoffError(`${HANDOFF_LABEL[input.kind]} hand-off already exists for this video`);
  const platforms = input.kind === "tiktok_spark" ? ["tiktok"] : ["instagram", "facebook"];
  const jobs = await db
    .select({ id: publishJobs.id, platform: publishJobs.platform })
    .from(publishJobs)
    .where(and(eq(publishJobs.videoId, video.id), eq(publishJobs.status, "succeeded")))
    .orderBy(desc(publishJobs.updatedAt));
  const job = jobs.find((row) => platforms.includes(row.platform)) ?? null;
  const [row] = await db
    .insert(adHandoffs)
    .values({
      workspaceId: input.workspaceId,
      videoId: video.id,
      jobId: job?.id ?? null,
      kind: input.kind,
      creatorHandle: handle.startsWith("@") ? handle : `@${handle}`,
      createdBy: input.actor,
    })
    .returning();
  if (!row) throw new HandoffError("Could not start the hand-off");
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "handoff.started",
    data: { handoffId: row.id, kind: row.kind, videoId: video.id, jobId: row.jobId },
  });
  return row;
}

async function ownHandoff(workspaceId: string, handoffId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(adHandoffs)
    .where(and(eq(adHandoffs.id, handoffId), eq(adHandoffs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new HandoffError("Hand-off not found");
  if (row.status === "revoked") throw new HandoffError("This hand-off was revoked");
  return row;
}

export async function recordSparkCode(input: { workspaceId: string; handoffId: string; code: string; actor: string }) {
  const handoff = await ownHandoff(input.workspaceId, input.handoffId);
  if (handoff.kind !== "tiktok_spark") throw new HandoffError("Only Spark Ads use an authorization code");
  const code = validateSparkCode(input.code);
  const db = await getDb();
  await db
    .update(adHandoffs)
    .set({ codeEnc: sealToken(code), codeHint: codeHint(code), status: "ready", updatedAt: new Date() })
    .where(eq(adHandoffs.id, handoff.id));
  await writeAudit({ workspaceId: input.workspaceId, actor: input.actor, action: "handoff.code_recorded", data: { handoffId: handoff.id } });
}

export async function markPartnershipReady(input: { workspaceId: string; handoffId: string; actor: string; confirmed: boolean }) {
  const handoff = await ownHandoff(input.workspaceId, input.handoffId);
  if (handoff.kind !== "meta_partnership") throw new HandoffError("Only partnership ads are confirmed this way");
  if (!input.confirmed) throw new HandoffError("Confirm the creator added your brand as a partner");
  const db = await getDb();
  await db.update(adHandoffs).set({ status: "ready", updatedAt: new Date() }).where(eq(adHandoffs.id, handoff.id));
  await writeAudit({ workspaceId: input.workspaceId, actor: input.actor, action: "handoff.ready", data: { handoffId: handoff.id } });
}

export async function revokeHandoff(input: { workspaceId: string; handoffId: string; actor: string }) {
  const handoff = await ownHandoff(input.workspaceId, input.handoffId);
  const db = await getDb();
  await db
    .update(adHandoffs)
    .set({ status: "revoked", codeEnc: null, codeHint: null, updatedAt: new Date() })
    .where(eq(adHandoffs.id, handoff.id));
  await writeAudit({ workspaceId: input.workspaceId, actor: input.actor, action: "handoff.revoked", data: { handoffId: handoff.id } });
}

export async function listHandoffs(workspaceId: string, videoId?: string) {
  const db = await getDb();
  return db
    .select({
      id: adHandoffs.id,
      kind: adHandoffs.kind,
      status: adHandoffs.status,
      creatorHandle: adHandoffs.creatorHandle,
      codeHint: adHandoffs.codeHint,
      videoId: adHandoffs.videoId,
      videoTitle: videos.title,
      jobId: adHandoffs.jobId,
      updatedAt: adHandoffs.updatedAt,
    })
    .from(adHandoffs)
    .innerJoin(videos, eq(videos.id, adHandoffs.videoId))
    .where(videoId ? and(eq(adHandoffs.workspaceId, workspaceId), eq(adHandoffs.videoId, videoId)) : eq(adHandoffs.workspaceId, workspaceId))
    .orderBy(desc(adHandoffs.createdAt));
}

export const HANDOFF_STATUS_LABEL: Record<AdHandoff["status"], string> = {
  awaiting_creator: "Waiting on the creator",
  ready: "Ready to boost in Ads Manager",
  revoked: "Revoked",
};
