import { GROK_IMAGINE_IMAGE_USD, GROK_IMAGINE_VIDEO_USD_PER_SEC } from "@/lib/pricing";
import { downloadClip, isLive, pollUntil, postJson, getJson, type PollOptions } from "./live";
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

type GrokVideoStatus = {
  status?: string;
  url?: string;
  video?: { url?: string };
  data?: { url?: string }[];
  error?: string | { message?: string };
};

/** Grok Imagine video job status. Response shape is unverified; accepts the known variants. */
export function grokVideoResult(status: GrokVideoStatus): string | null {
  const state = (status.status ?? "").toLowerCase();
  if (state === "failed" || state === "error" || state === "expired") {
    const message = typeof status.error === "string" ? status.error : status.error?.message ?? state;
    throw new ProviderUnavailableError("grok-imagine-video", message);
  }
  const url = status.video?.url ?? status.url ?? status.data?.[0]?.url;
  if (state === "done" || state === "succeeded" || state === "completed") {
    if (!url) throw new ProviderUnavailableError("grok-imagine-video", "job finished without a video");
    return url;
  }
  return null;
}

export async function liveGrokVideo(req: ClipRequest, poll?: PollOptions): Promise<ClipResult> {
  const headers = { authorization: `Bearer ${process.env.XAI_API_KEY?.trim() ?? ""}` };
  const created = (await postJson(
    "grok-imagine-video",
    `${ROOT}/videos/generations`,
    buildGrokVideoRequest(req),
    headers,
  )) as { id?: string; request_id?: string };
  const jobId = created.id ?? created.request_id;
  if (!jobId) throw new ProviderUnavailableError("grok-imagine-video", "missing job");
  const url = await pollUntil(
    "grok-imagine-video",
    async () =>
      grokVideoResult((await getJson("grok-imagine-video", `${ROOT}/videos/generations/${jobId}`, headers)) as GrokVideoStatus),
    poll,
  );
  const mediaKey = await downloadClip("grok-imagine-video", url);
  return {
    providerId: "grok-imagine-video",
    durationS: req.durationS,
    frameUrls: [],
    mediaKey,
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
    if (isLive(["XAI_API_KEY"])) return liveGrokVideo(req);
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
