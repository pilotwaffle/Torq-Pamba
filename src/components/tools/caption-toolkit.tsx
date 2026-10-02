"use client";

import { useMemo, useState } from "react";
import { fieldClass } from "@/components/ui";
import { captionStats, timeCues, toSrt } from "@/lib/tools/captions";

export function CaptionToolkit() {
  const [script, setScript] = useState("");
  const [wps, setWps] = useState(2.6);
  const [maxChars, setMaxChars] = useState(32);
  const [caption, setCaption] = useState("");
  const srt = useMemo(() => toSrt(timeCues(script, { wordsPerSecond: wps, maxChars })), [script, wps, maxChars]);
  const stats = captionStats(caption);
  const href = `data:application/x-subrip;charset=utf-8,${encodeURIComponent(srt)}`;

  return (
    <div className="space-y-8 text-sm">
      <section aria-labelledby="srt-heading" className="space-y-3">
        <h2 id="srt-heading" className="text-lg font-semibold">
          Script to on-screen captions (SRT)
        </h2>
        <label className="block">
          <span className="mb-1 block font-medium">Script</span>
          <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={5} className={fieldClass} aria-label="Script" />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:w-96">
          <label>
            <span className="mb-1 block font-medium">Words per second</span>
            <input type="number" min={1} max={5} step={0.1} value={wps} onChange={(e) => setWps(Number(e.target.value))} className={fieldClass} aria-label="Words per second" />
          </label>
          <label>
            <span className="mb-1 block font-medium">Characters per line</span>
            <input type="number" min={12} max={60} value={maxChars} onChange={(e) => setMaxChars(Number(e.target.value))} className={fieldClass} aria-label="Characters per line" />
          </label>
        </div>
        <pre aria-label="SRT preview" className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
          {srt || "Paste a script to see captions."}
        </pre>
        {srt ? (
          <a href={href} download="captions.srt" className="text-emerald-800 underline">
            Download captions.srt
          </a>
        ) : null}
      </section>
      <section aria-labelledby="caption-heading" className="space-y-3">
        <h2 id="caption-heading" className="text-lg font-semibold">
          Post caption check
        </h2>
        <label className="block">
          <span className="mb-1 block font-medium">Post caption</span>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className={fieldClass} aria-label="Post caption" />
        </label>
        <p role="status" aria-label="Caption stats">
          {stats.chars} characters · {stats.hashtags} hashtags · {stats.mentions} mentions
        </p>
        {stats.warnings.length ? (
          <ul className="list-disc pl-5 text-amber-900">
            {stats.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
