import type { VideoModel } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { getJson, pollUntil, postJson } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipRequest, type ClipResult } from "./types";

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

async function liveClip(req: ClipRequest, model: VideoModel): Promise<ClipResult> {
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
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const heygenAvatar = catalogVideoProvider("heygen-avatar-iv", { envKeys: ["HEYGEN_API_KEY"], live: liveClip });

export const adapter = defineAdapter({ id: "heygen", video: [heygenAvatar] });
