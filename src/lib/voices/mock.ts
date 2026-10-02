import { createHash } from "node:crypto";
import { ProviderRefusedError } from "@/lib/providers/types";
import type { CloneRequest, CloneResult, LipsyncOutput, LipsyncRequest, SpeechRequest, SpeechResult } from "./types";
import { speechPlan, synthWav } from "./wav";

/** Mock audio is capped so inline data URLs stay small. */
export const MOCK_MAX_AUDIO_MS = 15_000;

export function mockSynthesize(providerId: string, usdPer1KChars: number, req: SpeechRequest): SpeechResult {
  if (req.text.includes("[refuse-all]")) throw new ProviderRefusedError(providerId, "Safety filter refused the text");
  const wav = synthWav(req.text, { pitchHz: req.mockPitchHz, maxMs: MOCK_MAX_AUDIO_MS });
  return {
    providerId,
    audio: { bytes: wav.bytes, mimeType: "audio/wav", filename: "speech.wav" },
    durationMs: wav.durationMs,
    costUsd: (usdPer1KChars * req.text.length) / 1000,
  };
}

export function mockClone(req: CloneRequest): CloneResult {
  const digest = createHash("sha256");
  digest.update(req.name);
  for (const sample of req.samples) digest.update(sample.bytes);
  digest.update(String(Date.now()) + Math.random());
  return { provider: "mock", providerVoiceId: `mock_${digest.digest("hex").slice(0, 20)}`, requiresVerification: false };
}

function decodeSvg(url: string): string {
  if (url.startsWith("<svg")) return url;
  const comma = url.indexOf(",");
  if (!url.startsWith("data:image/svg+xml") || comma < 0) return "";
  try {
    const body = url.slice(comma + 1);
    return url.slice(0, comma).endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
  } catch {
    return "";
  }
}

const MOUTH_PATH = /<path d="M70 106q10 9 22 0"[^>]*stroke="([^"]+)"[^>]*\/>/;

/**
 * An animated SVG of the portrait whose mouth opens on each syllable of the
 * spoken text. Mock stand-in for a lip-synced MP4; play it beside the audio.
 */
export function mockTalkingSvg(portrait: string, text: string, durationMs: number, providerId: string): string {
  const raw = decodeSvg(portrait);
  const inner = raw.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i)?.[1] ?? "";
  const safe = inner && !/<script|on\w+=/i.test(inner) ? inner : "";
  const lip = safe.match(MOUTH_PATH)?.[1] ?? "#7A4038";
  const body = safe.replace(MOUTH_PATH, "") || `<rect width="160" height="200" rx="18" fill="#E7EFEA"/><circle cx="80" cy="90" r="34" fill="#C68642"/>`;
  const plan = speechPlan(text, durationMs);
  const total = Math.max(1, durationMs);
  const keyTimes = [0];
  const values = [1];
  for (const syllable of plan.syllables) {
    const mid = (syllable.startMs + syllable.endMs) / 2;
    for (const [at, value] of [
      [syllable.startMs, 1],
      [mid, 1 + 4.5 * syllable.level],
      [syllable.endMs, 1],
    ] as const) {
      const time = Math.min(1, at / total);
      if (time <= (keyTimes.at(-1) ?? 0)) continue;
      keyTimes.push(time);
      values.push(value);
    }
  }
  if ((keyTimes.at(-1) ?? 0) < 1) {
    keyTimes.push(1);
    values.push(1);
  }
  const label = `Mock lip-sync · ${providerId}`.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200" role="img" aria-label="${label}" data-mock-lipsync="true" data-duration-ms="${total}">${body}
    <ellipse cx="81" cy="107.5" rx="8" ry="1" fill="#4A1F1C" stroke="${lip}" stroke-width="1.6">
      <animate attributeName="ry" begin="0s" dur="${(total / 1000).toFixed(3)}s" fill="freeze" calcMode="linear" keyTimes="${keyTimes.map((t) => t.toFixed(4)).join(";")}" values="${values.map((v) => v.toFixed(2)).join(";")}"/>
    </ellipse>
    <g transform="translate(6,6)"><rect width="${Math.round(label.length * 4.3 + 12)}" height="14" rx="7" fill="#111827" fill-opacity="0.72"/><text x="6" y="10" fill="#fff" font-size="7.5" font-family="ui-sans-serif, system-ui, sans-serif">${label}</text></g>
  </svg>`;
}

export function mockLipsync(providerId: string, req: LipsyncRequest): LipsyncOutput {
  if (req.title.includes("[refuse-all]")) throw new ProviderRefusedError(providerId, "Safety filter refused the clip");
  const svg = mockTalkingSvg(req.imageUrl, req.script ?? req.title, req.audio.durationMs, providerId);
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    mimeType: "image/svg+xml",
    durationMs: req.audio.durationMs,
    posterUrl: null,
  };
}
