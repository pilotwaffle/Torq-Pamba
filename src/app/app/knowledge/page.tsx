import { PageHeader, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { addTileAction, archiveTileAction, pinTileAction, seedTilesAction } from "@/lib/reach/actions";
import { KNOWLEDGE_KINDS, KNOWLEDGE_LABEL, listTiles, originOf } from "@/lib/reach/knowledge";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand",
  experiment: "Hook-test winner",
  brief: "Brand brief",
  user: "Added by hand",
  agent: "Added by the agent",
  analytics: "From analytics",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; seeded?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const tiles = await listTiles(workspace.id);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Knowledge"
        description="What works for this brand. Hook-test winners land here automatically, and the chat planner and hook generator use the top tiles first."
      />
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {params.error}
        </p>
      ) : null}
      {params.ok === "added" ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Tile saved.
        </p>
      ) : null}
      {params.seeded !== undefined ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Added {params.seeded} tile(s) from the brand brief.
        </p>
      ) : null}

      <section className={`${cardClass} p-4`} aria-labelledby="add-tile-heading">
        <h2 id="add-tile-heading" className="text-lg font-semibold">
          Add a tile
        </h2>
        <form action={addTileAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <select name="kind" className={fieldClass} aria-label="Tile type">
              {KNOWLEDGE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KNOWLEDGE_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-3">
            <span className="mb-1 block font-medium">Title</span>
            <input name="title" className={fieldClass} aria-label="Tile title" maxLength={120} />
          </label>
          <label className="text-sm sm:col-span-4">
            <span className="mb-1 block font-medium">Notes</span>
            <textarea name="body" className={fieldClass} aria-label="Tile notes" rows={2} maxLength={1000} />
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button type="submit" className={primaryButton}>
              Save tile
            </button>
          </div>
        </form>
        <form action={seedTilesAction} className="mt-3">
          <button type="submit" className={secondaryButton}>
            Import from brand brief
          </button>
        </form>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-2" aria-label="Knowledge tiles">
        {tiles.length === 0 ? <p className="text-sm">No tiles yet. Run a hook test or add one above.</p> : null}
        {tiles.map((tile) => (
          <article key={tile.id} className={`${cardClass} p-4`} aria-label={`${KNOWLEDGE_LABEL[tile.kind]}: ${tile.title}`}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              {KNOWLEDGE_LABEL[tile.kind]} · {SOURCE_LABEL[originOf(tile)] ?? originOf(tile)}
              {tile.pinned ? " · Pinned" : ""}
            </p>
            <h3 className="mt-1 font-semibold">{tile.title}</h3>
            {tile.content ? <p className="mt-1 text-sm text-zinc-700">{tile.content}</p> : null}
            <div className="mt-3 flex gap-3">
              <form action={pinTileAction}>
                <input type="hidden" name="tileId" value={tile.id} />
                <button type="submit" className="text-xs underline">
                  {tile.pinned ? "Unpin" : "Pin"}
                </button>
              </form>
              <form action={archiveTileAction}>
                <input type="hidden" name="tileId" value={tile.id} />
                <button type="submit" className="text-xs text-rose-700 underline">
                  Archive
                </button>
              </form>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
