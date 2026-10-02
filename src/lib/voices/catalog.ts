import { getDb } from "@/db";
import { voices } from "@/db/schema";

export type StockVoice = {
  /** Matches the legacy `avatars.voice_id` label id in `STOCK_VOICES`. */
  slug: string;
  name: string;
  providerVoiceId: string;
  accent: string;
  description: string;
  /** Pitch of the mock audio, so stock voices sound different with no keys. */
  mockPitchHz: number;
};

/**
 * Stock voices: ElevenLabs premade voices. Ids from the ElevenLabs voice docs
 * and API reference, read 2026-10-01. ElevenLabs retires its Default voices on
 * 2026-12-31; remap `providerVoiceId` to voices in the account before then.
 */
export const STOCK_VOICE_CATALOG: readonly StockVoice[] = [
  { slug: "warm-alto", name: "Warm alto", providerVoiceId: "21m00Tcm4TlvDq8ikWAM", accent: "American", description: "Calm and warm (ElevenLabs Rachel)", mockPitchHz: 196 },
  { slug: "clear-baritone", name: "Clear baritone", providerVoiceId: "onwK4e9ZLuTAKqWW03F9", accent: "British", description: "Clear and authoritative (ElevenLabs Daniel)", mockPitchHz: 110 },
  { slug: "bright-mezzo", name: "Bright mezzo", providerVoiceId: "9BWtsMINqrJLrRacOk9x", accent: "American", description: "Bright and expressive (ElevenLabs Aria)", mockPitchHz: 220 },
  { slug: "friendly-tenor", name: "Friendly tenor", providerVoiceId: "TX3LPaxmHKxFdv7VOQHJ", accent: "American", description: "Energetic creator voice (ElevenLabs Liam)", mockPitchHz: 147 },
  { slug: "soft-alto", name: "Soft alto", providerVoiceId: "EXAVITQu4vr4xnSDxMaL", accent: "American", description: "Soft and reassuring (ElevenLabs Sarah)", mockPitchHz: 185 },
  { slug: "steady-baritone", name: "Steady baritone", providerVoiceId: "JBFqnCBsd6RMkjVDRZzb", accent: "British", description: "Steady narrator (ElevenLabs George)", mockPitchHz: 98 },
  { slug: "bright-soprano", name: "Bright soprano", providerVoiceId: "XB0fDUnXU5powFXDhCwa", accent: "Swedish-English", description: "Bright and conversational (ElevenLabs Charlotte)", mockPitchHz: 247 },
  { slug: "warm-tenor", name: "Warm tenor", providerVoiceId: "nPczCjzI2devNBz1zQrb", accent: "American", description: "Deep and comforting (ElevenLabs Brian)", mockPitchHz: 131 },
];

export const STOCK_VOICE_PROVIDER = "elevenlabs";

export function stockVoiceBySlug(slug: string): StockVoice | undefined {
  return STOCK_VOICE_CATALOG.find((voice) => voice.slug === slug);
}

export function stockVoiceByProviderId(providerVoiceId: string): StockVoice | undefined {
  return STOCK_VOICE_CATALOG.find((voice) => voice.providerVoiceId === providerVoiceId);
}

let seeded: Promise<void> | null = null;

/** Inserts the stock catalog into `voices` (shared rows, `workspace_id` null). Idempotent. */
export function ensureStockVoices(): Promise<void> {
  seeded ??= (async () => {
    const db = await getDb();
    await db
      .insert(voices)
      .values(
        STOCK_VOICE_CATALOG.map((voice) => ({
          kind: "stock" as const,
          provider: STOCK_VOICE_PROVIDER,
          providerVoiceId: voice.providerVoiceId,
          name: voice.name,
          language: "en",
          accent: voice.accent,
          description: voice.description,
        })),
      )
      .onConflictDoNothing({ target: [voices.provider, voices.providerVoiceId] });
  })().catch((error: unknown) => {
    seeded = null;
    throw error;
  });
  return seeded;
}
