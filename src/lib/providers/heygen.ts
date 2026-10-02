import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { downloadClip, getJson, pollUntil, postJson, type PollOptions } from "./live";
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

type HeygenStatus = { data?: { status?: string; video_url?: string; error?: { message?: string } | string } };

export function heygenStatusResult(status: HeygenStatus): string | null {
  const state = status.data?.status;
  if (state === "failed") {
    const error = status.data?.error;
    throw new ProviderUnavailableError("heygen-avatar-iv", typeof error === "string" ? error : error?.message ?? "failed");
  }
  if (state !== "completed") return null;
  const url = status.data?.video_url;
  if (!url) throw new ProviderUnavailableError("heygen-avatar-iv", "completed without a video URL");
  return url;
}

export async function liveHeygenClip(req: ClipRequest, poll?: PollOptions): Promise<ClipResult> {
  const model = catalog.video("heygen-avatar-iv");
  const headers = { "x-api-key": process.env.HEYGEN_API_KEY?.trim() ?? "" };
  const created = (await postJson("heygen-avatar-iv", `${ROOT}/v2/video/generate`, buildHeygenRequest(req), headers)) as {
    data?: { video_id?: string };
  };
  const videoId = created.data?.video_id;
  if (!videoId) throw new ProviderUnavailableError("heygen-avatar-iv", "missing video");
  const url = await pollUntil(
    "heygen-avatar-iv",
    async () =>
      heygenStatusResult(
        (await getJson(
          "heygen-avatar-iv",
          `${ROOT}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
          headers,
        )) as HeygenStatus,
      ),
    poll,
  );
  const mediaKey = await downloadClip("heygen-avatar-iv", url);
  return {
    providerId: "heygen-avatar-iv",
    durationS: req.durationS,
    frameUrls: [],
    mediaKey,
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const heygenAvatar = catalogVideoProvider("heygen-avatar-iv", {
  envKeys: ["HEYGEN_API_KEY"],
  live: (req) => liveHeygenClip(req),
});

export const adapter = defineAdapter({ id: "heygen", video: [heygenAvatar] });
