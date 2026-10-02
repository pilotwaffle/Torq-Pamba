"use client";

import { useEffect, useRef } from "react";
import type { TalkingClipView } from "@/lib/voices/actions";

function svgMarkup(url: string | null): string | null {
  if (!url?.startsWith("data:image/svg+xml")) return null;
  try {
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    return svg.startsWith("<svg") && !/<script|\son\w+=/i.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

/** A vendor MP4, or the mock's animated SVG kept in step with the voice track. */
export function TalkingClipPlayer({ clip, label }: { clip: TalkingClipView; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const svg = clip.mimeType === "image/svg+xml" ? svgMarkup(clip.url) : null;

  useEffect(() => {
    const element = host.current?.querySelector("svg");
    const track = audio.current;
    if (!element || !track) return;
    const sync = () => element.setCurrentTime(track.currentTime);
    const play = () => {
      sync();
      element.unpauseAnimations();
    };
    const pause = () => element.pauseAnimations();
    element.pauseAnimations();
    element.setCurrentTime(0);
    track.addEventListener("play", play);
    track.addEventListener("pause", pause);
    track.addEventListener("ended", pause);
    track.addEventListener("seeked", sync);
    return () => {
      track.removeEventListener("play", play);
      track.removeEventListener("pause", pause);
      track.removeEventListener("ended", pause);
      track.removeEventListener("seeked", sync);
    };
  }, [svg]);

  if (clip.status !== "succeeded" || !clip.url) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        {clip.status === "running" ? "The talking clip is still rendering." : (clip.error ?? "The talking clip failed.")}
      </p>
    );
  }

  return (
    <figure className="flex flex-col gap-2" aria-label={label}>
      {svg ? (
        <>
          <div
            ref={host}
            className="h-48 w-40 overflow-hidden rounded-lg border border-zinc-200 [&_svg]:h-full [&_svg]:w-full"
            data-testid="talking-clip"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <audio ref={audio} controls src={clip.audioUrl} aria-label={`${label} audio`} className="w-56" />
        </>
      ) : (
        <video
          controls
          src={clip.url}
          poster={clip.posterUrl ?? undefined}
          className="h-64 rounded-lg border border-zinc-200"
          data-testid="talking-clip"
        />
      )}
      <figcaption className="text-xs text-zinc-600">
        {clip.mock ? "Mock lip-sync — placeholder mouth animation" : clip.providerId} · {clip.voiceName} ·{" "}
        {(clip.durationMs / 1000).toFixed(1)}s · ${clip.costUsd.toFixed(2)}
      </figcaption>
    </figure>
  );
}
