import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { videos } from "@/db/schema";
import { statusLabel } from "@/components/ui";
import { formatUsd } from "@/lib/pricing";
import { defineTool } from "./types";

const STATUSES = ["draft", "planned", "generating", "ready", "approved", "scheduled", "failed"] as const;

export const listVideosTool = defineTool({
  name: "list-videos",
  description:
    "List this workspace's videos, newest first, with id, title, status (ready, approved, scheduled, failed…), tier, and actual cost. Use it to find the video the user means before approving or scheduling. Optionally filter by status.",
  parameters: z.object({
    status: z.enum(STATUSES).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  priority: 12,
  match: (text) => (/^(?:list|show)(?: me)?\s+(?:my |our |all |the )?videos$/i.test(text) ? {} : null),
  async run(ctx, args) {
    const db = await getDb();
    const rows = await db
      .select({
        id: videos.id,
        title: videos.title,
        status: videos.status,
        tier: videos.tier,
        costActualUsd: videos.costActualUsd,
        createdAt: videos.createdAt,
      })
      .from(videos)
      .where(and(eq(videos.workspaceId, ctx.workspace.id), args.status ? eq(videos.status, args.status) : undefined))
      .orderBy(desc(videos.createdAt))
      .limit(args.limit);
    const message = rows.length
      ? rows
          .map(
            (row) =>
              `${row.title || "Untitled"} — ${statusLabel(row.status)}${row.costActualUsd != null ? ` (${formatUsd(Number(row.costActualUsd))})` : ""}`,
          )
          .join("\n")
      : args.status
        ? `No ${statusLabel(args.status).toLowerCase()} videos.`
        : "No videos yet.";
    await ctx.reply(message, {
      kind: "videos",
      videos: rows.map((row) => ({ ...row, costActualUsd: row.costActualUsd == null ? null : Number(row.costActualUsd), createdAt: row.createdAt.toISOString() })),
    });
  },
});
