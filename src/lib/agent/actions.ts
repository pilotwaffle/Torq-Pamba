"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth/guards";
import { createConversation } from "@/lib/agent/conversation";
import { generateFromMessage, tierFromForm } from "@/lib/agent/run";

export async function newConversationAction() {
  const { user, workspace } = await requireWorkspace();
  const conversation = await createConversation(workspace.id, user.id);
  redirect(`/app/chat?c=${conversation.id}`);
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
  // The sidebar credit balance lives in the /app layout.
  revalidatePath("/app", "layout");
  const conversationId = String(formData.get("conversationId") ?? "");
  redirect(z.uuid().safeParse(conversationId).success ? `/app/chat?c=${conversationId}` : "/app/chat");
}
