import { z } from "zod";
import { latestEditableVideoId, regenerateScene } from "@/lib/editor/regenerate";
import { EditorError } from "@/lib/editor/state";
import { formatUsd } from "@/lib/pricing";
import { BudgetExceededError } from "@/lib/router";
import { defineTool } from "./types";

export const regenerateSceneTool = defineTool({
  name: "regenerate-scene",
  description:
    "Make a new take of one scene of a finished, not yet approved video, keeping the other scenes. Charges one clip; refused or failed takes cost nothing.",
  parameters: z.object({
    scene: z.number().int().min(1).max(20),
    videoId: z.uuid().optional(),
    direction: z.string().trim().max(300).optional(),
  }),
  priority: 40,
  match(text) {
    const found = text.match(/^(?:please\s+)?(?:regenerate|redo|reshoot)\s+scene\s+(\d{1,2})(?:\s*[:,-]\s*(.+))?$/i);
    if (!found?.[1]) return null;
    const direction = found[2]?.trim();
    return { scene: Number(found[1]), ...(direction ? { direction } : {}) };
  },
  async run(ctx, args) {
    const videoId = args.videoId ?? (await latestEditableVideoId(ctx.workspace.id));
    if (!videoId) {
      await ctx.reply("There is no finished, unapproved video to edit. Generate one first.", { kind: "note" });
      return;
    }
    try {
      const result = await regenerateScene({
        workspace: ctx.workspace,
        videoId,
        sceneNumber: args.scene,
        actor: ctx.userId,
        direction: args.direction,
      });
      const message =
        result.status === "ready"
          ? `Scene ${result.sceneNumber} has a new take (take ${result.takeNumber}, ${formatUsd(result.costUsd)}). It is selected; earlier takes are still in the editor.`
          : result.status === "generating"
            ? `Scene ${result.sceneNumber} take ${result.takeNumber} is generating.`
            : result.error;
      await ctx.reply(message, { kind: "note", videoId, scene: result.sceneNumber, take: result.takeNumber });
    } catch (error) {
      if (error instanceof EditorError || error instanceof BudgetExceededError) {
        await ctx.reply(error.message, { kind: "note" });
        return;
      }
      throw error;
    }
  },
});
