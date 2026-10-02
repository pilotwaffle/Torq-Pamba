import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationAttempts, videos, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { approvalErrors, type ApprovalDraft } from "@/lib/approval";
import { formatAttempts, parseManifest, type AttemptRecord, type StitchedManifest } from "@/lib/router";

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export async function listVideos(workspaceId: string) {
  const db = await getDb();
  return db
    .select({
      id: videos.id,
      title: videos.title,
      status: videos.status,
      tier: videos.tier,
      createdAt: videos.createdAt,
    })
    .from(videos)
    .where(eq(videos.workspaceId, workspaceId))
    .orderBy(desc(videos.createdAt));
}

export async function getWorkspaceVideo(workspaceId: string, videoId: string) {
  const db = await getDb();
  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, videoId), eq(videos.workspaceId, workspaceId)))
    .limit(1);
  return video ?? null;
}

export async function attemptSummaryFor(videoId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({
      provider: generationAttempts.provider,
      status: generationAttempts.status,
      detail: generationAttempts.detail,
    })
    .from(generationAttempts)
    .where(eq(generationAttempts.videoId, videoId));
  const attempts: AttemptRecord[] = rows.map((row) => {
    const detail = row.detail ?? {};
    return {
      sceneIndex: typeof detail.sceneIndex === "number" ? detail.sceneIndex : 0,
      step: typeof detail.step === "number" ? detail.step : 0,
      provider: row.provider,
      status: row.status,
    };
  });
  return formatAttempts(attempts);
}

export function manifestOf(value: unknown): StitchedManifest | null {
  return parseManifest(value);
}

export async function approveVideo(input: {
  workspace: Workspace;
  actor: string;
  videoId: string;
  draft: ApprovalDraft;
}): Promise<void> {
  const errors = approvalErrors(input.draft);
  if (errors.length > 0) throw new ApprovalError(errors[0] ?? "Approval is incomplete");

  const video = await getWorkspaceVideo(input.workspace.id, input.videoId);
  if (!video) throw new ApprovalError("Video not found");
  if (video.status !== "ready") throw new ApprovalError("Only a finished video can be approved");

  const approval = {
    creatorNickname: input.draft.creatorNickname.trim(),
    privacy: input.draft.privacy,
    allowComments: input.draft.allowComments,
    allowDuet: input.draft.allowDuet,
    allowStitch: input.draft.allowStitch,
    commercialDisclosure: input.draft.commercialDisclosure,
    commercialType: input.draft.commercialDisclosure ? input.draft.commercialType : "",
    aiGenerated: input.draft.aiGenerated,
    musicConsent: input.draft.musicConsent,
    scheduleConsent: input.draft.scheduleConsent,
    approvedAt: new Date().toISOString(),
    // Publishing re-checks that this user is a workspace owner (src/lib/publish/rules.ts).
    approvedBy: input.actor,
    // The render the approver saw. Publishing sends exactly this one, even if the video is re-rendered later.
    approvedRenderId: video.currentRenderId ?? null,
  };
  const manifest =
    video.manifest && typeof video.manifest === "object"
      ? { ...video.manifest, aiGenerated: input.draft.aiGenerated }
      : video.manifest;

  const db = await getDb();
  await db
    .update(videos)
    .set({
      status: "approved",
      aiGenerated: input.draft.aiGenerated,
      approval,
      manifest,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, video.id));

  await writeAudit({
    workspaceId: input.workspace.id,
    actor: input.actor,
    action: "video.approved",
    data: { videoId: video.id, ...approval },
  });
  if (!input.draft.aiGenerated) {
    await writeAudit({
      workspaceId: input.workspace.id,
      actor: input.actor,
      action: "video.ai_label_disabled",
      data: { videoId: video.id, confirmed: true },
    });
  }
}
