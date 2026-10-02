import { PageHeader, cardClass, fieldClass, primaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { saveCreatorBriefAction } from "@/lib/reach/actions";
import { listCreatorBriefs, MARKETPLACE_LABEL, MARKETPLACES } from "@/lib/reach/creators";
import { listVideos } from "@/lib/videos";

export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const [briefs, videoRows] = await Promise.all([listCreatorBriefs(workspace.id), listVideos(workspace.id)]);
  const references = videoRows.filter((video) => video.status === "approved" || video.status === "scheduled");

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Creator briefs"
        description="Brief human creators with what already worked. Download the brief and post it on TikTok One, Billo or Collabstr from your own account; Torq-Pamba does not contact creators or pay them."
      />
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {params.error}
        </p>
      ) : null}
      {params.ok === "saved" ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Brief saved.
        </p>
      ) : null}
      <section className={`${cardClass} p-4`} aria-labelledby="brief-form-heading">
        <h2 id="brief-form-heading" className="text-lg font-semibold">
          New brief
        </h2>
        <form action={saveCreatorBriefAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Brief title</span>
            <input name="title" className={fieldClass} aria-label="Brief title" maxLength={120} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Reference video</span>
            <select name="videoId" className={fieldClass} aria-label="Reference video">
              <option value="">None</option>
              {references.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Budget (USD)</span>
            <input name="budgetUsd" type="number" min="1" step="1" defaultValue="500" className={fieldClass} aria-label="Budget (USD)" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Videos</span>
            <input name="videoCount" type="number" min="1" max="50" defaultValue="4" className={fieldClass} aria-label="Number of videos" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Length (s)</span>
            <input name="lengthS" type="number" min="5" max="180" defaultValue="30" className={fieldClass} aria-label="Video length (seconds)" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Usage rights (days)</span>
            <input name="usageRightsDays" type="number" min="0" max="3650" defaultValue="90" className={fieldClass} aria-label="Usage rights (days)" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Due date</span>
            <input name="dueDate" type="date" className={fieldClass} aria-label="Due date" />
          </label>
          <fieldset className="text-sm sm:col-span-3">
            <legend className="mb-1 font-medium">Platforms</legend>
            <div className="flex flex-wrap gap-4">
              {(["tiktok", "instagram", "facebook"] as const).map((platform) => (
                <label key={platform} className="flex items-center gap-1">
                  <input type="checkbox" name={`platform-${platform}`} defaultChecked={platform !== "facebook"} />
                  {platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "Facebook"}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm sm:col-span-2">
            <legend className="mb-1 font-medium">Post the brief on</legend>
            <div className="flex flex-wrap gap-4">
              {MARKETPLACES.map((market) => (
                <label key={market} className="flex items-center gap-1">
                  <input type="checkbox" name={`market-${market}`} defaultChecked={market === "tiktok_one"} />
                  {MARKETPLACE_LABEL[market]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm sm:col-span-2">
            <legend className="mb-1 font-medium">Paid usage</legend>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="allowSparkAds" defaultChecked /> Ask for a Spark Ads code
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" name="allowPartnershipAds" defaultChecked /> Ask for partnership-ads permission
            </label>
          </fieldset>
          <div className="sm:col-span-4">
            <button type="submit" className={primaryButton}>
              Save brief
            </button>
          </div>
        </form>
      </section>
      <section className={`${cardClass} mt-6 overflow-x-auto`} aria-label="Saved briefs">
        {briefs.length === 0 ? (
          <p className="p-4 text-sm">No briefs yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Creator briefs">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Brief</th>
                <th scope="col" className="px-4 py-3 font-medium">Budget</th>
                <th scope="col" className="px-4 py-3 font-medium">Where</th>
                <th scope="col" className="px-4 py-3 font-medium">Download</th>
              </tr>
            </thead>
            <tbody>
              {briefs.map((brief) => (
                <tr key={brief.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-3">{brief.title}</td>
                  <td className="px-4 py-3">{usd.format(brief.body.budgetUsd)}</td>
                  <td className="px-4 py-3">{brief.body.marketplaces.map((m) => MARKETPLACE_LABEL[m]).join(", ")}</td>
                  <td className="px-4 py-3">
                    <a className="text-emerald-800 underline" href={`/api/reach/briefs/${brief.id}?format=md`}>
                      Brief (Markdown)
                    </a>
                    {" · "}
                    <a className="text-emerald-800 underline" href={`/api/reach/briefs/${brief.id}?format=csv`}>
                      CSV
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
