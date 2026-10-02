import Link from "next/link";
import { cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { generateIdeasAction, makeVideoAction, setIdeaStatusAction } from "@/lib/research/actions";
import { listIdeas, type IdeaView } from "@/lib/research/ideas";
import { workspaceNiche } from "@/lib/research/posts";
import { ResearchHeader } from "./_components/research-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research" };

export default async function ResearchIdeasPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const ideas = await listIdeas(workspace.id);
  const niche = workspaceNiche(workspace.brief);

  return (
    <main className="max-w-5xl">
      <ResearchHeader current="ideas" error={params.error}>
        <section aria-labelledby="generate-heading" className={`${cardClass} mb-6 p-4`}>
          <h2 id="generate-heading" className="text-base font-semibold">
            Video ideas for {workspace.brief?.companyName?.trim() || workspace.name}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Built from your brand brief plus trends and top posts in {niche}.
            {workspace.brief?.niche ? null : (
              <>
                {" "}
                <Link href="/app/brief" className="font-medium text-emerald-800 hover:underline">
                  Set your niche
                </Link>{" "}
                for sharper ideas.
              </>
            )}
          </p>
          <form action={generateIdeasAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">How many</span>
              <select name="count" defaultValue="5" className={`${fieldClass} w-24`}>
                {[3, 5, 8, 10].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryButton}>
              Generate ideas
            </button>
          </form>
        </section>

        {ideas.length === 0 ? (
          <p className="text-sm text-zinc-600">No ideas yet. Generate some, or start from a post in Discover or a trend.</p>
        ) : (
          <ul aria-label="Ideas" className="grid gap-4 md:grid-cols-2">
            {ideas.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </ul>
        )}
      </ResearchHeader>
    </main>
  );
}

function IdeaCard({ idea }: { idea: IdeaView }) {
  const basis = idea.postAuthor
    ? `From @${idea.postAuthor}'s post`
    : idea.trendLabel
      ? `From the trend “${idea.trendLabel}”`
      : idea.source === "user"
        ? "Your idea"
        : "From your brief";
  return (
    <li className={`${cardClass} flex flex-col gap-3 p-4`} aria-label={idea.title}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm leading-5 font-semibold text-zinc-950">{idea.title}</h3>
        {idea.status !== "new" ? (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 capitalize">{idea.status}</span>
        ) : null}
      </div>
      {idea.hook ? <p className="text-sm text-zinc-800">Hook: “{idea.hook}”</p> : null}
      {idea.angle ? <p className="text-sm leading-6 text-zinc-600">{idea.angle}</p> : null}
      <p className="text-xs text-zinc-500">{basis}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {idea.videoId ? (
          <Link href={`/app/videos/${idea.videoId}`} className={`${secondaryButton} px-3 py-1.5 text-xs`}>
            View video
          </Link>
        ) : null}
        <form action={makeVideoAction}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <button type="submit" className={`${primaryButton} px-3 py-1.5 text-xs`}>
            Make this video
          </button>
        </form>
        {idea.status === "new" ? (
          <StatusButton ideaId={idea.id} status="saved" label="Save" />
        ) : idea.status === "saved" ? (
          <StatusButton ideaId={idea.id} status="new" label="Unsave" />
        ) : null}
        <StatusButton ideaId={idea.id} status="dismissed" label="Dismiss" />
      </div>
    </li>
  );
}

function StatusButton({ ideaId, status, label }: { ideaId: string; status: string; label: string }) {
  return (
    <form action={setIdeaStatusAction}>
      <input type="hidden" name="ideaId" value={ideaId} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="returnTo" value="/app/research" />
      <button type="submit" className="rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950">
        {label}
      </button>
    </form>
  );
}
