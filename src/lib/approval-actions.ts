"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { ApprovalError, approveVideo } from "@/lib/videos";
import type { ApprovalDraft, Privacy } from "@/lib/approval";

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function privacyOf(value: string): ApprovalDraft["privacy"] {
  if (value === "public" || value === "friends" || value === "only_me") return value as Privacy;
  return "";
}

export async function approveAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = String(formData.get("videoId") ?? "");
  const commercial = checked(formData, "commercialDisclosure");
  const commercialRaw = String(formData.get("commercialType") ?? "");
  const draft: ApprovalDraft = {
    creatorNickname: String(formData.get("creatorNickname") ?? ""),
    privacy: privacyOf(String(formData.get("privacy") ?? "")),
    allowComments: checked(formData, "allowComments"),
    allowDuet: checked(formData, "allowDuet"),
    allowStitch: checked(formData, "allowStitch"),
    commercialDisclosure: commercial,
    commercialType: commercialRaw === "your_brand" || commercialRaw === "branded_content" ? commercialRaw : "",
    aiGenerated: checked(formData, "aiGenerated"),
    confirmAiOff: checked(formData, "confirmAiOff"),
    musicConsent: checked(formData, "musicConsent"),
    scheduleConsent: checked(formData, "scheduleConsent"),
  };
  try {
    await approveVideo({ workspace, actor: user.id, videoId, draft });
  } catch (error) {
    const message = error instanceof ApprovalError ? error.message : "Could not approve the video";
    redirect(`/app/videos/${videoId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/app/videos/${videoId}`);
}
