/**
 * Mock speech: a real mono WAV whose syllable bursts follow the text, so mock
 * mode plays audible audio and the mock lip-sync can move the mouth in time.
 */

export const MOCK_SAMPLE_RATE = 8000;
const SYLLABLE_MS = 170;
const WORD_GAP_MS = 55;
const PAUSE_MS = 260;
const EDGE_MS = 120;

export type Syllable = { startMs: number; endMs: number; level: number };
export type SpeechPlan = { durationMs: number; syllables: Syllable[] };

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

function syllablesIn(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, Math.min(6, groups || Math.ceil(word.length / 3)));
}

/** Syllable timing for `text`, capped at `maxMs`. Deterministic. */
export function speechPlan(text: string, maxMs = 15_000): SpeechPlan {
  const tokens = text.match(/[\p{L}\p{N}']+|[.,!?;:]/gu) ?? [];
  const syllables: Syllable[] = [];
  let cursor = EDGE_MS;
  for (const token of tokens) {
    if (cursor >= maxMs - EDGE_MS) break;
    if (/^[.,!?;:]$/.test(token)) {
      cursor += token === "," ? PAUSE_MS / 2 : PAUSE_MS;
      continue;
    }
    const count = syllablesIn(token);
    for (let i = 0; i < count; i += 1) {
      const length = SYLLABLE_MS - 30 + (hash(`${token}:${i}`) % 60);
      const endMs = Math.min(cursor + length, maxMs - EDGE_MS);
      if (endMs - cursor < 40) break;
      syllables.push({ startMs: cursor, endMs, level: 0.55 + ((hash(`${i}${token}`) % 45) / 100) });
      cursor = endMs + 15;
    }
    cursor += WORD_GAP_MS;
  }
  const durationMs = Math.min(maxMs, Math.max(600, Math.round(cursor + EDGE_MS)));
  return { durationMs, syllables };
}

/** An 8-bit PCM WAV of `text` spoken as tone bursts around `pitchHz`. */
export function synthWav(
  text: string,
  options: { pitchHz?: number; maxMs?: number } = {},
): { bytes: Uint8Array; durationMs: number; plan: SpeechPlan } {
  const pitchHz = options.pitchHz ?? 180;
  const plan = speechPlan(text, options.maxMs);
  const sampleCount = Math.round((plan.durationMs / 1000) * MOCK_SAMPLE_RATE);
  const samples = new Float32Array(sampleCount);
  for (const [index, syllable] of plan.syllables.entries()) {
    const start = Math.round((syllable.startMs / 1000) * MOCK_SAMPLE_RATE);
    const end = Math.min(sampleCount, Math.round((syllable.endMs / 1000) * MOCK_SAMPLE_RATE));
    const length = Math.max(1, end - start);
    const vowel = hash(`${text}:${index}`) % 3;
    const weights = vowel === 0 ? [1, 0.6, 0.25, 0.1] : vowel === 1 ? [1, 0.3, 0.45, 0.2] : [1, 0.45, 0.15, 0.3];
    const glide = 1 + (((hash(`${index}`) % 21) - 10) / 200);
    for (let i = 0; i < length; i += 1) {
      const t = i / MOCK_SAMPLE_RATE;
      const progress = i / length;
      const envelope = Math.min(1, progress * 8) * Math.min(1, (1 - progress) * 5);
      const f0 = pitchHz * (1 + (glide - 1) * progress);
      let value = 0;
      weights.forEach((weight, harmonic) => {
        value += weight * Math.sin(2 * Math.PI * f0 * (harmonic + 1) * t);
      });
      samples[start + i] = (samples[start + i] ?? 0) + (value / 2.4) * envelope * syllable.level;
    }
  }
  return { bytes: encodeWav8(samples, MOCK_SAMPLE_RATE), durationMs: plan.durationMs, plan };
}

function encodeWav8(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples.length, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    bytes[44 + i] = Math.round(128 + clamped * 127);
  }
  return bytes;
}

/** Duration of a PCM WAV from its header, or null when `bytes` is not one. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== "RIFF" || text(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = text(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 20 <= bytes.length) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") return byteRate > 0 ? Math.round((size / byteRate) * 1000) : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export function dataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Bytes and mime type of a base64 `data:` URL, or null. */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s);
  if (!match?.[1] || match[2] == null) return null;
  return { mimeType: match[1], bytes: new Uint8Array(Buffer.from(match[2], "base64")) };
}
