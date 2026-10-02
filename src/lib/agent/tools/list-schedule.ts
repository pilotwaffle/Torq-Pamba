import { z } from "zod";
import { formatWhen, listSchedule, scheduleStatusLabel } from "@/lib/schedule";
import { defineTool } from "./types";

export const listScheduleTool = defineTool({
  name: "list-schedule",
  description: "List this workspace's scheduled videos with their times and status.",
  parameters: z.object({}),
  priority: 10,
  match: (text) => (/what(?:'s|’s| is) scheduled/i.test(text) ? {} : null),
  async run(ctx) {
    const items = await listSchedule(ctx.workspace.id);
    const message =
      items.length === 0
        ? "Nothing is scheduled."
        : items
            .map(
              (item) =>
                `${item.title || "Untitled"} — ${formatWhen(item.scheduledAt, ctx.workspace.timezone)} (${scheduleStatusLabel(item.status)})`,
            )
            .join("\n");
    await ctx.reply(message, { kind: "schedule", count: items.length });
  },
});
