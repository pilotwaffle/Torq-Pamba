"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/redirects";
import { OnboardingError } from "@/lib/onboarding/errors";
import { FetchSiteError } from "@/lib/onboarding/fetchSite";
import { generateAvatar } from "./generate";
import { AvatarError, saveGeneratedAvatar, saveStockAvatar } from "./store";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof AvatarError || error instanceof OnboardingError || error instanceof FetchSiteError) {
    return error.message;
  }
  return fallback;
}

export async function previewAvatarAction(formData: FormData): Promise<
  | { ok: true; name: string; look: string; svg: string; voiceId: string; costUsd: number }
  | { ok: false; error: string }
> {
  await requireWorkspace();
  const description = field(formData, "description");
  if (!description.trim()) return { ok: false, error: "Describe your avatar" };
  try {
    const avatar = generateAvatar(description);
    return {
      ok: true,
      name: avatar.name,
      look: avatar.look,
      svg: avatar.svg,
      voiceId: avatar.voiceId,
      costUsd: avatar.costUsd,
    };
  } catch (error) {
    return { ok: false, error: userMessage(error, "Could not generate an avatar") };
  }
}

export async function useStockAvatarAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const returnTo = safeNext(field(formData, "returnTo"), "/app/avatars");
  try {
    await saveStockAvatar({
      workspaceId: workspace.id,
      actorUserId: user.id,
      avatarId: field(formData, "avatarId"),
    });
  } catch (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(userMessage(error, "Could not save the avatar"))}`);
  }
  redirect(returnTo);
}

export async function useGeneratedAvatarAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const returnTo = safeNext(field(formData, "returnTo"), "/app/avatars");
  try {
    await saveGeneratedAvatar({
      workspaceId: workspace.id,
      actorUserId: user.id,
      description: field(formData, "description"),
    });
  } catch (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(userMessage(error, "Could not save the avatar"))}`);
  }
  redirect(returnTo);
}
