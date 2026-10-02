import { PageHeader, cardClass, primaryButton } from "@/components/ui";
import { workspaceAnalytics } from "@/lib/analytics";
import { requireWorkspace } from "@/lib/auth/guards";
import { refreshAnalyticsAction } from "@/lib/publish/actions";
import { PLATFORM_LABEL } from "@/lib/publish/config";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("en-US");

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ refreshed?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const report = await workspaceAnalytics(workspace.id);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Analytics"
        description="Counts come from official APIs only: TikTok video query, Instagram media insights and Facebook reel insights. Watch-time curves are not available from these APIs."
      />
      <form action={refreshAnalyticsAction}>
        <button type="submit" className={primaryButton}>
          Refresh metrics
        </button>
      </form>
      {params.refreshed !== undefined ? (
        <p role="status" className="mt-3 text-sm text-emerald-900">
          Stored {params.refreshed} new snapshot(s).
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {params.error}
        </p>
      ) : null}
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Views", report.totals.views],
          ["Likes", report.totals.likes],
          ["Shares", report.totals.shares],
          ["Engagement", `${report.engagementRate}%`],
        ].map(([label, value]) => (
          <div key={String(label)} className={`${cardClass} p-4`}>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
            <dd className="mt-1 text-xl font-semibold">{typeof value === "number" ? number.format(value) : value}</dd>
          </div>
        ))}
      </dl>
      <section className={`${cardClass} mt-6 overflow-x-auto`}>
        {report.posts.length === 0 ? (
          <p className="p-4 text-sm">No posted videos with metrics yet. Post through a connected account, then refresh.</p>
        ) : (
          <table className="w-full min-w-[40rem] text-sm" aria-label="Post analytics">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                {["Video", "Platform", "Views", "Likes", "Comments", "Shares", "Engagement"].map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-3 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.posts.map((post) => (
                <tr key={post.jobId} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-3">{post.title || "Untitled"}</td>
                  <td className="px-4 py-3">
                    {PLATFORM_LABEL[post.platform]} {post.handle}
                  </td>
                  <td className="px-4 py-3">{number.format(post.views)}</td>
                  <td className="px-4 py-3">{number.format(post.likes)}</td>
                  <td className="px-4 py-3">{number.format(post.comments)}</td>
                  <td className="px-4 py-3">{number.format(post.shares)}</td>
                  <td className="px-4 py-3">{post.engagementRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
