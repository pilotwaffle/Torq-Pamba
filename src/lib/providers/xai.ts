import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { clampDuration, getJson, isLive, postJson } from "./live";
import { mockGenerateImage } from "./mock";
import {
  defineAdapter,
  ProviderUnavailableError,
  type ClipPoll,
  type ClipRequest,
  type ImageProvider,
} from "./types";

const ROOT = "https://api.x.ai/v1";
const VIDEO_ID = "grok-imagine-video";

function authHeaders() {
  return { authorization: `Bearer ${process.env.XAI_API_KEY?.trim() ?? ""}` };
}

/**
 * POST /v1/videos/generations. `duration` is 1–15 s, `aspect_ratio` includes
 * 9:16, `resolution` is 480p / 720p / 1080p, and `image.url` animates a start
 * frame. https://docs.x.ai/developers/rest-api-reference/inference/videos and
 * https://docs.x.ai/developers/model-capabilities/video/generation (read 2026-10-01).
 */
export function buildGrokVideoRequest(req: ClipRequest) {
  return {
    model: VIDEO_ID,
    prompt: req.prompt,
    duration: clampDuration(req.durationS, 1, 15),
    resolution: "720p",
    aspect_ratio: "9:16",
    ...(req.imageUrl ? { image: { url: req.imageUrl } } : {}),
  };
}

export function buildGrokImageRequest(prompt: string) {
  return { model: "grok-imagine-image", prompt, n: 1, response_format: "url" };
}

type GrokVideoStatus = {
  status?: string;
  video?: { url?: string | null; duration?: number; respect_moderation?: boolean };
  error?: { code?: string; message?: string };
};

/** Codes that mean the prompt or input was rejected rather than the service failing. */
const GROK_REFUSAL_CODES = new Set(["invalid_argument", "permission_denied", "failed_precondition"]);

/**
 * GET /v1/videos/{request_id}: `status` is pending | done | expired | failed.
 * When `video.respect_moderation` is false the url is empty, which is a refusal.
 * https://docs.x.ai/developers/rest-api-reference/inference/videos (read 2026-10-01).
 */
export function readGrokVideoStatus(body: GrokVideoStatus): ClipPoll {
  if (body.status === "done") {
    const url = body.video?.url ?? "";
    if (!url || body.video?.respect_moderation === false) {
      return { state: "failed", refused: true, message: "Moderation blocked the video" };
    }
    return { state: "succeeded", output: { kind: "url", url, mimeType: "video/mp4" }, durationS: body.video?.duration };
  }
  if (body.status === "failed") {
    const code = body.error?.code ?? "";
    return { state: "failed", refused: GROK_REFUSAL_CODES.has(code), message: body.error?.message || code || "failed" };
  }
  if (body.status === "expired") return { state: "failed", refused: false, message: "Request expired" };
  return { state: "pending" };
}

export const grokImagineVideo = catalogVideoProvider(VIDEO_ID, {
  envKeys: ["XAI_API_KEY"],
  live: {
    async submit(req) {
      const created = (await postJson(VIDEO_ID, `${ROOT}/videos/generations`, buildGrokVideoRequest(req), authHeaders())) as {
        request_id?: string;
      };
      if (!created.request_id) throw new ProviderUnavailableError(VIDEO_ID, "missing request_id");
      return { providerJobId: created.request_id };
    },
    async poll(providerJobId) {
      const body = (await getJson(VIDEO_ID, `${ROOT}/videos/${encodeURIComponent(providerJobId)}`, authHeaders())) as GrokVideoStatus;
      return readGrokVideoStatus(body);
    },
  },
});

const imageModel = catalog.image("grok-imagine-image");
const GROK_IMAGINE_IMAGE_USD = imageModel.usdPerImage;

export const grokImagineImage: ImageProvider = {
  id: "grok-imagine-image",
  vendor: "xai",
  label: imageModel.label,
  pricePerImageUsd: GROK_IMAGINE_IMAGE_USD,
  async generateImage(req) {
    if (isLive(["XAI_API_KEY"])) {
      const created = (await postJson(
        "grok-imagine-image",
        `${ROOT}/images/generations`,
        buildGrokImageRequest(req.prompt),
        authHeaders(),
      )) as { data?: { url?: string }[] };
      const url = created.data?.[0]?.url;
      if (!url) throw new ProviderUnavailableError("grok-imagine-image", "missing image");
      return { providerId: "grok-imagine-image", url, costUsd: GROK_IMAGINE_IMAGE_USD };
    }
    return mockGenerateImage("grok-imagine-image", GROK_IMAGINE_IMAGE_USD, req.prompt);
  },
};

export const adapter = defineAdapter({ id: "xai", video: [grokImagineVideo], image: [grokImagineImage] });
