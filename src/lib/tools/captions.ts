/**
 * Caption toolkit: wraps a script into readable on-screen cues, times them by
 * speaking rate, exports SRT, and checks post captions against platform limits.
 */

export type Cue = { text: string; startS: number; endS: number };

export const CAPTION_LIMITS = {
  tiktok: { chars: 4000, hashtags: null as number | null },
  instagram: { chars: 2200, hashtags: 30 as number | null },
} as const;

/** Greedy word wrap; words longer than the line are kept whole. */
export function wrapLines(text: string, maxChars = 32): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Splits a script into cues of at most two lines, timed at wordsPerSecond (minimum 0.8 s each). */
export function timeCues(script: string, options: { wordsPerSecond?: number; maxChars?: number; startS?: number } = {}): Cue[] {
  const wps = Math.min(5, Math.max(1, options.wordsPerSecond ?? 2.6));
  const sentences = script
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const cues: Cue[] = [];
  let cursor = options.startS ?? 0;
  for (const sentence of sentences) {
    const lines = wrapLines(sentence, options.maxChars ?? 32);
    for (let index = 0; index < lines.length; index += 2) {
      const text = lines.slice(index, index + 2).join("\n");
      const words = text.split(/\s+/).filter(Boolean).length;
      const duration = Math.max(0.8, words / wps);
      const startS = round(cursor);
      cursor += duration;
      cues.push({ text, startS, endS: round(cursor) });
    }
  }
  return cues;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function srtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startS)} --> ${srtTimestamp(cue.endS)}\n${cue.text}\n`).join("\n");
}

export function captionStats(caption: string) {
  const hashtags = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const mentions = caption.match(/(^|\s)@[\p{L}\p{N}_.]+/gu)?.length ?? 0;
  const chars = [...caption].length;
  const warnings: string[] = [];
  if (chars > CAPTION_LIMITS.instagram.chars) warnings.push(`Instagram allows ${CAPTION_LIMITS.instagram.chars} characters; this is ${chars}.`);
  if (chars > CAPTION_LIMITS.tiktok.chars) warnings.push(`TikTok allows ${CAPTION_LIMITS.tiktok.chars} characters; this is ${chars}.`);
  if (hashtags > (CAPTION_LIMITS.instagram.hashtags ?? Infinity)) warnings.push(`Instagram allows ${CAPTION_LIMITS.instagram.hashtags} hashtags; this has ${hashtags}.`);
  if (hashtags > 5) warnings.push("More than 5 hashtags rarely helps reach; 3-5 specific ones work better.");
  return { chars, hashtags, mentions, warnings };
}
