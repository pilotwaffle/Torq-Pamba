import { cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { generateIdeasAction, refreshTrendsAction } from "@/lib/research/actions";
import { formatCount } from "@/lib/research/metrics";
import { workspaceNiche } from "@/lib/research/posts";
import { listTrends } from "@/lib/research/trends";
import { PLATFORM_LABEL } from "@/lib/research/types";
import { ResearchHeader } from "../_components/research-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trends · Research" };

const KIND_LABEL: Record<string, string> = { hashtag: "Hashtag", sound: "Sound", format: "Format", topic: "Topic" };

export default async function TrendsPage({ searchParams }: { searchParams: Promise<{ niche?: string; error?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const niche = params.niche?.trim().slice(0, 120) || workspaceNiche(workspace.brief);
  const rows = await listTrends(workspace.id, niche);

  return (
    <main className="max-w-5xl">
      <ResearchHeader current="trends" error={params.error}>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <form action={refreshTrendsAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Niche</span>
              <input name="niche" defaultValue={niche} maxLength={120} className={`${fieldClass} w-64`} />
            </label>
            <button type="submit" className={primaryButton}>
              Refresh trends
            </button>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-600">No trends recorded for {niche} yet. Click Refresh trends.</p>
        ) : (
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <caption className="sr-only">Trends for {niche}</caption>
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                  <th scope="col" className="px-4 py-3 font-medium">Trend</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 font-medium">Platform</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Views</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Growth</th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((trend) => (
                  <tr key={trend.id} className="border-b border-zinc-100 last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {trend.url ? (
                        <a href={trend.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {trend.kind === "hashtag" ? `#${trend.label}` : trend.label}
                        </a>
                      ) : trend.kind === "hashtag" ? (
                        `#${trend.label}`
                      ) : (
                        trend.label
                      )}
                    </th>
                    <td className="px-4 py-3">{KIND_LABEL[trend.kind] ?? trend.kind}</td>
                    <td className="px-4 py-3">{trend.platform ? PLATFORM_LABEL[trend.platform] : "Any"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCount(trend.volume)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${(trend.growthPct ?? 0) > 0 ? "text-emerald-700" : "text-zinc-600"}`}>
                      {trend.growthPct == null ? "—" : `${trend.growthPct > 0 ? "+" : ""}${Math.round(trend.growthPct)}%`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={generateIdeasAction}>
                        <input type="hidden" name="trendId" value={trend.id} />
                        <input type="hidden" name="count" value="2" />
                        <button type="submit" className={`${secondaryButton} px-3 py-1.5 text-xs`}>
                          Ideas from this trend
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResearchHeader>
    </main>
  );
}
