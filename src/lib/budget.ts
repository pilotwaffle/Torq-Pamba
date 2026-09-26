import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { generationAttempts, videos } from "@/db/schema";
import { roundCents } from "@/lib/pricing";
import { monthStart } from "@/lib/time";

export async function monthlySpendUsd(workspaceId: string, timeZone: string, now = new Date()): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ cost: generationAttempts.costUsd })
    .from(generationAttempts)
    .innerJoin(videos, eq(generationAttempts.videoId, videos.id))
    .where(
      and(
        eq(videos.workspaceId, workspaceId),
        eq(generationAttempts.status, "ok"),
        gte(generationAttempts.createdAt, monthStart(now, timeZone)),
      ),
    );
  return roundCents(rows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0));
}

export async function remainingBudgetUsd(
  workspace: { id: string; budgetCapUsd: number; timezone: string },
  now = new Date(),
): Promise<{ spentUsd: number; remainingUsd: number }> {
  const spentUsd = await monthlySpendUsd(workspace.id, workspace.timezone, now);
  return {
    spentUsd,
    remainingUsd: roundCents(Math.max(0, Number(workspace.budgetCapUsd) - spentUsd)),
  };
}
