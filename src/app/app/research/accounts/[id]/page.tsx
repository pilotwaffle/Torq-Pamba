import Link from "next/link";
import { notFound } from "next/navigation";
import { cardClass, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { accountPosts, getAccount } from "@/lib/research/accounts";
import { archiveAccountAction, syncAccountAction } from "@/lib/research/actions";
import { engagementRate, formatCount, median } from "@/lib/research/metrics";
import { postData } from "@/lib/research/posts";
import { PLATFORM_LABEL } from "@/lib/research/types";
import { ResearchHeader } from "../../_components/research-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account · Research" };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const account = await getAccount(workspace.id, id);
  if (!account || account.archivedAt) notFound();
  const posts = await accountPosts(workspace.id, account.id);
  const medianViews = median(posts.map((post) => post.views ?? 0).filter((views) => views > 0));
  const avgEngagement = posts.length
    ? Math.round((posts.reduce((sum, post) => sum + engagementRate(post), 0) / posts.length) * 100) / 100
    : 0;

  return (
    <main className="max-w-5xl">
      <ResearchHeader current="accounts">
        <section aria-labelledby="account-heading" className={`${cardClass} mb-6 p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="account-heading" className="text-lg font-semibold">
                @{account.handle}
              </h2>
              <p className="text-sm text-zinc-600">
                {account.displayName ? `${account.displayName} · ` : ""}
                {PLATFORM_LABEL[account.platform]} · {account.kind === "competitor" ? "Competitor" : "Inspiration"}
              </p>
              {account.profileUrl ? (
                <a href={account.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-800 hover:underline">
                  {account.profileUrl}
                </a>
              ) : null}
            </div>
            <div className="flex gap-2">
              <form action={syncAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button type="submit" className={secondaryButton}>
                  Refresh
                </button>
              </form>
              <form action={archiveAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button type="submit" className={secondaryButton}>
                  Stop tracking
                </button>
              </form>
            </div>
          </div>
          {account.syncError ? (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              Last sync failed: {account.syncError}
            </p>
          ) : null}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Followers" value={formatCount(account.followerCount)} />
            <Stat label="Recent posts" value={String(posts.length)} />
            <Stat label="Median views" value={formatCount(medianViews || null)} />
            <Stat label="Avg engagement" value={`${avgEngagement}%`} />
          </dl>
          {account.lastSyncedAt ? (
            <p className="mt-3 text-xs text-zinc-500">Synced {account.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
          ) : null}
        </section>

        {posts.length === 0 ? (
          <p className="text-sm text-zinc-600">No posts stored for this account yet. Click Refresh.</p>
        ) : (
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">Recent posts and their performance</caption>
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                  <th scope="col" className="px-4 py-3 font-medium">Post</th>
                  <th scope="col" className="px-4 py-3 font-medium">Posted</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Views</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Likes</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Comments</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Shares</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Engagement</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">vs. median</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => {
                  const data = postData(post);
                  return (
                    <tr key={post.id} className="border-b border-zinc-100 align-top last:border-0">
                      <th scope="row" className="max-w-xs px-4 py-3 text-left font-normal">
                        {data.sample ? (
                          <span>{post.hook ?? post.caption ?? "Untitled"}</span>
                        ) : (
                          <a href={post.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {post.hook ?? post.caption ?? "Untitled"}
                          </a>
                        )}
                        {data.notes?.[0] ? <p className="mt-1 text-xs text-zinc-500">{data.notes[0]}</p> : null}
                      </th>
                      <td className="px-4 py-3 whitespace-nowrap">{post.postedAt ? post.postedAt.toISOString().slice(0, 10) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCount(post.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCount(post.likes)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCount(post.comments)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCount(post.shares)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{data.engagementPct ?? engagementRate(post)}%</td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${(post.outlierScore ?? 0) >= 2 ? "font-semibold text-emerald-700" : ""}`}
                      >
                        {post.outlierScore ? `${post.outlierScore}×` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-sm">
          <Link href="/app/research/accounts" className="font-medium text-emerald-800 hover:underline">
            Back to accounts
          </Link>
        </p>
      </ResearchHeader>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
