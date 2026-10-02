import type { Tier } from "@/lib/models";

export type ClipRequest = {
  prompt: string;
  durationS: number;
  sceneId?: string;
  /** Start frame (https or data URL) for image-to-video. */
  imageUrl?: string;
  /** Speech track (https URL) for lip-sync engines. */
  audioUrl?: string;
  sceneIndex?: number;
  /** Raw portrait SVG, or an SVG data URL, composited into mock frames. */
  portraitSvg?: string;
};

/** A provider accepted the clip; `providerJobId` is the vendor's task, operation or request id. */
export type ClipSubmission = {
  providerJobId: string;
};

/** Where a finished clip's bytes are. Headers are used for the download only and never stored. */
export type ClipOutput =
  | { kind: "url"; url: string; headers?: Record<string, string>; mimeType?: string }
  | { kind: "bytes"; bytes: Uint8Array; mimeType: string };

export type ClipPoll =
  | { state: "pending"; progress?: number }
  | { state: "succeeded"; output: ClipOutput; durationS?: number; frameUrl?: string }
  | { state: "failed"; refused: boolean; message: string };

export type ImageRequest = {
  prompt: string;
};

export type ImageResult = {
  providerId: string;
  url: string;
  costUsd: number;
};

export interface VideoProvider {
  id: string;
  vendor: string;
  label: string;
  tier: Tier;
  pricePerSecondUsd: number;
  maxDurationS: number;
  /** Starts an async clip job. Throws ProviderRefusedError or ProviderUnavailableError when the vendor rejects it. */
  submitClip(req: ClipRequest): Promise<ClipSubmission>;
  /** Checks a job from `submitClip`. Throws ProviderUnavailableError on transport errors. */
  pollClip(providerJobId: string, req: ClipRequest): Promise<ClipPoll>;
}

export interface ImageProvider {
  id: string;
  vendor: string;
  label: string;
  pricePerImageUsd: number;
  generateImage(req: ImageRequest): Promise<ImageResult>;
}

export interface LlmProvider {
  id: string;
  vendor: string;
  label: string;
  complete(req: { system: string; user: string }): Promise<string>;
}

/**
 * Capabilities an adapter can register. A feature adds a kind (voice, lipsync,
 * stitch, ...) by declaration merging from its own file:
 *
 *   declare module "@/lib/providers/types" {
 *     interface ProviderKinds { voice: VoiceProvider }
 *   }
 *
 * Every kind's provider needs a unique `id` within that kind.
 */
export interface ProviderKinds {
  video: VideoProvider;
  image: ImageProvider;
  llm: LlmProvider;
}

export type ProviderKind = keyof ProviderKinds;

export type ProviderAdapter = { id: string } & { [K in ProviderKind]?: readonly ProviderKinds[K][] };

export function defineAdapter<const A extends ProviderAdapter>(adapter: A): A {
  return adapter;
}

export class ProviderRefusedError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message = "Provider refused the prompt") {
    super(message);
    this.name = "ProviderRefusedError";
    this.providerId = providerId;
  }
}

export class ProviderUnavailableError extends Error {
  readonly providerId: string;
  /** True for network errors, timeouts, 429 and 5xx: the same request may work later. */
  readonly retryable: boolean;

  constructor(providerId: string, message = "Provider unavailable", options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
    this.retryable = options.retryable ?? false;
  }
}
