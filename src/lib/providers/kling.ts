import { createHmac } from "node:crypto";
import { catalogVideoProvider } from "./catalog";
import { getJson, postJson } from "./live";
import { defineAdapter, ProviderRefusedError, ProviderUnavailableError, type ClipPoll, type ClipRequest } from "./types";

/** The API host moved from api.klingai.com. https://kling.ai/document-api/api/get-started/authentication (read 2026-10-01). */
const ROOT = "https://api-singapore.klingai.com/v1";
const ID = "kling-avatar";

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Legacy Access Key / Secret Key JWT (HS256, 30 min). Same page as ROOT. */
export function klingBearerToken(accessKey: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: nowSeconds + 1800, nbf: nowSeconds - 5 }));
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/** "API Key (for all models)" is the documented scheme; an AK/SK pair still signs a JWT for older accounts. */
function authorization(): string {
  const key = process.env.KLING_API_KEY?.trim();
  if (key) return `Bearer ${key}`;
  const access = process.env.KLING_ACCESS_KEY?.trim() ?? "";
  const secret = process.env.KLING_SECRET_KEY?.trim() ?? "";
  return `Bearer ${klingBearerToken(access, secret)}`;
}

function liveWhen(): boolean {
  if (process.env.PROVIDER_MODE !== "live" || process.env.NODE_ENV === "test") return false;
  const has = (key: string) => Boolean(process.env[key]?.trim());
  return has("KLING_API_KEY") || (has("KLING_ACCESS_KEY") && has("KLING_SECRET_KEY"));
}

/** Kling wants a URL or raw base64 with no `data:` prefix, jpg/jpeg/png only. */
function klingImage(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://")) return url;
  const match = url.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/);
  return match?.[1] ?? null;
}

/**
 * POST /v1/videos/avatar/image2video: `image` (URL or bare base64) plus exactly
 * one of `sound_file` / `audio_id` (2–300 s), optional `prompt` (≤ 2,500
 * chars) and `mode` std | pro. There is no duration or aspect field: length
 * follows the audio and framing follows the image.
 * https://kling.ai/document-api/api/video/avatar (read 2026-10-01).
 */
export function buildKlingAvatarRequest(req: ClipRequest) {
  const image = klingImage(req.imageUrl);
  if (!image) throw new ProviderUnavailableError(ID, "Kling avatar needs a jpg or png portrait");
  if (!req.audioUrl) throw new ProviderUnavailableError(ID, "Kling avatar needs a voice track");
  return { image, sound_file: req.audioUrl, prompt: req.prompt.slice(0, 2500), mode: "std" };
}

type KlingTask = {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: { videos?: { url?: string; duration?: string }[] };
  };
};

const RISK = /risk|safety|sensitive|violat|moderat/i;

/**
 * GET /v1/videos/avatar/image2video/{task_id}: `data.task_status` is
 * submitted | processing | succeed | failed; `task_status_msg` explains a
 * failure (for example content risk control); `task_result.videos[0].url`
 * expires after 30 days. https://kling.ai/document-api/api/video/avatar (read 2026-10-01).
 */
export function readKlingTask(body: KlingTask): ClipPoll {
  if (body.code && body.code !== 0) {
    const message = body.message || `code ${body.code}`;
    return { state: "failed", refused: RISK.test(message), message };
  }
  const data = body.data ?? {};
  if (data.task_status === "succeed") {
    const video = data.task_result?.videos?.[0];
    if (!video?.url) return { state: "failed", refused: false, message: "Task succeeded without a video" };
    const durationS = Number(video.duration);
    return {
      state: "succeeded",
      output: { kind: "url", url: video.url, mimeType: "video/mp4" },
      ...(Number.isFinite(durationS) && durationS > 0 ? { durationS } : {}),
    };
  }
  if (data.task_status === "failed") {
    const message = data.task_status_msg || "failed";
    return { state: "failed", refused: RISK.test(message), message };
  }
  return { state: "pending" };
}

export const klingAvatar = catalogVideoProvider(ID, {
  envKeys: ["KLING_API_KEY"],
  liveWhen,
  live: {
    async submit(req) {
      const headers = { authorization: authorization() };
      const created = (await postJson(ID, `${ROOT}/videos/avatar/image2video`, buildKlingAvatarRequest(req), headers)) as KlingTask;
      if (created.code && created.code !== 0) {
        const message = created.message || `code ${created.code}`;
        if (RISK.test(message)) throw new ProviderRefusedError(ID, message);
        throw new ProviderUnavailableError(ID, message);
      }
      const taskId = created.data?.task_id;
      if (!taskId) throw new ProviderUnavailableError(ID, "missing task");
      return { providerJobId: taskId };
    },
    async poll(providerJobId) {
      const headers = { authorization: authorization() };
      const body = await getJson(ID, `${ROOT}/videos/avatar/image2video/${encodeURIComponent(providerJobId)}`, headers);
      return readKlingTask(body as KlingTask);
    },
  },
});

export const adapter = defineAdapter({ id: "kling", video: [klingAvatar] });
