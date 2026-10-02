import type { Tier } from "@/lib/models";

export type ClipRequest = {
  prompt: string;
  durationS: number;
  sceneId?: string;
  imageUrl?: string;
  sceneIndex?: number;
  /** Raw portrait SVG, or an SVG data URL, composited into mock frames. */
  portraitSvg?: string;
};

export type ClipResult = {
  providerId: string;
  durationS: number;
  frameUrls: string[];
  costUsd: number;
};

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
  generateClip(req: ClipRequest): Promise<ClipResult>;
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

  constructor(providerId: string, message = "Provider unavailable") {
    super(message);
    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
  }
}
