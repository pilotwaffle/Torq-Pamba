import { z } from "zod";
import { getCreditSummary } from "@/lib/credits/account";
import { formatCredits, quoteClipCredits } from "@/lib/credits/pricing";
import { defineTool } from "./types";

const SUBJECT = String.raw`(?:my |our |the )?(?:credits?(?: balance)?|balance)`;
const ASKS_BALANCE = new RegExp(
  String.raw`^(?:(?:how many credits|how much credit)\b.*|(?:what(?:'s|’s| is| are)|show(?: me)?|check) ${SUBJECT}(?: left)?|${SUBJECT}(?: left)?)$`,
  "i",
);

export const creditBalanceTool = defineTool({
  name: "credit-balance",
  description: "Report this workspace's credit balance, plan, and what a standard 30-second video costs in credits.",
  parameters: z.object({}),
  priority: 40,
  match: (text) => (ASKS_BALANCE.test(text.trim()) ? {} : null),
  async run(ctx) {
    const summary = await getCreditSummary(ctx.workspace.id);
    const standard = quoteClipCredits({ tier: "standard", durationS: 30 }).total;
    const lines = [
      `You have ${formatCredits(summary.balance)} on the ${summary.plan.name} plan.`,
      `A standard 30s video costs ${formatCredits(standard)}.`,
    ];
    if (summary.balance < standard) lines.push("Top up credits or upgrade your plan on the Billing page to keep generating.");
    await ctx.reply(lines.join(" "), {
      kind: "credits",
      balance: summary.balance,
      planId: summary.plan.id,
      standardVideoCredits: standard,
    });
  },
});
