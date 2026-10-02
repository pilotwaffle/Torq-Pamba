import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { getJson, isLive, nearestDuration, postJson } from "./live";
import { mockGenerateImage } from "./mock";
import {
  defineAdapter,
  ProviderRefusedError,
  ProviderUnavailableError,
  type ClipPoll,
  type ClipRequest,
  type ImageProvider,
  type ImageResult,
} from "./types";

const ROOT = "https://generativelanguage.googleapis.com/v1beta";

function keyHeaders() {
  return { "x-goog-api-key": process.env.GEMINI_API_KEY?.trim() ?? "" };
}

/**
 * Veo model codes from https://ai.google.dev/gemini-api/docs/veo (Model versions, read 2026-10-01).
 * The catalog ids stay stable; these are the API names.
 */
export const VEO_API_MODEL: Record<string, string> = {
  "veo-3.1-lite": "veo-3.1-lite-generate-preview",
  "veo-3.1-standard": "veo-3.1-generate-preview",
};

/** Gemini Omni Flash, https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash (read 2026-10-01). */
export const OMNI_API_MODEL = "gemini-omni-1.1-flash";

/** Veo accepts 4, 6 or 8 seconds; 1080p and 4k only at 8. */
const VEO_DURATIONS = [4, 6, 8] as const;

/** `data:image/png;base64,...` → Veo's `{ inlineData }` image. Other URLs are not accepted by Veo. */
function inlineImage(url: string | undefined) {
  const match = url?.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : undefined;
}

/**
 * POST /v1beta/models/{model}:predictLongRunning with `instances[].prompt` (and
 * an optional start `image`) and `parameters.aspectRatio` ("9:16"),
 * `durationSeconds` (4 / 6 / 8), `resolution` ("720p", or "1080p" only at 8 s),
 * and `personGeneration` ("allow_all" for text-to-video, "allow_adult" with an image).
 * https://ai.google.dev/gemini-api/docs/veo — "Veo API parameters and specifications" (read 2026-10-01).
 * The table lists durationSeconds as "4" | "6" | "8"; we send the number, which proto JSON also accepts (unverified live).
 */
export function buildVeoRequest(providerId: string, req: ClipRequest) {
  const image = inlineImage(req.imageUrl);
  const hd = providerId === "veo-3.1-standard";
  return {
    instances: [{ prompt: req.prompt, ...(image ? { image } : {}) }],
    parameters: {
      aspectRatio: "9:16",
      durationSeconds: hd ? 8 : nearestDuration(req.durationS, VEO_DURATIONS),
      resolution: hd ? "1080p" : "720p",
      personGeneration: image ? "allow_adult" : "allow_all",
    },
  };
}

type VeoOperation = {
  done?: boolean;
  error?: { code?: number; message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
      raiMediaFilteredCount?: number;
      raiMediaFilteredReasons?: string[];
    };
  };
};

/**
 * Poll GET /v1beta/{operation name} until `done`, then download
 * `response.generateVideoResponse.generatedSamples[0].video.uri` with the API
 * key header, following redirects. Safety filtering shows as
 * `raiMediaFilteredReasons` with no sample. Videos are kept for 2 days.
 * https://ai.google.dev/gemini-api/docs/veo (read 2026-10-01).
 */
export function readVeoOperation(operation: VeoOperation): ClipPoll {
  if (!operation.done) return { state: "pending" };
  if (operation.error) {
    const message = operation.error.message || `error ${operation.error.code ?? ""}`.trim();
    return { state: "failed", refused: /safety|policy|blocked|filter/i.test(message), message };
  }
  const result = operation.response?.generateVideoResponse;
  const uri = result?.generatedSamples?.[0]?.video?.uri;
  if (!uri) {
    const reasons = result?.raiMediaFilteredReasons ?? [];
    if (reasons.length > 0 || (result?.raiMediaFilteredCount ?? 0) > 0) {
      return { state: "failed", refused: true, message: reasons.join(" ").slice(0, 300) || "Filtered by safety" };
    }
    return { state: "failed", refused: false, message: "Operation finished without a video" };
  }
  return { state: "succeeded", output: { kind: "url", url: uri, headers: keyHeaders(), mimeType: "video/mp4" } };
}

/**
 * POST /v1beta/interactions with `response_format: { type: "video", aspect_ratio, resolution }`
 * and `background: true` so the call returns an interaction id to poll.
 * https://ai.google.dev/gemini-api/docs/omni and https://ai.google.dev/api/interactions-api (read 2026-10-01).
 * Omni picks a 3–10 s length; `response_format.duration` is a string whose format the docs do not give, so it is omitted.
 */
export function buildOmniRequest(req: ClipRequest) {
  return {
    model: OMNI_API_MODEL,
    input: req.prompt,
    response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" },
    background: true,
  };
}

type OmniInteraction = {
  id?: string;
  status?: string;
  steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string; uri?: string }[] }[];
  error?: { message?: string };
};

/**
 * GET /v1beta/interactions/{id}: `status` is in_progress | requires_action |
 * completed | failed | cancelled | incomplete. The REST video is in
 * `steps[type=model_output].content[type=video]` as base64 `data` (the docs note
 * GET returns inline data even when created with `delivery: "uri"`).
 * https://ai.google.dev/gemini-api/docs/omni — "REST response schema" (read 2026-10-01).
 */
export function readOmniInteraction(interaction: OmniInteraction): ClipPoll {
  const status = interaction.status ?? "";
  if (status === "completed") {
    const video = (interaction.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .find((part) => part.type === "video");
    if (video?.data) {
      return {
        state: "succeeded",
        output: { kind: "bytes", bytes: Buffer.from(video.data, "base64"), mimeType: video.mime_type || "video/mp4" },
      };
    }
    if (video?.uri) {
      return { state: "succeeded", output: { kind: "url", url: video.uri, headers: keyHeaders(), mimeType: "video/mp4" } };
    }
    return { state: "failed", refused: true, message: "Interaction completed without a video (likely blocked)" };
  }
  if (status === "failed" || status === "cancelled" || status === "incomplete" || status === "requires_action") {
    const message = interaction.error?.message || `Interaction ${status}`;
    return { state: "failed", refused: /safety|policy|blocked|violat/i.test(message), message };
  }
  return { state: "pending" };
}

function veoProvider(id: string) {
  return catalogVideoProvider(id, {
    envKeys: ["GEMINI_API_KEY"],
    live: {
      async submit(req) {
        const apiModel = VEO_API_MODEL[id];
        if (!apiModel) throw new ProviderUnavailableError(id, "unknown model");
        const created = (await postJson(
          id,
          `${ROOT}/models/${apiModel}:predictLongRunning`,
          buildVeoRequest(id, req),
          keyHeaders(),
        )) as { name?: string };
        if (!created.name) throw new ProviderUnavailableError(id, "missing operation");
        return { providerJobId: created.name };
      },
      async poll(providerJobId) {
        return readVeoOperation((await getJson(id, `${ROOT}/${providerJobId}`, keyHeaders())) as VeoOperation);
      },
    },
  });
}

export const omniFlash = catalogVideoProvider("omni-flash", {
  envKeys: ["GEMINI_API_KEY"],
  live: {
    async submit(req) {
      const created = (await postJson("omni-flash", `${ROOT}/interactions`, buildOmniRequest(req), keyHeaders())) as OmniInteraction;
      if (!created.id) throw new ProviderUnavailableError("omni-flash", "missing interaction id");
      return { providerJobId: created.id };
    },
    async poll(providerJobId) {
      const body = await getJson("omni-flash", `${ROOT}/interactions/${encodeURIComponent(providerJobId)}`, keyHeaders());
      return readOmniInteraction(body as OmniInteraction);
    },
  },
});
export const veoLite = veoProvider("veo-3.1-lite");
export const veoStandard = veoProvider("veo-3.1-standard");

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
  const response = (await postJson(
    id,
    `${ROOT}/models/${nanoBananaApiModel(id)}:generateContent`,
    buildNanoBananaRequest(prompt),
    keyHeaders(),
  )) as ImageResponse;
  const image = nanoBananaInlineImage(response);
  if (!image) throw new ProviderRefusedError(id, "no image returned (possibly filtered)");
  // Gemini returns the image inline. It is passed on as a data URL; storing it is the caller's job
  // (wave 1 media assets are workspace-scoped and image requests carry no workspace).
  return { providerId: id, url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`, costUsd: price };
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
