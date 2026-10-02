"use client";

import { useEffect, useMemo, useState } from "react";
import { fieldClass } from "@/components/ui";
import { combinedSafeZone, overlapIssues, SAFE_LABEL, SAFE_MARGINS, type SafePlatform } from "@/lib/tools/safezone";

const PLATFORMS: SafePlatform[] = ["tiktok", "instagram", "facebook"];
const FRAME = { width: 1080, height: 1920 };

export function SafeZonePreviewer() {
  const [selected, setSelected] = useState<SafePlatform[]>(["tiktok", "instagram"]);
  const [file, setFile] = useState<{ url: string; video: boolean } | null>(null);
  const [textTop, setTextTop] = useState(70);
  const [textHeight, setTextHeight] = useState(10);

  useEffect(() => () => (file ? URL.revokeObjectURL(file.url) : undefined), [file]);

  const zone = useMemo(() => combinedSafeZone(selected, FRAME.width, FRAME.height), [selected]);
  const box = { x: zone.x, y: Math.round((FRAME.height * textTop) / 100), w: zone.w, h: Math.round((FRAME.height * textHeight) / 100) };
  const issues = overlapIssues(box, FRAME, selected);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <div
        className="relative mx-auto aspect-[9/16] w-[300px] overflow-hidden rounded-xl bg-zinc-900"
        role="img"
        aria-label={`9:16 preview with the safe zone for ${selected.map((p) => SAFE_LABEL[p]).join(", ") || "no platform"}`}
      >
        {file ? (
          file.video ? (
            <video src={file.url} className="h-full w-full object-cover" muted loop autoPlay playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL, never uploaded
            <img src={file.url} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-400">Choose an image or video. It stays in your browser.</div>
        )}
        <div
          className="pointer-events-none absolute border-2 border-dashed border-emerald-400"
          style={{ left: pct(zone.x, FRAME.width), top: pct(zone.y, FRAME.height), width: pct(zone.w, FRAME.width), height: pct(zone.h, FRAME.height) }}
        />
        <div
          className={`pointer-events-none absolute ${issues.length ? "bg-rose-500/40" : "bg-emerald-400/30"}`}
          style={{ left: pct(box.x, FRAME.width), top: pct(box.y, FRAME.height), width: pct(box.w, FRAME.width), height: pct(box.h, FRAME.height) }}
        />
      </div>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium">Image or video (not uploaded)</span>
          <input
            type="file"
            accept="image/*,video/*"
            aria-label="Image or video"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) setFile({ url: URL.createObjectURL(chosen), video: chosen.type.startsWith("video/") });
            }}
          />
        </label>
        <fieldset>
          <legend className="mb-1 font-medium">Platforms</legend>
          <div className="flex flex-wrap gap-4">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selected.includes(platform)}
                  onChange={(event) =>
                    setSelected((current) => (event.target.checked ? [...current, platform] : current.filter((p) => p !== platform)))
                  }
                />
                {SAFE_LABEL[platform]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className="mb-1 block font-medium">Text top (%)</span>
            <input type="number" min={0} max={100} value={textTop} onChange={(e) => setTextTop(Number(e.target.value))} className={fieldClass} aria-label="Text top (%)" />
          </label>
          <label>
            <span className="mb-1 block font-medium">Text height (%)</span>
            <input type="number" min={1} max={100} value={textHeight} onChange={(e) => setTextHeight(Number(e.target.value))} className={fieldClass} aria-label="Text height (%)" />
          </label>
        </div>
        <div role="status" aria-label="Safe-zone check">
          {issues.length === 0 ? (
            <p className="text-emerald-800">Text is clear of the app UI on {selected.map((p) => SAFE_LABEL[p]).join(", ") || "—"}.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-rose-800">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
        <table className="w-full text-xs" aria-label="Safe-zone margins">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1">Platform</th>
              <th>Top</th>
              <th>Bottom</th>
              <th>Left</th>
              <th>Right</th>
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((p) => (
              <tr key={p}>
                <td className="py-1">{SAFE_LABEL[p]}</td>
                <td>{SAFE_MARGINS[p].top * 100}%</td>
                <td>{SAFE_MARGINS[p].bottom * 100}%</td>
                <td>{SAFE_MARGINS[p].left * 100}%</td>
                <td>{SAFE_MARGINS[p].right * 100}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-zinc-500">Margins are conservative guides; the apps change their layouts and do not publish exact numbers.</p>
      </div>
    </div>
  );
}
