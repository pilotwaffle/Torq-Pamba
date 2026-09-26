"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type PreviewScene = {
  frameUrl: string;
  line: string;
  durationS: number;
};

function frameMarkup(value: string): string | null {
  if (!value) return null;
  if (value.startsWith("<svg") && !/<script/i.test(value)) return value;
  const marker = "data:image/svg+xml;charset=utf-8,";
  if (!value.startsWith(marker)) return null;
  try {
    const svg = decodeURIComponent(value.slice(marker.length));
    if (!svg.startsWith("<svg") || /<script/i.test(svg)) return null;
    return svg;
  } catch {
    return null;
  }
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function PreviewPlayer({ scenes, hook }: { scenes: PreviewScene[]; hook: string }) {
  const [index, setIndex] = useState(0);
  const reduceMotion = usePrefersReducedMotion();
  const [override, setOverride] = useState<boolean | null>(null);
  const playing = override ?? !reduceMotion;
  const count = scenes.length;

  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [playing, count]);

  const scene = scenes[index] ?? scenes[0];
  const markup = scene ? frameMarkup(scene.frameUrl) : null;

  return (
    <figure className="mx-auto w-full max-w-[320px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-zinc-900 text-white shadow-md">
        {markup ? (
          <div className="h-full w-full [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: markup }} />
        ) : (
          <div className="h-full w-full bg-zinc-800" />
        )}
        {hook ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 via-black/35 to-transparent px-4 pb-10 pt-4">
            <p className="line-clamp-3 break-words text-center text-sm font-semibold leading-snug text-balance text-white [overflow-wrap:anywhere] [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]">
              {hook}
            </p>
          </div>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pt-12 pb-2.5">
          {scene?.line ? (
            <p className="line-clamp-3 break-words text-center text-sm leading-snug text-balance text-white [overflow-wrap:anywhere] [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]">
              {scene.line}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-pressed={playing}
              onClick={() => setOverride(!playing)}
              className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <div className="flex min-w-0 flex-1 gap-1" aria-hidden="true">
              {scenes.map((item, itemIndex) => (
                <span
                  key={`${item.durationS}-${itemIndex}`}
                  className={`h-1 flex-1 rounded-full ${itemIndex <= index ? "bg-white" : "bg-white/35"}`}
                />
              ))}
            </div>
          </div>
          <p className="sr-only">
            Scene {Math.min(index + 1, Math.max(count, 1))} of {Math.max(count, 1)}
          </p>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-sm text-zinc-600">Mock provider — placeholder frames</figcaption>
    </figure>
  );
}
