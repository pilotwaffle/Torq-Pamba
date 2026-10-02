"use server";

import { redirect } from "next/navigation";
import type { PublishTarget } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/publish/accounts";
import { processPublishQueue } from "@/lib/publish/queue";
import { ScheduleError, cancel, parseSlotInput, processDueItems, reschedule, scheduleVideo } from "@/lib/schedule";
import { getWorkspaceVideo } from "@/lib/videos";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function targetsFrom(formData: FormData): PublishTarget[] {
  return formData
    .getAll("target")
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((accountId) => ({ accountId, mode: text(formData, `mode-${accountId}`) }));
}

export async function scheduleAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = text(formData, "videoId");
  const back = videoId ? `/app/videos/${videoId}` : "/app/videos";
  try {
    if (!videoId) throw new ScheduleError("Video not found");
    const video = await getWorkspaceVideo(workspace.id, videoId);
    if (!video) throw new ScheduleError("Video not found");
    const targets = targetsFrom(formData);
    const mode = text(formData, "mode");
    if (mode === "now") {
      if (targets.length === 0) throw new ScheduleError("Choose at least one connected account to post now");
      await scheduleVideo(video.id, new Date(), user.id, targets);
      // Mock accounts post right away. Live accounts wait for the next cron tick,
      // because platform processing can take minutes.
      const accounts = await listAccounts(workspace.id);
      const allMock = targets.every((target) => accounts.find((account) => account.id === target.accountId)?.mode !== "live");
      if (allMock) {
        await processDueItems(new Date(), { workspaceId: workspace.id });
        await processPublishQueue({ workspaceId: workspace.id });
      }
    } else if (mode === "next") {
      await scheduleVideo(video.id, "next", user.id, targets);
    } else {
      const when = parseSlotInput(text(formData, "slot"), workspace.timezone);
      if (!when) throw new ScheduleError("Choose a publish slot");
      await scheduleVideo(video.id, when, user.id, targets);
    }
  } catch (error) {
    const message = error instanceof ScheduleError ? error.message : "Could not schedule the video";
    redirect(`${back}?error=${encodeURIComponent(message)}`);
  }
  redirect(back);
}

export async function rescheduleAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    const when = parseSlotInput(text(formData, "slot"), workspace.timezone);
    if (!when) throw new ScheduleError("Choose a publish slot");
    await reschedule(text(formData, "itemId"), when, user.id, workspace.id);
  } catch (error) {
    const message = error instanceof ScheduleError ? error.message : "Could not reschedule";
    redirect(`/app/schedule?error=${encodeURIComponent(message)}`);
  }
  redirect("/app/schedule");
}

export async function cancelAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await cancel(text(formData, "itemId"), user.id, workspace.id);
  } catch (error) {
    const message = error instanceof ScheduleError ? error.message : "Could not cancel";
    redirect(`/app/schedule?error=${encodeURIComponent(message)}`);
  }
  redirect("/app/schedule");
}
