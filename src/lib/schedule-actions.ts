"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { ScheduleError, cancel, parseSlotInput, reschedule, scheduleVideo } from "@/lib/schedule";
import { getWorkspaceVideo } from "@/lib/videos";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function scheduleAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const videoId = text(formData, "videoId");
  const back = videoId ? `/app/videos/${videoId}` : "/app/videos";
  try {
    if (!videoId) throw new ScheduleError("Video not found");
    const video = await getWorkspaceVideo(workspace.id, videoId);
    if (!video) throw new ScheduleError("Video not found");
    if (text(formData, "mode") === "next") {
      await scheduleVideo(video.id, "next", user.id);
    } else {
      const when = parseSlotInput(text(formData, "slot"), workspace.timezone);
      if (!when) throw new ScheduleError("Choose a publish slot");
      await scheduleVideo(video.id, when, user.id);
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
