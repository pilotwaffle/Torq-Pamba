import { PreviewPlayer } from "@/components/preview-player";
import { RefreshWhile } from "@/components/refresh-while";
import type { RenderView } from "@/lib/media/renders";
import type { StitchedManifest } from "@/lib/router";

/**
 * The video page player. A finished render plays as a real mp4; while clips
 * or the render are running it shows progress; if the render failed it falls
 * back to the scene slideshow.
 */
export function RenderedVideo({
  status,
  render,
  manifest,
}: {
  status: string;
  render: RenderView;
  manifest: StitchedManifest | null;
}) {
  if (render.videoUrl) {
    return (
      <figure className="mx-auto w-full max-w-[320px]">
        <video
          controls
          playsInline
          preload="metadata"
          poster={render.posterUrl ?? undefined}
          src={render.videoUrl}
          aria-label="Final video"
          data-testid="final-video"
          className="aspect-[9/16] w-full rounded-2xl bg-zinc-900 object-contain shadow-md"
        >
          {render.captionsUrl && !render.captionsBurnedIn ? (
            <track kind="captions" src={render.captionsUrl} srcLang="en" label="Captions" default />
          ) : null}
        </video>
        <figcaption className="mt-2 flex flex-wrap items-center justify-center gap-x-3 text-center text-sm text-zinc-600">
          <span>{render.mock ? "Mock provider — placeholder frames" : "Final MP4"}</span>
          <a href={render.videoUrl} download className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Download MP4
          </a>
        </figcaption>
      </figure>
    );
  }

  const generating = status === "generating";
  const rendering = render.status === "queued" || render.status === "rendering";
  return (
    <div className="flex flex-col gap-3">
      <RefreshWhile active={generating || rendering} />
      {generating || rendering ? (
        <p role="status" className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {render.status === "none"
            ? `Generating clips: ${render.scenesDone} of ${render.scenesTotal} scenes ready.`
            : "Stitching the final MP4…"}
        </p>
      ) : null}
      {!generating && render.status === "failed" ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The final MP4 could not be rendered{render.error ? `: ${render.error}` : "."} Showing the scene preview.
        </p>
      ) : null}
      {manifest ? (
        <PreviewPlayer
          hook={manifest.hook}
          scenes={manifest.scenes.map((scene) => ({ frameUrl: scene.frameUrl, line: scene.line, durationS: scene.durationS }))}
        />
      ) : null}
    </div>
  );
}
