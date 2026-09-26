"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { createInvite, updateWorkspace, WorkspaceError } from "@/lib/workspace";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function updateWorkspaceAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const budget = Number(field(formData, "budgetCapUsd"));
  try {
    await updateWorkspace({
      workspaceId: workspace.id,
      actorUserId: user.id,
      name: field(formData, "name"),
      timezone: field(formData, "timezone"),
      budgetCapUsd: budget,
      aiDisclosureDefault: formData.get("aiDisclosureDefault") === "on",
      confirmDisableAiDisclosure: formData.get("confirmDisableAiDisclosure") === "on",
    });
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : "Could not update the workspace";
    redirect(`/app/settings?error=${encodeURIComponent(message)}`);
  }
  redirect("/app/settings?saved=1");
}

export async function createInviteAction() {
  const { user, workspace } = await requireWorkspace();
  let token = "";
  try {
    const invite = await createInvite({
      workspaceId: workspace.id,
      actorUserId: user.id,
    });
    token = invite.token;
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : "Could not create the invite";
    redirect(`/app/settings?error=${encodeURIComponent(message)}`);
  }
  redirect(`/app/settings?invite=${token}`);
}
