"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { BudgetExceededError } from "@/lib/router";
import { regenerateScene } from "./regenerate";
import { EditorError } from "./state";
import { saveCaptions, saveHooks, selectTake } from "./store";

function editorUrl(videoId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/app/videos/${encodeURIComponent(videoId)}/edit${query ? `?${query}` : ""}`;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof EditorError || error instanceof BudgetExceededError) return error.message;
  return fallback;
}

/** Entries named `<prefix><id>` as `{ id, text }`. */
function prefixed(formData: FormData, prefix: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix) && typeof value === "string") out.push({ id: key.slice(prefix.length), text: value });
  }
  return out;
}

export async function selectTakeAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = String(formData.get("videoId") ?? "");
  let notice: Record<string, string>;
  try {
    await selectTake({ workspaceId: workspace.id, videoId, takeId: String(formData.get("takeId") ?? ""), actor: user.id });
    notice = { saved: "Take selected." };
  } catch (error) {
    notice = { error: messageOf(error, "Could not select that take") };
  }
  redirect(editorUrl(videoId, notice));
}

export async function regenerateSceneAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = String(formData.get("videoId") ?? "");
  const sceneNumber = Number(formData.get("scene") ?? 0);
  let notice: Record<string, string>;
  try {
    const result = await regenerateScene({
      workspace,
      videoId,
      sceneNumber: Number.isInteger(sceneNumber) ? sceneNumber : 0,
      actor: user.id,
      direction: String(formData.get("direction") ?? ""),
    });
    notice =
      result.status === "ready"
        ? { saved: `Scene ${result.sceneNumber} take ${result.takeNumber} is ready and selected.` }
        : result.status === "generating"
          ? { saved: `Scene ${result.sceneNumber} take ${result.takeNumber} is generating.` }
          : { error: result.error };
  } catch (error) {
    notice = { error: messageOf(error, "Could not regenerate that scene") };
  }
  redirect(editorUrl(videoId, notice));
}

export async function saveCaptionsAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = String(formData.get("videoId") ?? "");
  let notice: Record<string, string>;
  try {
    const count = await saveCaptions({ workspaceId: workspace.id, videoId, actor: user.id, edits: prefixed(formData, "caption:") });
    notice = { saved: count === 0 ? "No caption changes." : "Captions saved." };
  } catch (error) {
    notice = { error: messageOf(error, "Could not save the captions") };
  }
  redirect(editorUrl(videoId, notice));
}

export async function saveHooksAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = String(formData.get("videoId") ?? "");
  let notice: Record<string, string>;
  try {
    await saveHooks({
      workspaceId: workspace.id,
      videoId,
      actor: user.id,
      edits: prefixed(formData, "hook:"),
      added: String(formData.get("newHook") ?? ""),
      selected: String(formData.get("selectedHook") ?? ""),
    });
    notice = { saved: "Hooks saved." };
  } catch (error) {
    notice = { error: messageOf(error, "Could not save the hooks") };
  }
  redirect(editorUrl(videoId, notice));
}
