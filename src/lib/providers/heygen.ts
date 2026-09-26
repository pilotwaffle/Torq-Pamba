import { HEYGEN_AVATAR_IV_USD_PER_SEC } from "@/lib/pricing";
import { getJson, isLive, pollUntil, postJson } from "./live";
import { mockGenerateClip } from "./mock";
import { ProviderUnavailableError, type ClipRequest, type ClipResult, type VideoProvider } from "./types";

const ROOT = "https://api.heygen.com";

export function buildHeygenRequest(req: ClipRequest) {
  return {
    video_inputs: [
      {
        character: { type: "talking_photo", talking_photo_id: req.imageUrl ?? "" },
        voice: { type: "text", input_text: req.prompt.slice(0, 1500) },
      },
    ],
    dimension: { width: 720, height: 1280 },
    title: req.prompt.slice(0, 80),
  };
}

async function liveClip(req: ClipRequest): Promise<ClipResult> {
  const headers = { "x-api-key": process.env.HEYGEN_API_KEY?.trim() ?? "" };
  const created = (await postJson("heygen-avatar-iv", `${ROOT}/v2/video/generate`, buildHeygenRequest(req), headers)) as {
    data?: { video_id?: string };
  };
  const videoId = created.data?.video_id;
  if (!videoId) throw new ProviderUnavailableError("heygen-avatar-iv", "missing video");
  await pollUntil("heygen-avatar-iv", async () => {
    const status = (await getJson(
      "heygen-avatar-iv",
      `${ROOT}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      headers,
    )) as { data?: { status?: string } };
    const state = status.data?.status;
    if (state === "failed") throw new ProviderUnavailableError("heygen-avatar-iv", "failed");
    return state === "completed" ? "done" : "pending";
  });
  return {
    providerId: "heygen-avatar-iv",
    durationS: req.durationS,
    frameUrls: [],
    costUsd: HEYGEN_AVATAR_IV_USD_PER_SEC * req.durationS,
  };
}

export const heygenAvatar: VideoProvider = {
  id: "heygen-avatar-iv",
  vendor: "heygen",
  label: "HeyGen Avatar IV",
  tier: "budget",
  pricePerSecondUsd: HEYGEN_AVATAR_IV_USD_PER_SEC,
  maxDurationS: 60,
  async generateClip(req) {
    if (isLive(["HEYGEN_API_KEY"])) return liveClip(req);
    return mockGenerateClip(this.id, this.pricePerSecondUsd, req);
  },
};
