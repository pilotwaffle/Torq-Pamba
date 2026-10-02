import { z } from "zod";
import { findPlanMessage } from "@/lib/agent/plans";
import { remainingBudgetUsd } from "@/lib/budget";
import { estimateClipCost, formatUsd, TIER_MODEL, type Tier } from "@/lib/pricing";
import { defineTool } from "./types";

const TIERS: Tier[] = ["budget", "standard", "premium"];
const TIER_NAMES: Record<Tier, string> = { budget: "Budget", standard: "Standard", premium: "Premium" };

export const estimateCostTool = defineTool({
  name: "estimate-cost",
  description:
    "Estimate what generating a clip would cost at list price, itemized (script, frames, video, voice) for each quality tier or one tier, and compare it with the monthly budget left. Uses a plan's length when given planMessageId (or the newest plan), otherwise durationS, default 30 seconds. It only estimates; nothing is charged.",
  parameters: z.object({
    planMessageId: z.uuid().optional(),
    durationS: z.number().int().min(1).max(60).optional(),
    tier: z.enum(["budget", "standard", "premium"]).optional(),
  }),
  priority: 13,
  match: (text) =>
    /^(?:estimate(?: the)? cost|how much (?:will|would|does) (?:it|this|that|the video) cost)$/i.test(text) ? {} : null,
  async run(ctx, args) {
    const source = args.durationS && !args.planMessageId ? null : await findPlanMessage(ctx.workspace.id, args.planMessageId);
    if (args.planMessageId && !source) throw new Error("That plan was not found.");
    const durationS = args.durationS ?? source?.plan.durationS ?? 30;
    const tiers = args.tier ? [args.tier] : TIERS;
    const budget = await remainingBudgetUsd(ctx.workspace);
    const estimates = Object.fromEntries(
      tiers.map((tier) => [tier, { ...estimateClipCost({ tier, durationS }), model: TIER_MODEL[tier] }]),
    );
    const lines = [
      `Estimate for ${source ? `“${source.plan.title}” ` : ""}(${durationS}s, list price):`,
      ...tiers.map((tier) => `${TIER_NAMES[tier]} tier (${TIER_MODEL[tier]}): ${formatUsd(estimates[tier]?.total ?? 0)}`),
      `Left in this month’s budget: ${formatUsd(budget.remainingUsd)}.`,
    ];
    await ctx.reply(lines.join("\n"), {
      kind: "estimate",
      durationS,
      planMessageId: source?.messageId ?? null,
      estimates,
      remainingBudgetUsd: budget.remainingUsd,
    });
  },
});
