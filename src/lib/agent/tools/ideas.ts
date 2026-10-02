import { z } from "zod";
import { generateIdeas, listIdeas } from "@/lib/research/ideas";
import { defineTool } from "./types";

const parameters = z.object({
  action: z.enum(["list", "generate"]),
  count: z.number().int().min(1).max(10).optional(),
});

export const ideasTool = defineTool({
  name: "ideas",
  description:
    "Generate brand-specific video ideas from the brand brief plus research (trends and viral posts), or list the workspace's saved ideas. Generating ideas costs no credits and makes no video.",
  parameters,
  priority: 25,
  match(text) {
    if (/^(?:show|list|see|what are)\s+(?:me\s+)?(?:my|our|the)?\s*(?:saved\s+)?(?:video\s+)?ideas$/i.test(text)) {
      return { action: "list" as const };
    }
    const generate = text.match(
      /^(?:please\s+)?(?:give me|suggest|generate|get|find|brainstorm|come up with)\s+(?:me\s+)?(?:(\d+)\s+)?(?:new\s+|more\s+|fresh\s+)?(?:video\s+)?ideas(?:\s+for\s+(?:my|our|the)\s+brand)?$/i,
    );
    if (generate) return { action: "generate" as const, count: generate[1] ? Number(generate[1]) : 5 };
    return null;
  },
  async run(ctx, args) {
    if (args.action === "generate") {
      const result = await generateIdeas({ workspace: ctx.workspace, userId: ctx.userId, count: args.count ?? 5 });
      if (result.ideas.length === 0) {
        await ctx.reply("I didn’t come up with anything new this time. Refresh Discover or Trends in Research and ask again.", {
          kind: "note",
        });
        return;
      }
      const lines = result.ideas.map((idea, index) => `${index + 1}. ${idea.title}${idea.hook ? ` — “${idea.hook}”` : ""}`);
      await ctx.reply(
        `${result.ideas.length} new video idea${result.ideas.length === 1 ? "" : "s"}:\n${lines.join("\n")}\nOpen Research → Ideas and click Make this video to plan one.`,
        { kind: "ideas", ideaIds: result.ideas.map((idea) => idea.id) },
      );
      return;
    }
    const rows = (await listIdeas(ctx.workspace.id, { limit: 10 })).filter((idea) => idea.status !== "used");
    if (rows.length === 0) {
      await ctx.reply("No open ideas yet. Say “give me video ideas” to generate some.", { kind: "note" });
      return;
    }
    const lines = rows.map((idea, index) => `${index + 1}. ${idea.title}${idea.status === "saved" ? " (saved)" : ""}`);
    await ctx.reply(`Your ideas:\n${lines.join("\n")}`, { kind: "ideas", ideaIds: rows.map((idea) => idea.id) });
  },
});
