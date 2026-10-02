import { z } from "zod";
import { formatWhen, scheduleApprovedVideo, tomorrowAt } from "@/lib/schedule";
import { defineTool } from "./types";

export const scheduleTool = defineTool({
  name: "schedule",
  description:
    "Queue the most recent approved video for tomorrow at 9:00 or the next good slot. Queuing is a reminder; it never posts.",
  parameters: z.object({ when: z.enum(["tomorrow-9am", "next-good-slot"]) }),
  priority: 20,
  match(text) {
    if (/\bnext good slot\b/i.test(text)) return { when: "next-good-slot" as const };
    if (/\btomorrow at 9(?::00)?\s*am\b/i.test(text) || /\bschedule it tomorrow\b/i.test(text)) {
      return { when: "tomorrow-9am" as const };
    }
    return null;
  },
  async run(ctx, args) {
    const when = args.when === "tomorrow-9am" ? tomorrowAt(new Date(), ctx.workspace.timezone, 9, 0) : "next";
    const result = await scheduleApprovedVideo({ workspaceId: ctx.workspace.id, actor: ctx.userId, when });
    const message = result.ok
      ? `Scheduled “${result.title}” for ${formatWhen(result.scheduledAt, ctx.workspace.timezone)}.`
      : result.message;
    await ctx.reply(message, { kind: "note" });
  },
});
