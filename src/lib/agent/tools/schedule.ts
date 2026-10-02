import { z } from "zod";
import {
  formatWhen,
  parseSlotInput,
  scheduleApprovedVideo,
  ScheduleError,
  scheduleVideo,
  tomorrowAt,
} from "@/lib/schedule";
import { getWorkspaceVideo } from "@/lib/videos";
import { defineTool } from "./types";

export const scheduleTool = defineTool({
  name: "schedule",
  description:
    "Queue an approved video for tomorrow at 9:00, the next good slot (9:00, 12:00 or 18:00 in the workspace timezone), or an exact local time. Without videoId it takes the most recently approved video. Queuing is a reminder; it never posts.",
  parameters: z.object({
    when: z.enum(["tomorrow-9am", "next-good-slot", "at"]),
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional()
      .describe("Local time in the workspace timezone, YYYY-MM-DDTHH:mm. Required when `when` is `at`."),
    videoId: z.uuid().optional(),
  }),
  priority: 20,
  match(text) {
    if (/\bnext good slot\b/i.test(text)) return { when: "next-good-slot" as const };
    if (/\btomorrow at 9(?::00)?\s*am\b/i.test(text) || /\bschedule it tomorrow\b/i.test(text)) {
      return { when: "tomorrow-9am" as const };
    }
    return null;
  },
  async run(ctx, args) {
    const zone = ctx.workspace.timezone;
    let when: Date | "next";
    if (args.when === "at") {
      const parsed = args.at ? parseSlotInput(args.at, zone) : null;
      if (!parsed) throw new Error("Give `at` as a valid local time, YYYY-MM-DDTHH:mm.");
      when = parsed;
    } else {
      when = args.when === "tomorrow-9am" ? tomorrowAt(new Date(), zone, 9, 0) : "next";
    }

    let message: string;
    if (args.videoId) {
      const video = await getWorkspaceVideo(ctx.workspace.id, args.videoId);
      if (!video) throw new Error("That video was not found.");
      try {
        const item = await scheduleVideo(video.id, when, ctx.userId);
        message = `Scheduled “${item.title}” for ${formatWhen(item.scheduledAt, zone)}.`;
      } catch (error) {
        if (!(error instanceof ScheduleError)) throw error;
        message = error.message;
      }
    } else {
      const result = await scheduleApprovedVideo({ workspaceId: ctx.workspace.id, actor: ctx.userId, when });
      message = result.ok ? `Scheduled “${result.title}” for ${formatWhen(result.scheduledAt, zone)}.` : result.message;
    }
    await ctx.reply(message, { kind: "note" });
  },
});
