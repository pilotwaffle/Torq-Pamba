"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { generateFromMessage, handleUserMessage, tierFromForm } from "@/lib/agent/run";

export async function sendMessageAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const text = String(formData.get("message") ?? "");
  if (!text.trim()) redirect("/app/chat?error=Write%20a%20message");
  await handleUserMessage({ workspace, userId: user.id, text });
  redirect("/app/chat");
}

export async function generateAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const { user, workspace } = await requireWorkspace();
  const hook = Number(formData.get("hook") ?? 0);
  const result = await generateFromMessage({
    workspaceId: workspace.id,
    userId: user.id,
    messageId: String(formData.get("messageId") ?? ""),
    tier: tierFromForm(String(formData.get("tier") ?? "")),
    hookIndex: Number.isInteger(hook) && hook >= 0 && hook <= 2 ? hook : 0,
  });
  if (!result.ok) return { error: result.error };
  redirect("/app/chat");
}
