import type { Tier } from "@/lib/pricing";

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
  /** Storage key of the downloaded clip (live mode only). Mock clips have none. */
  mediaKey?: string;
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
