import { catalogVideoProvider } from "./catalog";
import { getJson, postJson } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipPoll, type ClipRequest } from "./types";

const ROOT = "https://api.heygen.com";
const ID = "heygen-avatar-iv";

function headers() {
  return { "x-api-key": process.env.HEYGEN_API_KEY?.trim() ?? "" };
}

/**
 * POST /v3/videos with `type: "image"` animates a photo (Avatar IV is the
 * default engine). Speech is `script` + `voice_id`, or `audio_url`, never both.
 * v2 `/v2/video/generate` and `/v1/video_status.get` are retired.
 * https://developers.heygen.com/reference/create-video and https://developers.heygen.com/image-to-video (read 2026-10-01).
 */
export function buildHeygenRequest(req: ClipRequest, voiceId = process.env.HEYGEN_VOICE_ID?.trim() ?? "") {
  if (!req.imageUrl?.startsWith("https://")) throw new ProviderUnavailableError(ID, "HeyGen needs an https portrait URL");
  const speech = req.audioUrl
    ? { audio_url: req.audioUrl }
    : voiceId
      ? { script: req.prompt.slice(0, 1500), voice_id: voiceId }
      : null;
  if (!speech) throw new ProviderUnavailableError(ID, "HeyGen needs a voice track or HEYGEN_VOICE_ID");
  return {
    type: "image",
    image: { type: "url", url: req.imageUrl },
    ...speech,
    aspect_ratio: "9:16",
    title: req.prompt.slice(0, 80),
  };
}

type HeygenVideo = { status?: string; video_url?: string | null; failure_code?: string | null; failure_message?: string | null };

/**
 * GET /v3/videos/{video_id}: `status` is pending | processing | completed |
 * failed, with a presigned `video_url` when completed.
 * https://developers.heygen.com/reference/get-video (read 2026-10-01).
 */
export function readHeygenVideo(body: HeygenVideo | { data?: HeygenVideo }): ClipPoll {
  const video: HeygenVideo = "data" in body && body.data ? body.data : (body as HeygenVideo);
  if (video.status === "completed") {
    if (!video.video_url) return { state: "failed", refused: false, message: "Completed without a video_url" };
    return { state: "succeeded", output: { kind: "url", url: video.video_url, mimeType: "video/mp4" } };
  }
  if (video.status === "failed") {
    const message = [video.failure_code, video.failure_message].filter(Boolean).join(": ") || "failed";
    return { state: "failed", refused: /moderat|safety|policy|violat/i.test(message), message };
  }
  return { state: "pending" };
}

export const heygenAvatar = catalogVideoProvider(ID, {
  envKeys: ["HEYGEN_API_KEY"],
  live: {
    async submit(req) {
      const created = (await postJson(ID, `${ROOT}/v3/videos`, buildHeygenRequest(req), headers())) as {
        data?: { video_id?: string };
      };
      const videoId = created.data?.video_id;
      if (!videoId) throw new ProviderUnavailableError(ID, "missing video_id");
      return { providerJobId: videoId };
    },
    async poll(providerJobId) {
      const body = await getJson(ID, `${ROOT}/v3/videos/${encodeURIComponent(providerJobId)}`, headers());
      return readHeygenVideo(body as HeygenVideo);
    },
  },
});

export const adapter = defineAdapter({ id: "heygen", video: [heygenAvatar] });
