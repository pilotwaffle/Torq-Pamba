import Link from "next/link";
import { PageHeader, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import {
  markPartnershipReadyAction,
  createExperimentAction,
  recordSparkCodeAction,
  revokeHandoffAction,
  startHandoffAction,
} from "@/lib/reach/actions";
import { EXPERIMENT_STATUS_LABEL, listExperiments } from "@/lib/reach/experiments";
import { HANDOFF_LABEL, HANDOFF_STATUS_LABEL, HANDOFF_STEPS, listHandoffs } from "@/lib/reach/handoff";
import { listVideos } from "@/lib/videos";

export const dynamic = "force-dynamic";

const OK: Record<string, string> = {
  handoff: "Hand-off started.",
  code: "Spark Ads code saved (encrypted).",
  ready: "Partnership ad marked ready.",
};

export default async function ReachPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const [videoRows, experiments, handoffs] = await Promise.all([
    listVideos(workspace.id),
    listExperiments(workspace.id),
    listHandoffs(workspace.id),
  ]);
  const approved = videoRows.filter((video) => video.status === "approved" || video.status === "scheduled");

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Reach"
        description="Test hooks on Instagram Trial Reels before your followers see them, hand winners to paid amplification in your own Ads Manager, and brief human creators. Winners are saved to Knowledge."
      />
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {params.error}
        </p>
      ) : null}
      {params.ok && OK[params.ok] ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {OK[params.ok]}
        </p>
      ) : null}

      <section className={`${cardClass} p-4`} aria-labelledby="hook-test-heading">
        <h2 id="hook-test-heading" className="text-lg font-semibold">
          New hook test
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Variants reuse the approved video&apos;s clips with a different opening hook, so they cost nothing to make. Each variant posts as an Instagram Trial Reel (shown to non-followers first).
        </p>
        {approved.length === 0 ? (
          <p className="mt-3 text-sm">Approve a video first.</p>
        ) : (
          <form action={createExperimentAction} className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Approved video</span>
              <select name="videoId" className={fieldClass} aria-label="Approved video">
                {approved.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Variants</span>
              <select name="count" defaultValue="3" className={fieldClass} aria-label="Number of variants">
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} (incl. original)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Winner by</span>
              <select name="metric" defaultValue="views" className={fieldClass} aria-label="Winner metric">
                <option value="views">Views</option>
                <option value="engagement">Engagement rate</option>
              </select>
            </label>
            <div className="sm:col-span-4">
              <button type="submit" className={primaryButton}>
                Create hook test
              </button>
            </div>
          </form>
        )}
      </section>

      <section className={`${cardClass} mt-6 overflow-x-auto`} aria-label="Hook tests">
        {experiments.length === 0 ? (
          <p className="p-4 text-sm">No hook tests yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Hook tests">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Video</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Winner</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-3">
                    <Link className="text-emerald-800 underline" href={`/app/reach/${row.id}`}>
                      {row.baseTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{EXPERIMENT_STATUS_LABEL[row.status]}</td>
                  <td className="px-4 py-3">{typeof row.decision?.winner === "string" ? `Variant ${row.decision.winner}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="handoffs" className={`${cardClass} mt-6 p-4`} aria-labelledby="handoff-heading">
        <h2 id="handoff-heading" className="text-lg font-semibold">
          Paid amplification hand-off
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Torq-Pamba does not run ads or touch your ad budget. It tracks the creator&apos;s permission and you boost the post in your own TikTok or Meta Ads Manager.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {(["tiktok_spark", "meta_partnership"] as const).map((kind) => (
            <div key={kind} className="rounded-lg border border-zinc-200 p-3">
              <h3 className="font-medium">{HANDOFF_LABEL[kind]}</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-zinc-700">
                {HANDOFF_STEPS[kind].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {approved.length > 0 ? (
          <form action={startHandoffAction} className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Video to boost</span>
              <select name="videoId" className={fieldClass} aria-label="Video to boost">
                {approved.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Ad type</span>
              <select name="kind" className={fieldClass} aria-label="Ad type">
                <option value="tiktok_spark">{HANDOFF_LABEL.tiktok_spark}</option>
                <option value="meta_partnership">{HANDOFF_LABEL.meta_partnership}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Creator handle</span>
              <input name="creatorHandle" className={fieldClass} placeholder="@creator" aria-label="Creator handle" />
            </label>
            <div className="sm:col-span-4">
              <button type="submit" className={secondaryButton}>
                Start hand-off
              </button>
            </div>
          </form>
        ) : null}
        {handoffs.length > 0 ? (
          <table className="mt-4 w-full text-sm" aria-label="Ad hand-offs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-3 py-2 font-medium">Video</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Creator</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Next step</th>
              </tr>
            </thead>
            <tbody>
              {handoffs.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 align-top last:border-b-0">
                  <td className="px-3 py-2">{row.videoTitle}</td>
                  <td className="px-3 py-2">{HANDOFF_LABEL[row.kind]}</td>
                  <td className="px-3 py-2">{row.creatorHandle}</td>
                  <td className="px-3 py-2">
                    {HANDOFF_STATUS_LABEL[row.status]}
                    {row.codeHint ? <span className="block text-xs text-zinc-500">Code {row.codeHint}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "awaiting_creator" && row.kind === "tiktok_spark" ? (
                      <form action={recordSparkCodeAction} className="flex gap-2">
                        <input type="hidden" name="handoffId" value={row.id} />
                        <input name="code" className={fieldClass} aria-label={`Spark Ads code for ${row.creatorHandle}`} autoComplete="off" />
                        <button type="submit" className={secondaryButton}>
                          Save code
                        </button>
                      </form>
                    ) : null}
                    {row.status === "awaiting_creator" && row.kind === "meta_partnership" ? (
                      <form action={markPartnershipReadyAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="handoffId" value={row.id} />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="confirm" /> {row.creatorHandle} added us as a partner
                        </label>
                        <button type="submit" className={secondaryButton}>
                          Mark ready
                        </button>
                      </form>
                    ) : null}
                    {row.status !== "revoked" ? (
                      <form action={revokeHandoffAction} className="mt-2">
                        <input type="hidden" name="handoffId" value={row.id} />
                        <button type="submit" className="text-xs text-rose-700 underline">
                          Revoke
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <p className="mt-6 text-sm">
        Need human creators too?{" "}
        <Link className="text-emerald-800 underline" href="/app/creators">
          Write a creator brief
        </Link>
        . Proven hooks live in{" "}
        <Link className="text-emerald-800 underline" href="/app/knowledge">
          Knowledge
        </Link>
        .
      </p>
    </main>
  );
}
