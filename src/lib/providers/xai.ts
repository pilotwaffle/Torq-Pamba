import { GROK_IMAGINE_IMAGE_USD, GROK_IMAGINE_VIDEO_USD_PER_SEC } from "@/lib/pricing";
import { isLive, pollUntil, postJson, getJson } from "./live";
import { mockGenerateClip, mockGenerateImage } from "./mock";
import { ProviderUnavailableError, type ClipRequest, type ClipResult, type ImageProvider, type VideoProvider } from "./types";

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

async function liveVideo(req: ClipRequest): Promise<ClipResult> {
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
    costUsd: GROK_IMAGINE_VIDEO_USD_PER_SEC * req.durationS,
  };
}

export const grokImagineVideo: VideoProvider = {
  id: "grok-imagine-video",
  vendor: "xai",
  label: "Grok Imagine Video",
  tier: "budget",
  pricePerSecondUsd: GROK_IMAGINE_VIDEO_USD_PER_SEC,
  maxDurationS: 60,
  async generateClip(req) {
    if (isLive(["XAI_API_KEY"])) return liveVideo(req);
    return mockGenerateClip(this.id, this.pricePerSecondUsd, req);
  },
};

export const grokImagineImage: ImageProvider = {
  id: "grok-imagine-image",
  vendor: "xai",
  label: "Grok Imagine Image",
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
