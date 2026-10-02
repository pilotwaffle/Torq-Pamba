import { z } from "zod";
import { findPlanMessage } from "@/lib/agent/plans";
import { generateFromMessage } from "@/lib/agent/run";
import { remainingBudgetUsd } from "@/lib/budget";
import { estimateClipCost, formatUsd, TIER_MODEL } from "@/lib/pricing";
import { getWorkspaceVideo } from "@/lib/videos";
import { defineTool } from "./types";

const parameters = z.object({
  planMessageId: z.uuid().optional().describe("The plan to generate. Defaults to the newest plan not generated yet."),
  tier: z.enum(["budget", "standard", "premium"]).optional().describe("Quality tier. Defaults to the plan's tier."),
  hookIndex: z.number().int().min(0).max(2).default(0).describe("Which of the plan's three hooks to overlay."),
});

async function resolvePlan(workspaceId: string, planMessageId?: string) {
  const source = await findPlanMessage(workspaceId, planMessageId, { ungenerated: !planMessageId });
  if (!source) throw new Error("No plan is waiting to be generated. Write a script or plan a video first.");
  if (source.generatedVideoId) throw new Error(`That plan was already generated as video ${source.generatedVideoId}.`);
  return source;
}

export const startGenerationTool = defineTool({
  name: "start-generation",
  description:
    "Generate the video for a plan: the scenes render through the tier's model chain and the clip's cost is charged against the monthly budget (failed attempts cost nothing). This spends money, so the chat shows the user a confirmation card with the estimate and nothing runs until they confirm. Call it only when the user asks to generate.",
  parameters,
  priority: 45,
  match: (text) => (/^(?:generate|render)(?:\s+(?:it|this|that|the (?:video|clip|plan)))?$/i.test(text) ? {} : null),
  async confirm(ctx, args) {
    const source = await resolvePlan(ctx.workspace.id, args.planMessageId);
    const plan = source.plan;
    const tier = args.tier ?? plan.tier;
    const estimate = estimateClipCost({ tier, durationS: plan.durationS });
    const budget = await remainingBudgetUsd(ctx.workspace);
    if (Math.round(estimate.total * 100) > Math.round(budget.remainingUsd * 100)) {
      throw new Error(
        `This clip is estimated at ${formatUsd(estimate.total)}, which is over the ${formatUsd(budget.remainingUsd)} left in this month's budget.`,
      );
    }
    return {
      title: `Generate “${plan.title}”`,
      lines: [
        `${plan.durationS}s · ${tier} tier · ${TIER_MODEL[tier]}`,
        `Hook: ${plan.hooks[args.hookIndex] ?? plan.hooks[0]}`,
        ...(plan.avatarName ? [`Avatar: ${plan.avatarName}`] : []),
        `Left in this month’s budget: ${formatUsd(budget.remainingUsd)}`,
      ],
      costUsd: estimate.total,
      confirmLabel: `Confirm and generate (est. ${formatUsd(estimate.total)})`,
      args: { planMessageId: source.messageId, tier, hookIndex: args.hookIndex },
    };
  },
  async run(ctx, args) {
    const source = await resolvePlan(ctx.workspace.id, args.planMessageId);
    const result = await generateFromMessage({
      workspaceId: ctx.workspace.id,
      userId: ctx.userId,
      messageId: source.messageId,
      tier: args.tier ?? source.plan.tier,
      hookIndex: args.hookIndex,
      async reply(content, data) {
        const videoId = typeof data.videoId === "string" ? data.videoId : "";
        const video = videoId ? await getWorkspaceVideo(ctx.workspace.id, videoId) : null;
        await ctx.reply(content, { ...data, costUsd: Number(video?.costActualUsd ?? 0) });
      },
    });
    if (!result.ok) throw new Error(result.error);
  },
});
