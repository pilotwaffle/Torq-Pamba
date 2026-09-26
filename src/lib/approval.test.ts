import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLog, videos } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { EMPTY_APPROVAL, approvalErrors, canApprove, type ApprovalDraft } from "@/lib/approval";
import { ApprovalError, approveVideo } from "@/lib/videos";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function ready(overrides: Partial<ApprovalDraft> = {}): ApprovalDraft {
  return {
    ...EMPTY_APPROVAL,
    privacy: "only_me",
    musicConsent: true,
    scheduleConsent: true,
    ...overrides,
  };
}

describe("approval validation", () => {
  it("has no default privacy and requires both consents", () => {
    expect(EMPTY_APPROVAL.privacy).toBe("");
    expect(EMPTY_APPROVAL.allowComments).toBe(false);
    expect(EMPTY_APPROVAL.allowDuet).toBe(false);
    expect(EMPTY_APPROVAL.allowStitch).toBe(false);
    expect(EMPTY_APPROVAL.aiGenerated).toBe(true);
    expect(EMPTY_APPROVAL.musicConsent).toBe(false);
    expect(EMPTY_APPROVAL.scheduleConsent).toBe(false);
    expect(canApprove(EMPTY_APPROVAL)).toBe(false);

    expect(canApprove({ ...EMPTY_APPROVAL, musicConsent: true, scheduleConsent: true })).toBe(false);
    expect(canApprove({ ...EMPTY_APPROVAL, privacy: "public", musicConsent: true })).toBe(false);
    expect(approvalErrors(ready())).toEqual([]);
    expect(canApprove(ready())).toBe(true);
    expect(canApprove(ready({ aiGenerated: false }))).toBe(false);
    expect(canApprove(ready({ aiGenerated: false, confirmAiOff: true }))).toBe(true);
    expect(canApprove(ready({ commercialDisclosure: true }))).toBe(false);
    expect(canApprove(ready({ commercialDisclosure: true, commercialType: "your_brand" }))).toBe(true);
  });

  it("approves a ready video and writes an audit log", async () => {
    const { user, workspace } = await signupAccount({
      email: email("approve"),
      password,
      workspaceName: "Approve Co",
    });
    const db = await getDb();
    const [video] = await db
      .insert(videos)
      .values({
        workspaceId: workspace.id,
        title: "Clip",
        status: "ready",
        aiGenerated: true,
        manifest: { aiGenerated: true, hook: "Hi", totalDurationS: 30, scenes: [], captions: [] },
      })
      .returning();
    await expect(
      approveVideo({
        workspace,
        actor: user.id,
        videoId: video!.id,
        draft: { ...EMPTY_APPROVAL, musicConsent: true, scheduleConsent: true },
      }),
    ).rejects.toBeInstanceOf(ApprovalError);

    await approveVideo({
      workspace,
      actor: user.id,
      videoId: video!.id,
      draft: ready({ creatorNickname: "North", aiGenerated: false, confirmAiOff: true }),
    });
    const [saved] = await db.select().from(videos).where(eq(videos.id, video!.id));
    expect(saved?.status).toBe("approved");
    expect(saved?.aiGenerated).toBe(false);
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.some((entry) => entry.action === "video.approved")).toBe(true);
    expect(audits.some((entry) => entry.action === "video.ai_label_disabled")).toBe(true);
  });
});
