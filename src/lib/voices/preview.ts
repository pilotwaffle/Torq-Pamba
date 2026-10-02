import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { voices, type Voice } from "@/db/schema";
import { catalog } from "@/lib/models";
import { registry } from "@/lib/providers/registry";
import { mockSynthesize } from "./mock";
import { mockPitchFor } from "./store";
import type { VoiceProvider } from "./types";
import { decodeDataUrl } from "./wav";

export function previewLine(voice: Pick<Voice, "name">): string {
  return `Hi, I'm ${voice.name}. This is how I sound in your videos.`;
}

export function talkingPreviewLine(avatarName: string): string {
  return `Hi, I'm ${avatarName.split(" ")[0] || avatarName}. Here's how I sound in your videos.`;
}

/** Speech runs about 15 characters a second; used only to price before generating. */
const CHARS_PER_SECOND = 15;

/** Estimated cost of voicing `text` and lip-syncing it with `lipsyncModel`. */
export function estimateTalkingClipUsd(text: string, lipsyncModel: string): number {
  const voice = catalog.voiceOver();
  const lipsync = registry.get("lipsync", lipsyncModel);
  const seconds = Math.max(1, text.length / CHARS_PER_SECOND);
  return Math.ceil(((voice.usdPer1KChars * text.length) / 1000 + lipsync.usdPerSecond * seconds) * 100) / 100;
}

/**
 * What to play for a voice preview. Never spends: a stored or vendor-hosted
 * preview when there is one, mock audio when the provider is not live, else none.
 */
export async function previewAudio(
  voice: Voice,
  resolve: (id: string) => VoiceProvider = (id) => registry.get("voice", id),
): Promise<{ redirect: string } | { bytes: Uint8Array; mimeType: string } | null> {
  if (voice.previewUrl?.startsWith("https://")) return { redirect: voice.previewUrl };
  const stored = voice.previewUrl ? decodeDataUrl(voice.previewUrl) : null;
  if (stored) return stored;
  const provider = resolve(catalog.voiceOver().id);
  if (provider.isLive() && voice.provider !== "mock") {
    const hosted = await provider.previewUrl(voice.providerVoiceId).catch(() => null);
    if (!hosted) return null;
    const db = await getDb();
    await db.update(voices).set({ previewUrl: hosted }).where(eq(voices.id, voice.id));
    return { redirect: hosted };
  }
  const audio = mockSynthesize("mock-preview", 0, {
    providerVoiceId: voice.providerVoiceId,
    text: previewLine(voice),
    mockPitchHz: mockPitchFor(voice),
  }).audio;
  return { bytes: audio.bytes, mimeType: audio.mimeType };
}
