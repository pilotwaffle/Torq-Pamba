import { z } from "zod";
import { formatCount } from "@/lib/research/metrics";
import { workspaceNiche } from "@/lib/research/posts";
import { refreshTrends } from "@/lib/research/trends";
import { PLATFORM_LABEL, type SocialPlatform } from "@/lib/research/types";
import { defineTool } from "./types";

const PLATFORM_WORDS: Record<string, SocialPlatform> = {
  tiktok: "tiktok",
  instagram: "instagram",
  insta: "instagram",
  ig: "instagram",
  reels: "instagram",
  youtube: "youtube",
  shorts: "youtube",
  facebook: "facebook",
};

const parameters = z.object({
  niche: z.string().trim().min(1).max(120).optional(),
  platform: z.enum(["tiktok", "instagram", "youtube", "facebook"]).optional(),
});

export const findTrendsTool = defineTool({
  name: "find-trends",
  description:
    "Find current short-video trends (hashtags, sounds, formats, topics) for the brand's niche or a given niche, optionally on one platform.",
  parameters,
  priority: 15,
  match(text) {
    const found =
      text.match(/^(?:please\s+)?(?:find|show|get|check)\s+(?:me\s+)?(?:the\s+)?(?:latest\s+|current\s+)?trends(?:\s+(?:in|for|on)\s+(.+))?$/i) ??
      text.match(/^what(?:'s|’s| is| are)\s+(?:the\s+)?(?:trending|trends)(?:\s+(?:in|for|on)\s+(.+))?$/i);
    if (!found) return null;
    const scope = (found[1] ?? "").trim().replace(/^(?:my|our)\s+niche$/i, "");
    if (!scope) return {};
    const platform = PLATFORM_WORDS[scope.toLowerCase().replace(/^the\s+/, "")];
    return platform ? { platform } : { niche: scope };
  },
  async run(ctx, args) {
    const niche = args.niche ?? workspaceNiche(ctx.workspace.brief);
    const rows = await refreshTrends({ workspaceId: ctx.workspace.id, niche, platform: args.platform ?? null });
    const where = `${niche}${args.platform ? ` on ${PLATFORM_LABEL[args.platform]}` : ""}`;
    if (rows.length === 0) {
      await ctx.reply(`I didn’t find trends for ${where} right now.`, { kind: "note" });
      return;
    }
    const top = [...rows].sort((a, b) => (b.growthPct ?? -1e9) - (a.growthPct ?? -1e9)).slice(0, 5);
    const lines = top.map((trend) => {
      const growth = trend.growthPct != null ? `, ${trend.growthPct > 0 ? "+" : ""}${Math.round(trend.growthPct)}%` : "";
      const label = trend.kind === "hashtag" ? `#${trend.label}` : trend.label;
      return `• ${label} (${trend.kind}${trend.volume ? `, ${formatCount(trend.volume)} views` : ""}${growth})`;
    });
    await ctx.reply(
      `Trends for ${where}:\n${lines.join("\n")}\nSay “give me video ideas” or open Research to turn one into a video.`,
      { kind: "trends", count: rows.length },
    );
  },
});
