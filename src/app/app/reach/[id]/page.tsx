import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/publish/accounts";
import {
  approveVariantsAction,
  cancelExperimentAction,
  decideExperimentAction,
  launchExperimentAction,
  refreshExperimentAction,
} from "@/lib/reach/actions";
import { EXPERIMENT_STATUS_LABEL, ExperimentError, getExperiment } from "@/lib/reach/experiments";
import { PATTERN_LABEL, isHookPattern } from "@/lib/reach/hooks";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("en-US");
const OK: Record<string, string> = {
  approved: "Variants approved.",
  launched: "Launched. Each variant is posting as an Instagram Trial Reel.",
  decided: "Winner picked and saved to Knowledge.",
};

export default async function ExperimentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; refreshed?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { workspace } = await requireWorkspace();
  const data = await getExperiment(workspace.id, id).catch((error: unknown) => {
    if (error instanceof ExperimentError) return null;
    throw error;
  });
  if (!data) notFound();
  const { experiment, baseTitle, stats } = data;
  const instagram = (await listAccounts(workspace.id)).filter((account) => account.platform === "instagram");
  const decision = experiment.decision as { winner?: string; liftPct?: number; confidence?: string } | null;

  return (
    <main className="max-w-5xl">
      <PageHeader title={`Hook test: ${baseTitle}`} description={EXPERIMENT_STATUS_LABEL[experiment.status]} />
      <p className="mb-4 text-sm">
        <Link href="/app/reach" className="text-emerald-800 underline">
          Back to Reach
        </Link>
      </p>
      {query.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {query.error}
        </p>
      ) : null}
      {query.ok && OK[query.ok] ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {OK[query.ok]}
        </p>
      ) : null}
      {query.refreshed !== undefined ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Stored {query.refreshed} new snapshot(s).
        </p>
      ) : null}

      <section className={`${cardClass} overflow-x-auto`} aria-label="Variants">
        <table className="w-full text-sm" aria-label="Hook variants">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
              <th scope="col" className="px-4 py-3 font-medium">Variant</th>
              <th scope="col" className="px-4 py-3 font-medium">Hook</th>
              <th scope="col" className="px-4 py-3 font-medium">Pattern</th>
              <th scope="col" className="px-4 py-3 font-medium">Post</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Views</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Engagement</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.variantId} className="border-b border-zinc-100 last:border-b-0">
                <td className="px-4 py-3 font-medium">
                  {row.label}
                  {decision?.winner === row.label ? <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">Winner</span> : null}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/app/videos/${row.videoId}`} className="underline">
                    {row.hook}
                  </Link>
                </td>
                <td className="px-4 py-3">{row.pattern === "control" || isHookPattern(row.pattern) ? PATTERN_LABEL[row.pattern as keyof typeof PATTERN_LABEL] : row.pattern}</td>
                <td className="px-4 py-3">{row.jobStatus ? (row.jobStatus === "succeeded" ? "Posted as Trial Reel" : row.jobStatus) : "Not posted"}</td>
                <td className="px-4 py-3 text-right">{row.measured ? number.format(row.views) : "—"}</td>
                <td className="px-4 py-3 text-right">{row.measured ? `${row.engagementRate}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {experiment.status === "draft" ? (
        <section className={`${cardClass} mt-6 p-4`} aria-labelledby="launch-heading">
          <h2 id="launch-heading" className="text-lg font-semibold">
            Approve and launch
          </h2>
          <form action={approveVariantsAction} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="experimentId" value={experiment.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="confirm" />
              Use the original video&apos;s approval (privacy, disclosure, consents) for every variant
            </label>
            <button type="submit" className={secondaryButton}>
              Approve all variants
            </button>
          </form>
          {instagram.length === 0 ? (
            <p className="mt-4 text-sm">
              Hook tests post as Instagram Trial Reels.{" "}
              <Link href="/app/accounts" className="text-emerald-800 underline">
                Connect an Instagram account
              </Link>{" "}
              first.
            </p>
          ) : (
            <form action={launchExperimentAction} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="experimentId" value={experiment.id} />
              <label className="text-sm">
                <span className="mb-1 block font-medium">Instagram account</span>
                <select name="accountId" className={fieldClass} aria-label="Instagram account">
                  {instagram.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.handle}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={primaryButton}>
                Launch as Trial Reels
              </button>
            </form>
          )}
        </section>
      ) : null}

      {experiment.status === "running" ? (
        <section className={`${cardClass} mt-6 flex flex-wrap gap-3 p-4`} aria-label="Measure">
          <form action={refreshExperimentAction}>
            <input type="hidden" name="experimentId" value={experiment.id} />
            <button type="submit" className={secondaryButton}>
              Refresh metrics
            </button>
          </form>
          <form action={decideExperimentAction}>
            <input type="hidden" name="experimentId" value={experiment.id} />
            <button type="submit" className={primaryButton}>
              Pick winner
            </button>
          </form>
          <p className="w-full text-xs text-zinc-600">
            Every variant needs at least {experiment.minViews} views. A lift under 10% is saved as low confidence.
          </p>
        </section>
      ) : null}

      {experiment.status === "decided" && decision ? (
        <section className={`${cardClass} mt-6 p-4`} aria-labelledby="result-heading">
          <h2 id="result-heading" className="text-lg font-semibold">
            Variant {decision.winner} won (+{decision.liftPct}%{decision.confidence === "low" ? ", low confidence" : ""})
          </h2>
          <p className="mt-1 text-sm">
            Saved to{" "}
            <Link href="/app/knowledge" className="text-emerald-800 underline">
              Knowledge
            </Link>
            . New chat plans lead with this hook. To show the winner to your followers, share the Trial Reel from the Instagram app.
          </p>
        </section>
      ) : null}

      {experiment.status === "draft" || experiment.status === "running" ? (
        <form action={cancelExperimentAction} className="mt-6">
          <input type="hidden" name="experimentId" value={experiment.id} />
          <button type="submit" className="text-sm text-rose-700 underline">
            Cancel hook test
          </button>
        </form>
      ) : null}
    </main>
  );
}
