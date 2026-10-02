import { z } from "zod";
import { buildPlan, type VideoPlan } from "@/lib/agent/plan";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { completeLive } from "@/lib/providers/llm";
import { defineTool } from "./types";

const DURATION = String.raw`(\d+)\s*(?:s|sec|secs|seconds?)\b`;

const parameters = z.object({
  count: z.number().int().min(1).max(10),
  durationS: z.number().int().min(1).max(60),
  topic: z.string().trim().min(1),
});

export const planTool = defineTool({
  name: "plan",
  description: "Draft a UGC video plan (scenes, hooks, captions, cost). Nothing is generated until the user clicks Generate.",
  parameters,
  priority: 30,
  match: parseMake,
  async run(ctx, args) {
    const avatars = await listWorkspaceAvatars(ctx.workspace.id);
    const avatar = avatars.find((item) => item.isDefault) ?? avatars[0] ?? null;
    const plan = buildPlan({
      topic: args.topic,
      count: args.count,
      durationS: args.durationS,
      sourcePrompt: ctx.text,
      brief: ctx.workspace.brief,
      avatar: avatar ? { id: avatar.id, name: avatar.name, look: avatar.look } : null,
    });
    const live = await completeLive(planSystem(), planUser(plan)).catch(() => null);
    const lead =
      live?.trim() ||
      `Here’s a ${plan.durationS}s plan${plan.count > 1 ? ` (video 1 of ${plan.count})` : ""}. Nothing is generated until you click Generate.`;
    await ctx.reply(lead, { kind: "plan", plan });
  },
});

function parseMake(text: string): z.input<typeof parameters> | null {
  const match = text.match(/^(?:please\s+)?(?:make|create)\s+(.+)$/i);
  if (!match?.[1]) return null;
  const rest = match[1].trim();
  const about = rest.match(/\bvideos?\b(?:\s+about\s+(.+))?$/i);
  if (!about || about.index == null) return null;
  const topic = (about[1] ?? "").trim();
  if (!topic) return null;
  const head = rest.slice(0, about.index).trim().replace(/^(?:a|an)\s+/i, "");
  let count = 1;
  let durationS = 30;
  const pair = head.match(new RegExp(`^(\\d+)\\s+${DURATION}$`, "i"));
  const onlyDuration = head.match(new RegExp(`^${DURATION}$`, "i"));
  const onlyCount = head.match(/^(\d+)$/);
  if (pair) {
    count = Number(pair[1]);
    durationS = Number(pair[2]);
  } else if (onlyDuration) {
    durationS = Number(onlyDuration[1]);
  } else if (onlyCount) {
    count = Number(onlyCount[1]);
  } else if (head) {
    return null;
  }
  if (!Number.isFinite(count) || !Number.isFinite(durationS)) return null;
  return {
    count: Math.min(10, Math.max(1, Math.round(count))),
    durationS: Math.min(60, Math.max(1, Math.round(durationS))),
    topic,
  };
}

function planSystem(): string {
  return "You write a short UGC video plan. Do not publish the video. Do not add a watermark or logo. Reply in plain sentences.";
}

function planUser(plan: VideoPlan): string {
  return `Topic: ${plan.topic}\nBrand: ${plan.scenes.map((scene) => scene.line).join(" ")}`;
}
