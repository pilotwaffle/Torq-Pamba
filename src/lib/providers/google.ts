import { catalog } from "@/lib/models";
import { mediaUrlPath, saveMedia } from "@/lib/media/storage";
import { catalogVideoProvider } from "./catalog";
import { downloadClip, getJson, isLive, pollUntil, postJson, type PollOptions } from "./live";
import { mockGenerateImage } from "./mock";
import {
  defineAdapter,
  ProviderRefusedError,
  ProviderUnavailableError,
  type ClipRequest,
  type ClipResult,
  type ImageProvider,
  type ImageResult,
} from "./types";

const ROOT = "https://generativelanguage.googleapis.com/v1beta";

const API_MODEL: Record<string, string> = {
  "omni-flash": "gemini-omni-flash",
  "veo-3.1-lite": "veo-3.1-lite",
  "veo-3.1-standard": "veo-3.1-standard",
};

export function buildGoogleVideoRequest(providerId: string, req: ClipRequest) {
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      durationSeconds: req.durationS,
      aspectRatio: "9:16",
      resolution: providerId === "veo-3.1-standard" ? "1080p" : "720p",
      model: API_MODEL[providerId],
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
  const apiModel = API_MODEL[providerId];
  if (!apiModel) throw new ProviderUnavailableError(providerId, "unknown model");
  const usdPerSecond = catalog.video(providerId).usdPerSecond;
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const headers = { "x-goog-api-key": key };
  const body = buildGoogleVideoRequest(providerId, req);
  const created = (await postJson(
    providerId,
    `${ROOT}/models/${apiModel}:predictLongRunning`,
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
    costUsd: usdPerSecond * req.durationS,
  };
}

function googleProvider(id: string) {
  return catalogVideoProvider(id, {
    envKeys: ["GEMINI_API_KEY"],
    live: (req) => liveGoogleClip(id, req),
  });
}

export const omniFlash = googleProvider("omni-flash");
export const veoLite = googleProvider("veo-3.1-lite");
export const veoStandard = googleProvider("veo-3.1-standard");

/**
 * Nano Banana image models on the Gemini API. Prices and labels come from the
 * model catalog (src/lib/models/google.ts). The API model ids are unverified
 * guesses and can be overridden with NANO_BANANA_2_MODEL / NANO_BANANA_PRO_MODEL.
 */
const IMAGE_API_MODELS: Record<string, { env: string; fallback: string }> = {
  "nano-banana-2": { env: "NANO_BANANA_2_MODEL", fallback: "gemini-3.1-flash-image-preview" },
  "nano-banana-pro": { env: "NANO_BANANA_PRO_MODEL", fallback: "gemini-3-pro-image-preview" },
};

export function nanoBananaApiModel(id: string): string {
  const spec = IMAGE_API_MODELS[id];
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
  if (!IMAGE_API_MODELS[id]) throw new ProviderUnavailableError(id, "unknown model");
  const price = catalog.image(id).usdPerImage;
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
  return { providerId: id, url: mediaUrlPath(key), costUsd: price };
}

function nanoBanana(id: string): ImageProvider {
  const model = catalog.image(id);
  return {
    id,
    vendor: "google",
    label: model.label,
    pricePerImageUsd: model.usdPerImage,
    async generateImage(req) {
      if (isLive(["GEMINI_API_KEY"])) return liveNanoBanana(id, req.prompt);
      return mockGenerateImage(id, model.usdPerImage, req.prompt);
    },
  };
}

export const nanoBanana2 = nanoBanana("nano-banana-2");
export const nanoBananaPro = nanoBanana("nano-banana-pro");

export const adapter = defineAdapter({
  id: "google",
  video: [omniFlash, veoLite, veoStandard],
  image: [nanoBanana2, nanoBananaPro],
});
