import Link from "next/link";
import { notFound } from "next/navigation";
import { PreviewPlayer } from "@/components/preview-player";
import { PageHeader, StatusBadge, cardClass, fieldClass, primaryButton, secondaryButton, statusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { regenerateSceneAction, saveCaptionsAction, saveHooksAction, selectTakeAction } from "@/lib/editor/actions";
import { MAX_HOOKS, sceneCaptionText, type EditorScene, type EditorTake } from "@/lib/editor/state";
import { loadEditor } from "@/lib/editor/store";
import { formatUsd } from "@/lib/pricing";
import { getWorkspaceVideo, manifestOf } from "@/lib/videos";
import { SubmitButton } from "./submit-button";

export const dynamic = "force-dynamic";

function seconds(ms: number): string {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  return `${minutes}:${rest.toFixed(rest % 1 === 0 ? 0 : 1).padStart(2, "0")}`;
}

function safeFrame(url: string): string | null {
  return url.startsWith("data:image/") || url.startsWith("https://") ? url : null;
}

export default async function VideoEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { workspace } = await requireWorkspace();
  const video = await getWorkspaceVideo(workspace.id, id);
  if (!video) notFound();
  const state = await loadEditor(workspace.id, video.id);
  if (!state) notFound();
  const manifest = manifestOf(video.manifest);
  const locked = !state.editable;

  return (
    <main className="max-w-6xl">
      <PageHeader
        eyebrow={
          <Link href={`/app/videos/${video.id}`} className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Back to review
          </Link>
        }
        title="Editor"
        description={`${video.title || "Untitled"} — fix one scene at a time: pick a take, regenerate a scene, edit captions and the hook.`}
      />
      <p className="mb-4 -mt-2 flex items-center gap-2 text-sm text-zinc-600">
        <StatusBadge status={video.status}>{statusLabel(video.status)}</StatusBadge>
        {video.tier ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium">{video.tier}</span> : null}
      </p>
      {query.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {query.error}
        </p>
      ) : null}
      {query.saved ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {query.saved}
        </p>
      ) : null}
      {locked ? (
        <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {state.scenes.length === 0
            ? "This video has no finished scenes to edit yet."
            : "Editing is closed for this video. Approval covers exactly what was reviewed, so scenes, captions and hooks are locked."}
        </p>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6">
          {manifest ? (
            <PreviewPlayer
              hook={manifest.hook}
              scenes={manifest.scenes.map((scene, index) => ({
                frameUrl: scene.frameUrl,
                line: sceneCaptionText(manifest, index),
                durationS: scene.durationS,
              }))}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="Scenes" className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Scenes</h2>
            {state.scenes.map((scene) => (
              <SceneCard key={scene.id} videoId={video.id} scene={scene} locked={locked} />
            ))}
          </section>

          {state.captions.length > 0 ? (
            <section aria-labelledby="captions-heading" className={`${cardClass} p-4`}>
              <h2 id="captions-heading" className="text-lg font-semibold">
                Captions
              </h2>
              <form action={saveCaptionsAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="videoId" value={video.id} />
                {state.captions.map((cue, index) => (
                  <div key={cue.id} className="flex flex-col gap-1">
                    <label htmlFor={`caption-${cue.id}`} className="flex items-center gap-2 text-sm font-medium">
                      Caption {index + 1}
                      <span className="text-xs font-normal text-zinc-500">
                        {seconds(cue.startMs)}–{seconds(cue.endMs)}
                        {cue.source === "user" ? " · edited" : ""}
                      </span>
                    </label>
                    <textarea
                      id={`caption-${cue.id}`}
                      name={`caption:${cue.id}`}
                      defaultValue={cue.text}
                      rows={2}
                      maxLength={200}
                      required
                      disabled={locked}
                      className={fieldClass}
                    />
                  </div>
                ))}
                {locked ? null : (
                  <SubmitButton className={`${primaryButton} w-fit`} pendingLabel="Saving…">
                    Save captions
                  </SubmitButton>
                )}
              </form>
            </section>
          ) : null}

          {state.hooks.length > 0 || !locked ? (
            <section aria-labelledby="hooks-heading" className={`${cardClass} p-4`}>
              <h2 id="hooks-heading" className="text-lg font-semibold">
                Hooks
              </h2>
              <p className="mt-1 text-sm text-zinc-600">The selected hook shows at the top of the video.</p>
              <form action={saveHooksAction} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="videoId" value={video.id} />
                {state.hooks.map((hook, index) => (
                  <div key={hook.id} className="flex items-start gap-3">
                    <input
                      type="radio"
                      id={`use-hook-${hook.id}`}
                      name="selectedHook"
                      value={hook.id}
                      defaultChecked={hook.isSelected}
                      disabled={locked}
                      aria-label={`Use hook ${index + 1}`}
                      className="mt-3 accent-emerald-700"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="flex items-center gap-2">
                        <label htmlFor={`hook-${hook.id}`} className="text-sm font-medium">
                          Hook {index + 1}
                        </label>
                        {hook.isSelected ? <span className="text-xs text-emerald-800">In use</span> : null}
                      </p>
                      <input
                        id={`hook-${hook.id}`}
                        name={`hook:${hook.id}`}
                        defaultValue={hook.text}
                        maxLength={100}
                        required
                        disabled={locked}
                        className={fieldClass}
                      />
                    </div>
                  </div>
                ))}
                {locked || state.hooks.length >= MAX_HOOKS ? null : (
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      id="use-hook-new"
                      name="selectedHook"
                      value="new"
                      aria-label="Use the new hook"
                      defaultChecked={!state.hooks.some((hook) => hook.isSelected)}
                      className="mt-3 accent-emerald-700"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label htmlFor="new-hook" className="text-sm font-medium">
                        New hook
                      </label>
                      <input id="new-hook" name="newHook" maxLength={100} placeholder="Optional" className={fieldClass} />
                    </div>
                  </div>
                )}
                {locked ? null : (
                  <SubmitButton className={`${primaryButton} w-fit`} pendingLabel="Saving…">
                    Save hooks
                  </SubmitButton>
                )}
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SceneCard({ videoId, scene, locked }: { videoId: string; scene: EditorScene; locked: boolean }) {
  const number = scene.position + 1;
  const busy = scene.takes.some((take) => take.status === "generating" || take.status === "pending");
  return (
    <article aria-labelledby={`scene-${scene.id}`} className={`${cardClass} p-4`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`scene-${scene.id}`} className="font-semibold">
          Scene {number}
        </h3>
        <span className="text-xs text-zinc-500">{seconds(scene.durationMs)} long</span>
      </header>
      <p className="mt-1 text-sm text-zinc-700">{scene.line}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{scene.visual}</p>

      <ul aria-label={`Scene ${number} takes`} className="mt-3 flex flex-wrap gap-3">
        {scene.takes.map((take) => (
          <TakeCard key={take.id} videoId={videoId} sceneNumber={number} take={take} selected={take.id === scene.selectedTakeId} locked={locked} />
        ))}
      </ul>

      {locked ? null : (
        <form action={regenerateSceneAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
          <input type="hidden" name="videoId" value={videoId} />
          <input type="hidden" name="scene" value={number} />
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <label htmlFor={`direction-${scene.id}`} className="text-sm font-medium">
              Direction for scene {number}
            </label>
            <input
              id={`direction-${scene.id}`}
              name="direction"
              maxLength={300}
              placeholder="Optional, e.g. closer on the can"
              className={fieldClass}
            />
          </div>
          <SubmitButton
            className={secondaryButton}
            pendingLabel="Regenerating…"
            ariaLabel={`Regenerate scene ${number}`}
            disabled={busy}
          >
            Regenerate scene
          </SubmitButton>
        </form>
      )}
    </article>
  );
}

function TakeCard({
  videoId,
  sceneNumber,
  take,
  selected,
  locked,
}: {
  videoId: string;
  sceneNumber: number;
  take: EditorTake;
  selected: boolean;
  locked: boolean;
}) {
  const frame = safeFrame(take.frameUrl);
  return (
    <li
      aria-label={`Scene ${sceneNumber} take ${take.number}`}
      className={`flex w-32 flex-col gap-1 rounded-lg border p-2 text-xs ${selected ? "border-emerald-600 ring-2 ring-emerald-600/30" : "border-zinc-200"}`}
    >
      <div className="aspect-[9/16] overflow-hidden rounded bg-zinc-100">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <span className="font-medium">Take {take.number}</span>
      <span className="truncate text-zinc-500">{take.model ?? "—"}</span>
      {take.status === "ready" && take.costUsd > 0 ? <span className="text-zinc-500">{formatUsd(take.costUsd)}</span> : null}
      {take.status === "failed" ? <span className="text-rose-700">Failed — not charged</span> : null}
      {take.status === "generating" || take.status === "pending" ? <span className="text-zinc-600">Generating…</span> : null}
      {selected ? (
        <span className="font-medium text-emerald-800">Selected</span>
      ) : take.status === "ready" && !locked ? (
        <form action={selectTakeAction}>
          <input type="hidden" name="videoId" value={videoId} />
          <input type="hidden" name="takeId" value={take.id} />
          <SubmitButton
            className="rounded border border-zinc-300 px-2 py-0.5 font-medium hover:bg-zinc-50"
            ariaLabel={`Use scene ${sceneNumber} take ${take.number}`}
          >
            Use this take
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}
