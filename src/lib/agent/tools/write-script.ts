import { z } from "zod";
import { sceneDurations, type VideoPlan } from "@/lib/agent/plan";
import { resolveAvatar } from "@/lib/agent/plans";
import { defineTool } from "./types";

export const sceneSchema = z.object({
  visual: z.string().trim().min(1).max(400).describe("What the camera shows, written as a shot description."),
  line: z.string().trim().min(1).max(300).describe("What the avatar says in this scene, spoken naturally."),
});
export const hooksSchema = z
  .array(z.string().trim().min(1).max(80))
  .length(3)
  .describe("Three alternative on-screen text hooks, each under about 60 characters.");

export const writeScriptTool = defineTool({
  name: "write-script",
  description:
    "Save a UGC video script you wrote: a title, exactly three scenes (shot plus spoken line), three text-hook options, and optional captions. It becomes a plan card with the price and a Generate button. Nothing is generated or charged. Look up the brand brief first so the script fits the product and audience. For a quick template plan instead, use plan.",
  parameters: z.object({
    title: z.string().trim().min(1).max(80),
    topic: z.string().trim().min(1).max(200).describe("What the video is about, in a few words."),
    durationS: z.number().int().min(3).max(60).default(30).describe("Total length in seconds, split across the three scenes."),
    scenes: z.array(sceneSchema).length(3),
    hooks: hooksSchema,
    captions: z.string().trim().max(1200).optional().describe("Caption text. Defaults to the spoken lines."),
    avatarName: z.string().trim().max(80).optional().describe("A workspace avatar by name. Defaults to the default avatar."),
    tier: z.enum(["budget", "standard", "premium"]).default("standard"),
  }),
  priority: 31,
  match: () => null,
  async run(ctx, args) {
    const avatar = await resolveAvatar(ctx.workspace.id, args.avatarName);
    const durations = sceneDurations(args.durationS);
    const scenes = args.scenes.map((scene, index) => ({ ...scene, durationS: durations[index] ?? 1 }));
    const plan: VideoPlan = {
      topic: args.topic,
      title: args.title,
      count: 1,
      durationS: scenes.reduce((sum, scene) => sum + scene.durationS, 0),
      tier: args.tier,
      sourcePrompt: ctx.text || args.topic,
      avatarId: avatar?.id ?? null,
      avatarName: avatar?.name ?? null,
      scenes,
      hooks: args.hooks as [string, string, string],
      captions: args.captions || scenes.map((scene) => scene.line).join("\n"),
    };
    await ctx.reply(`Here’s the script for “${plan.title}” (${plan.durationS}s). Nothing is generated until you confirm.`, {
      kind: "plan",
      plan,
    });
  },
});
