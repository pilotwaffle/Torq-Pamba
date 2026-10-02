/** One audio file in memory, as uploaded, recorded or returned by a vendor. */
export type AudioFile = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
};

export type SpeechRequest = {
  /** The vendor's voice id (`voices.provider_voice_id`). */
  providerVoiceId: string;
  text: string;
  /** Mock audio pitch, so stock voices sound different without keys. */
  mockPitchHz?: number;
};

export type SpeechResult = {
  providerId: string;
  audio: AudioFile;
  durationMs: number;
  costUsd: number;
};

export type CloneRequest = {
  name: string;
  description?: string;
  samples: AudioFile[];
};

export type CloneResult = {
  /** `voices.provider` for the new voice: the vendor, or `mock` when no key was used. */
  provider: string;
  providerVoiceId: string;
  requiresVerification: boolean;
};

/** TTS and instant voice cloning. Registered as the `voice` provider kind. */
export interface VoiceProvider {
  /** Catalog voice model id, e.g. `elevenlabs-v3`. */
  id: string;
  vendor: string;
  label: string;
  usdPer1KChars: number;
  /** Characters per request the vendor model accepts. */
  maxChars: number;
  /** True when calls go to the vendor; false when they use the mock. */
  isLive(): boolean;
  synthesize(req: SpeechRequest): Promise<SpeechResult>;
  cloneVoice(req: CloneRequest): Promise<CloneResult>;
  deleteVoice(providerVoiceId: string): Promise<void>;
  /** The vendor's hosted preview clip, or null when there is none or no key. */
  previewUrl(providerVoiceId: string): Promise<string | null>;
}

export type LipsyncRequest = {
  /** Portrait: an `https:` URL or a `data:` URL (PNG, JPEG, or SVG for the mock). */
  imageUrl: string;
  audio: { url: string; mimeType: string; durationMs: number };
  title: string;
  /** The words in the audio. Vendors lip-sync from the audio; the mock times its mouth from this. */
  script?: string;
};

export type LipsyncOutput = {
  url: string;
  mimeType: string;
  durationMs: number;
  posterUrl?: string | null;
};

export type LipsyncProgress =
  | { status: "running" }
  | { status: "succeeded"; output: LipsyncOutput }
  | { status: "failed"; error: string };

/** Turns a portrait plus an audio track into a talking clip. Registered as the `lipsync` provider kind. */
export interface LipsyncProvider {
  /** The avatar engine's catalog video model id (`avatars.lipsync_model`), e.g. `heygen-avatar-iv`. */
  id: string;
  vendor: string;
  label: string;
  usdPerSecond: number;
  maxDurationS: number;
  isLive(): boolean;
  /** Starts a job. Mock providers finish at once and return the output. */
  submit(req: LipsyncRequest): Promise<{ providerJobId: string } & LipsyncProgress>;
  poll(providerJobId: string): Promise<LipsyncProgress>;
}

declare module "@/lib/providers/types" {
  interface ProviderKinds {
    voice: VoiceProvider;
    lipsync: LipsyncProvider;
  }
}
