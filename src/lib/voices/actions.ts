"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/redirects";
import { ProviderRefusedError, ProviderUnavailableError } from "@/lib/providers/types";
import { revokeClone } from "./clone";
import { lipsyncLine, refreshLipsyncJob, type TalkingClip } from "./pipeline";
import { talkingPreviewLine } from "./preview";
import { getAvatar, setAvatarVoice, VoiceError } from "./store";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function withQuery(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export async function setAvatarVoiceAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const returnTo = safeNext(field(formData, "returnTo"), "/app/avatars");
  try {
    await setAvatarVoice({
      workspaceId: workspace.id,
      actorUserId: user.id,
      avatarId: field(formData, "avatarId"),
      voiceId: field(formData, "voiceId"),
      lipsyncModel: field(formData, "lipsyncModel") || undefined,
    });
  } catch (error) {
    if (!(error instanceof VoiceError)) throw error;
    redirect(withQuery(returnTo, "error", error.message));
  }
  redirect(withQuery(returnTo, "voiceSaved", "1"));
}

export type TalkingClipView = Pick<
  TalkingClip,
  "jobId" | "status" | "url" | "mimeType" | "posterUrl" | "durationMs" | "costUsd" | "error" | "mock" | "providerId"
> & { audioUrl: string; audioMimeType: string; voiceName: string };

function view(clip: TalkingClip): TalkingClipView {
  return {
    jobId: clip.jobId,
    status: clip.status,
    url: clip.url,
    mimeType: clip.mimeType,
    posterUrl: clip.posterUrl,
    durationMs: clip.durationMs,
    costUsd: clip.costUsd,
    error: clip.error,
    mock: clip.mock,
    providerId: clip.providerId,
    audioUrl: clip.audio.url,
    audioMimeType: clip.audio.mimeType,
    voiceName: clip.audio.voiceName,
  };
}

/** Voices a sample line for the avatar and lip-syncs it. */
export async function previewTalkingClipAction(
  avatarId: string,
): Promise<{ ok: true; clip: TalkingClipView } | { ok: false; error: string }> {
  const { user, workspace } = await requireWorkspace();
  const avatar = await getAvatar(workspace.id, avatarId);
  if (!avatar) return { ok: false, error: "Unknown avatar" };
  try {
    const clip = await lipsyncLine({
      workspaceId: workspace.id,
      avatarId: avatar.id,
      actorUserId: user.id,
      text: talkingPreviewLine(avatar.name),
    });
    return { ok: true, clip: view(clip) };
  } catch (error) {
    if (error instanceof VoiceError || error instanceof ProviderRefusedError || error instanceof ProviderUnavailableError) {
      return { ok: false, error: `${error.message}. Nothing was charged.` };
    }
    throw error;
  }
}

export async function refreshTalkingClipAction(jobId: string): Promise<{ ok: true; clip: TalkingClipView } | { ok: false; error: string }> {
  const { workspace } = await requireWorkspace();
  const clip = await refreshLipsyncJob({ workspaceId: workspace.id, jobId });
  return clip ? { ok: true, clip: view(clip) } : { ok: false, error: "That clip is no longer available" };
}

export async function revokeCloneAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await revokeClone({ workspaceId: workspace.id, actorUserId: user.id, cloneId: field(formData, "cloneId") });
  } catch (error) {
    if (!(error instanceof VoiceError)) throw error;
    redirect(withQuery("/app/avatars", "cloneError", error.message) + "#voice-clones");
  }
  redirect("/app/avatars?revoked=1#voice-clones");
}
