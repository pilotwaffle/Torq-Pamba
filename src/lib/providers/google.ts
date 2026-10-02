import { mediaUrlPath, saveMedia } from "@/lib/media/storage";
import {
  NANO_BANANA_2_USD,
  NANO_BANANA_PRO_USD,
  OMNI_FLASH_USD_PER_SEC,
  VEO_31_LITE_USD_PER_SEC,
  VEO_31_STANDARD_USD_PER_SEC,
  type Tier,
} from "@/lib/pricing";
import { downloadClip, isLive, pollUntil, postJson, getJson, type PollOptions } from "./live";
import { mockGenerateClip, mockGenerateImage } from "./mock";
import { ProviderRefusedError, ProviderUnavailableError, type ClipRequest, type ClipResult, type ImageProvider, type ImageResult, type VideoProvider } from "./types";

const ROOT = "https://generativelanguage.googleapis.com/v1beta";

const MODELS: Record<string, { apiModel: string; tier: Tier; price: number; label: string }> = {
  "omni-flash": {
    apiModel: "gemini-omni-flash",
    tier: "standard",
    price: OMNI_FLASH_USD_PER_SEC,
    label: "Gemini Omni Flash",
  },
  "veo-3.1-lite": {
    apiModel: "veo-3.1-lite",
    tier: "budget",
    price: VEO_31_LITE_USD_PER_SEC,
    label: "Veo 3.1 Lite",
  },
  "veo-3.1-standard": {
    apiModel: "veo-3.1-standard",
    tier: "premium",
    price: VEO_31_STANDARD_USD_PER_SEC,
    label: "Veo 3.1 Standard",
  },
};

export function buildGoogleVideoRequest(providerId: string, req: ClipRequest) {
  const spec = MODELS[providerId];
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      durationSeconds: req.durationS,
      aspectRatio: "9:16",
      resolution: providerId === "veo-3.1-standard" ? "1080p" : "720p",
      model: spec?.apiModel,
    },
  };
}

type GoogleOperation = {
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
      raiMediaFilteredReasons?: string[];
    };
  };
};

/** Read a finished Veo / Omni long-running operation. Returns the video URI, or null while pending. */
export function googleOperationResult(providerId: string, op: GoogleOperation): string | null {
  if (!op.done) return null;
  if (op.error) {
    const message = op.error.message ?? "operation failed";
    if (/safety|policy|blocked|filter/i.test(message)) throw new ProviderRefusedError(providerId, message);
    throw new ProviderUnavailableError(providerId, message);
  }
  const result = op.response?.generateVideoResponse;
  if (result?.raiMediaFilteredReasons?.length) {
    throw new ProviderRefusedError(providerId, result.raiMediaFilteredReasons.join("; "));
  }
  const uri = result?.generatedSamples?.[0]?.video?.uri;
  if (!uri) throw new ProviderUnavailableError(providerId, "operation finished without a video");
  return uri;
}

export async function liveGoogleClip(providerId: string, req: ClipRequest, poll?: PollOptions): Promise<ClipResult> {
  const spec = MODELS[providerId];
  if (!spec) throw new ProviderUnavailableError(providerId, "unknown model");
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const headers = { "x-goog-api-key": key };
  const body = buildGoogleVideoRequest(providerId, req);
  const created = (await postJson(
    providerId,
    `${ROOT}/models/${spec.apiModel}:predictLongRunning`,
    body,
    headers,
  )) as { name?: string };
  if (!created.name) throw new ProviderUnavailableError(providerId, "missing operation");
  const operation = created.name;
  const uri = await pollUntil(
    providerId,
    async () => googleOperationResult(providerId, (await getJson(providerId, `${ROOT}/${operation}`, headers)) as GoogleOperation),
    poll,
  );
  const mediaKey = await downloadClip(providerId, uri, headers);
  return {
    providerId,
    durationS: req.durationS,
    frameUrls: [],
    mediaKey,
    costUsd: spec.price * req.durationS,
  };
}

function googleProvider(id: string): VideoProvider {
  const spec = MODELS[id];
  if (!spec) throw new Error(`Unknown Google model ${id}`);
  return {
    id,
    vendor: "google",
    label: spec.label,
    tier: spec.tier,
    pricePerSecondUsd: spec.price,
    maxDurationS: 60,
    async generateClip(req) {
      if (isLive(["GEMINI_API_KEY"])) return liveGoogleClip(id, req);
      return mockGenerateClip(id, spec.price, req);
    },
  };
}

export const omniFlash = googleProvider("omni-flash");
export const veoLite = googleProvider("veo-3.1-lite");
export const veoStandard = googleProvider("veo-3.1-standard");

/**
 * Nano Banana image models on the Gemini API. The API model ids are unverified
 * guesses and can be overridden with NANO_BANANA_2_MODEL / NANO_BANANA_PRO_MODEL.
 */
const IMAGE_MODELS: Record<string, { env: string; fallback: string; price: number; label: string }> = {
  "nano-banana-2": {
    env: "NANO_BANANA_2_MODEL",
    fallback: "gemini-3.1-flash-image-preview",
    price: NANO_BANANA_2_USD,
    label: "Nano Banana 2",
  },
  "nano-banana-pro": {
    env: "NANO_BANANA_PRO_MODEL",
    fallback: "gemini-3-pro-image-preview",
    price: NANO_BANANA_PRO_USD,
    label: "Nano Banana Pro",
  },
};

export function nanoBananaApiModel(id: string): string {
  const spec = IMAGE_MODELS[id];
  if (!spec) throw new Error(`Unknown image model ${id}`);
  return process.env[spec.env]?.trim() || spec.fallback;
}

export function buildNanoBananaRequest(prompt: string) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } },
  };
}

type ImageResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
};

export function nanoBananaInlineImage(response: ImageResponse): { mimeType: string; bytes: Buffer } | null {
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return { mimeType: part.inlineData.mimeType ?? "image/png", bytes: Buffer.from(part.inlineData.data, "base64") };
    }
  }
  return null;
}

export async function liveNanoBanana(id: string, prompt: string): Promise<ImageResult> {
  const spec = IMAGE_MODELS[id];
  if (!spec) throw new ProviderUnavailableError(id, "unknown model");
  const headers = { "x-goog-api-key": process.env.GEMINI_API_KEY?.trim() ?? "" };
  const response = (await postJson(
    id,
    `${ROOT}/models/${nanoBananaApiModel(id)}:generateContent`,
    buildNanoBananaRequest(prompt),
    headers,
  )) as ImageResponse;
  const image = nanoBananaInlineImage(response);
  if (!image) throw new ProviderRefusedError(id, "no image returned (possibly filtered)");
  const key = await saveMedia(image.bytes, image.mimeType === "image/jpeg" ? "jpg" : "png");
  return { providerId: id, url: mediaUrlPath(key), costUsd: spec.price };
}

function nanoBanana(id: string): ImageProvider {
  const spec = IMAGE_MODELS[id];
  if (!spec) throw new Error(`Unknown image model ${id}`);
  return {
    id,
    vendor: "google",
    label: spec.label,
    pricePerImageUsd: spec.price,
    async generateImage(req) {
      if (isLive(["GEMINI_API_KEY"])) return liveNanoBanana(id, req.prompt);
      return mockGenerateImage(id, spec.price, req.prompt);
    },
  };
}

export const nanoBanana2 = nanoBanana("nano-banana-2");
export const nanoBananaPro = nanoBanana("nano-banana-pro");
