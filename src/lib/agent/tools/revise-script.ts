import { z } from "zod";
import { sceneDurations, type VideoPlan } from "@/lib/agent/plan";
import { findPlanMessage, resolveAvatar } from "@/lib/agent/plans";
import { defineTool } from "./types";
import { hooksSchema } from "./write-script";

export const reviseScriptTool = defineTool({
  name: "revise-script",
  description:
    "Revise an existing plan or script and save the result as a new plan card (the old one stays). Change the title, length, tier, avatar, any scene's shot or spoken line (by index 0 to 2), the three hooks, or the captions; anything you leave out is kept. Without planMessageId it revises the newest plan. Nothing is generated or charged.",
  parameters: z.object({
    planMessageId: z.uuid().optional().describe("The plan message id from a plan, write-script, or revise-script result."),
    title: z.string().trim().min(1).max(80).optional(),
    durationS: z.number().int().min(3).max(60).optional(),
    tier: z.enum(["budget", "standard", "premium"]).optional(),
    avatarName: z.string().trim().max(80).optional(),
    scenes: z
      .array(
        z.object({
          index: z.number().int().min(0).max(2),
          visual: z.string().trim().min(1).max(400).optional(),
          line: z.string().trim().min(1).max(300).optional(),
        }),
      )
      .max(3)
      .optional(),
    hooks: hooksSchema.optional(),
    captions: z.string().trim().max(1200).optional(),
  }),
  priority: 35,
  match(text) {
    const found = text.match(/^(?:make it|change (?:it|the length) to)\s+(\d+)\s*(?:s|sec|secs|seconds?)(?:\s+long)?$/i);
    if (!found?.[1]) return null;
    return { durationS: Math.min(60, Math.max(3, Number(found[1]))) };
  },
  async run(ctx, args) {
    const source = await findPlanMessage(ctx.workspace.id, args.planMessageId);
    if (!source) throw new Error("There is no plan to revise yet. Write a script or plan a video first.");
    const before = source.plan;
    const changes: string[] = [];

    let scenes = before.scenes.map((scene) => ({ ...scene }));
    let linesChanged = false;
    for (const edit of args.scenes ?? []) {
      const scene = scenes[edit.index];
      if (!scene) continue;
      if (edit.visual) scene.visual = edit.visual;
      if (edit.line) {
        scene.line = edit.line;
        linesChanged = true;
      }
      changes.push(`scene ${edit.index + 1}`);
    }
    if (args.durationS) {
      const durations = sceneDurations(args.durationS);
      scenes = scenes.map((scene, index) => ({ ...scene, durationS: durations[index] ?? scene.durationS }));
      changes.push(`length ${args.durationS}s`);
    }
    let avatar = { id: before.avatarId, name: before.avatarName };
    if (args.avatarName) {
      const found = await resolveAvatar(ctx.workspace.id, args.avatarName);
      avatar = { id: found?.id ?? null, name: found?.name ?? null };
      changes.push(`avatar ${avatar.name}`);
    }
    if (args.title) changes.push("title");
    if (args.tier) changes.push(`${args.tier} tier`);
    if (args.hooks) changes.push("hooks");
    if (args.captions) changes.push("captions");

    const plan: VideoPlan = {
      ...before,
      title: args.title ?? before.title,
      tier: args.tier ?? before.tier,
      avatarId: avatar.id,
      avatarName: avatar.name,
      scenes,
      durationS: scenes.reduce((sum, scene) => sum + scene.durationS, 0),
      hooks: (args.hooks as [string, string, string] | undefined) ?? before.hooks,
      captions: args.captions ?? (linesChanged ? scenes.map((scene) => scene.line).join("\n") : before.captions),
    };
    const summary = changes.length ? `Changed ${changes.join(", ")}.` : "No changes requested, so this is a copy.";
    await ctx.reply(`Revised “${plan.title}” (${plan.durationS}s). ${summary}`, {
      kind: "plan",
      plan,
      revisedFrom: source.messageId,
    });
  },
});
