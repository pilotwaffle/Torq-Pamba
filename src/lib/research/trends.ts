import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { trends, type Trend } from "@/db/schema";
import { DEFAULT_NICHE } from "./fixtures";
import { deriveTrends, growthPct } from "./metrics";
import { isUuid } from "./posts";
import { researchSource } from "./source";
import type { SocialPlatform, SourceTrend } from "./types";

const TREND_TTL_MS = 7 * 86_400_000;

function trendKey(trend: Pick<Trend, "kind" | "label" | "platform">): string {
  return `${trend.kind}:${trend.platform ?? "any"}:${trend.label.toLowerCase()}`;
}

/**
 * Records a new observation of each trend for the niche. Sources without a
 * trend feed get trends derived from a discover pull. Growth comes from the
 * source when it has it, otherwise from the previous observation's volume.
 */
export async function refreshTrends(input: {
  workspaceId: string;
  niche: string;
  platform?: SocialPlatform | null;
}): Promise<Trend[]> {
  const niche = input.niche.trim() || DEFAULT_NICHE.label;
  const source = researchSource(input.platform);
  const platform = input.platform ?? undefined;
  const found: SourceTrend[] = source.trends
    ? await source.trends({ niche, platform })
    : deriveTrends(await source.discover({ niche, platform, limit: 30 }));
  if (found.length === 0) return [];

  const previous = new Map((await listTrends(input.workspaceId, niche)).map((trend) => [trendKey(trend), trend]));
  const top = Math.max(1, ...found.map((trend) => trend.volume ?? 0));
  const now = new Date();
  const db = await getDb();
  return db
    .insert(trends)
    .values(
      found.map((trend) => {
        const before = previous.get(trendKey(trend));
        return {
          workspaceId: input.workspaceId,
          platform: trend.platform,
          kind: trend.kind,
          label: trend.label.slice(0, 200),
          niche,
          volume: trend.volume,
          growthPct: trend.growthPct ?? growthPct(trend.volume, before?.volume ?? null),
          score: trend.score ?? Math.round(((trend.volume ?? 0) / top) * 10_000) / 100,
          url: trend.url,
          data: { source: source.id, sample: source.sample },
          observedAt: now,
          expiresAt: new Date(now.getTime() + TREND_TTL_MS),
        };
      }),
    )
    .returning();
}

/** The latest observation of each trend for a niche (or every niche), best first. */
export async function listTrends(workspaceId: string, niche?: string | null): Promise<Trend[]> {
  const db = await getDb();
  const filters = [eq(trends.workspaceId, workspaceId)];
  if (niche) filters.push(sql`lower(${trends.niche}) = ${niche.toLowerCase()}`);
  const rows = await db
    .select()
    .from(trends)
    .where(and(...filters))
    .orderBy(desc(trends.observedAt))
    .limit(300);
  const latest = new Map<string, Trend>();
  for (const row of rows) {
    const key = `${row.niche ?? ""}:${trendKey(row)}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()].sort((a, b) => (b.growthPct ?? -1e9) - (a.growthPct ?? -1e9) || (b.score ?? 0) - (a.score ?? 0));
}

export async function getTrend(workspaceId: string, id: string): Promise<Trend | null> {
  if (!isUuid(id)) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(trends)
    .where(and(eq(trends.workspaceId, workspaceId), eq(trends.id, id)))
    .limit(1);
  return row ?? null;
}
