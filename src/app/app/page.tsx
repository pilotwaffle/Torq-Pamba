import Link from "next/link";
import { PageHeader, StatusBadge, cardClass, statusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { loadDashboard } from "@/lib/dashboard";
import { formatUsd } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { workspace } = await requireWorkspace();
  const summary = await loadDashboard(workspace);
  const brief = workspace.brief;
  const cap = Number(workspace.budgetCapUsd);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Dashboard"
        description="Budget, the path to a first post, and the clips already in this workspace."
      />

      <section aria-label="This month" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Used this month" value={formatUsd(summary.usedUsd)} hint={`of ${formatUsd(cap)} cap`} />
        <Stat label="Remaining" value={formatUsd(summary.remainingUsd)} hint="left this month" />
        <Stat label="Videos" value={String(summary.videoCount)} hint="in this workspace" />
        <Stat label="Scheduled" value={String(summary.scheduledCount)} hint="waiting for a slot" />
      </section>

      <section className="mt-8" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="text-lg font-semibold">
          Zero to first post
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {summary.checklist.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className={`${cardClass} flex items-center gap-3 px-4 py-3 text-sm hover:border-emerald-300`}
              >
                <CheckIcon done={item.done} />
                <span className="sr-only">{item.done ? "Done" : "Not yet"}</span>
                <span className={item.done ? "font-medium text-zinc-950" : "text-zinc-700"}>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${cardClass} mt-8 p-5`} aria-labelledby="brief-heading">
        <h2 id="brief-heading" className="text-lg font-semibold">
          Brand brief
        </h2>
        {brief?.companyName ? (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="text-base font-medium">{brief.companyName}</p>
            {brief.niche ? <p className="text-zinc-700">{brief.niche}</p> : null}
            {brief.whatTheyDo ? <p className="max-w-prose leading-6 text-zinc-700">{brief.whatTheyDo}</p> : null}
            {brief.audience ? <p>{brief.audience}</p> : null}
            {brief.tone ? <p>Tone: {brief.tone}</p> : null}
            {brief.products && brief.products.length > 0 ? (
              <ul className="list-disc pl-5">
                {brief.products.map((product) => (
                  <li key={product}>{product}</li>
                ))}
              </ul>
            ) : null}
            <Link href="/app/brief" className="w-fit font-medium text-emerald-800 underline-offset-2 hover:underline">
              Edit brief
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-sm">
            No brand brief yet.{" "}
            <Link href="/app/onboarding" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
              Start onboarding
            </Link>
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="videos-heading">
        <h2 id="videos-heading" className="text-lg font-semibold">
          Recent videos
        </h2>
        {summary.recentVideos.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">No videos yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {summary.recentVideos.map((video) => (
              <li key={video.id} className={`${cardClass} flex items-center justify-between gap-3 px-4 py-3`}>
                <Link href={`/app/videos/${video.id}`} className="min-w-0 truncate text-sm font-medium hover:text-emerald-800">
                  {video.title || "Untitled"}
                </Link>
                <StatusBadge status={video.status}>{statusLabel(video.status)}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className={`${cardClass} px-4 py-4`}>
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{hint}</p>
    </article>
  );
}

function CheckIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="currentColor" fillOpacity="0.12" />
        <path d="M6 10.2 8.6 13 14 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
