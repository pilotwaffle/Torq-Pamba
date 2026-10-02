import { z } from "zod";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { remainingBudgetUsd } from "@/lib/budget";
import { formatUsd } from "@/lib/pricing";
import { defineTool } from "./types";

export const brandBriefTool = defineTool({
  name: "brand-brief",
  description:
    "Look up the workspace's brand brief (company, niche, what they do, products, audience, tone, website), its avatars with the default marked, the timezone, and the monthly budget left. Call this before writing a script so the script fits the brand. It only reads; it changes nothing.",
  parameters: z.object({}),
  priority: 15,
  match: (text) =>
    /^(?:show(?: me)?|what(?:'s| is)|look up)\s+(?:my |our |the )?(?:brand(?: brief)?|brief)$/i.test(text) ? {} : null,
  async run(ctx) {
    const brief = ctx.workspace.brief ?? {};
    const [avatars, budget] = await Promise.all([listWorkspaceAvatars(ctx.workspace.id), remainingBudgetUsd(ctx.workspace)]);
    const fields: [string, string | undefined][] = [
      ["Company", brief.companyName],
      ["Niche", brief.niche],
      ["What they do", brief.whatTheyDo],
      ["Products", brief.products?.filter((item) => item.trim()).join(", ")],
      ["Audience", brief.audience],
      ["Tone", brief.tone],
      ["Website", brief.websiteUrl],
    ];
    const known = fields.filter(([, value]) => value?.trim());
    const lines = known.length
      ? known.map(([label, value]) => `${label}: ${value?.trim()}`)
      : ["No brand brief yet. Finish onboarding to add one."];
    const defaultAvatar = avatars.find((avatar) => avatar.isDefault) ?? avatars[0];
    lines.push(
      `Avatars: ${avatars.length ? avatars.map((avatar) => (avatar.id === defaultAvatar?.id ? `${avatar.name} (default)` : avatar.name)).join(", ") : "none yet"}`,
      `Budget left this month: ${formatUsd(budget.remainingUsd)} of ${formatUsd(Number(ctx.workspace.budgetCapUsd))}`,
    );
    await ctx.reply(lines.join("\n"), {
      kind: "brief",
      brief,
      timezone: ctx.workspace.timezone,
      avatars: avatars.map((avatar) => ({ id: avatar.id, name: avatar.name, look: avatar.look, isDefault: avatar.id === defaultAvatar?.id })),
      remainingBudgetUsd: budget.remainingUsd,
    });
  },
});
