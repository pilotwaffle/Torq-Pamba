import { catalog, type VideoModel } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { getJson, isLive, pollUntil, postJson } from "./live";
import { mockGenerateImage } from "./mock";
import { defineAdapter, ProviderUnavailableError, type ClipRequest, type ClipResult, type ImageProvider } from "./types";

const ROOT = "https://api.x.ai/v1";

export function buildGrokVideoRequest(req: ClipRequest) {
  return {
    model: "grok-imagine-video",
    prompt: req.prompt,
    duration: req.durationS,
    resolution: "720p",
    aspect_ratio: "9:16",
  };
}

export function buildGrokImageRequest(prompt: string) {
  return { model: "grok-imagine-image", prompt, n: 1, response_format: "url" };
}

async function liveVideo(req: ClipRequest, model: VideoModel): Promise<ClipResult> {
  const headers = { authorization: `Bearer ${process.env.XAI_API_KEY?.trim() ?? ""}` };
  const created = (await postJson(
    "grok-imagine-video",
    `${ROOT}/videos/generations`,
    buildGrokVideoRequest(req),
    headers,
  )) as { id?: string; request_id?: string };
  const jobId = created.id ?? created.request_id;
  if (!jobId) throw new ProviderUnavailableError("grok-imagine-video", "missing job");
  await pollUntil("grok-imagine-video", async () => {
    const status = (await getJson("grok-imagine-video", `${ROOT}/videos/generations/${jobId}`, headers)) as {
      status?: string;
    };
    return status.status === "done" || status.status === "succeeded" ? "done" : "pending";
  });
  return {
    providerId: "grok-imagine-video",
    durationS: req.durationS,
    frameUrls: [],
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const grokImagineVideo = catalogVideoProvider("grok-imagine-video", { envKeys: ["XAI_API_KEY"], live: liveVideo });

const imageModel = catalog.image("grok-imagine-image");
const GROK_IMAGINE_IMAGE_USD = imageModel.usdPerImage;

export const grokImagineImage: ImageProvider = {
  id: "grok-imagine-image",
  vendor: "xai",
  label: imageModel.label,
  pricePerImageUsd: GROK_IMAGINE_IMAGE_USD,
  async generateImage(req) {
    if (isLive(["XAI_API_KEY"])) {
      const headers = { authorization: `Bearer ${process.env.XAI_API_KEY?.trim() ?? ""}` };
      const created = (await postJson(
        "grok-imagine-image",
        `${ROOT}/images/generations`,
        buildGrokImageRequest(req.prompt),
        headers,
      )) as { data?: { url?: string }[] };
      const url = created.data?.[0]?.url;
      if (!url) throw new ProviderUnavailableError("grok-imagine-image", "missing image");
      return { providerId: "grok-imagine-image", url, costUsd: GROK_IMAGINE_IMAGE_USD };
    }
    return mockGenerateImage("grok-imagine-image", GROK_IMAGINE_IMAGE_USD, req.prompt);
  },
};

export const adapter = defineAdapter({ id: "xai", video: [grokImagineVideo], image: [grokImagineImage] });
