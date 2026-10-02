import { catalog } from "@/lib/models";
import { mockLipsync } from "@/lib/voices/mock";
import type { LipsyncProgress, LipsyncProvider, LipsyncRequest } from "@/lib/voices/types";
import { decodeDataUrl } from "@/lib/voices/wav";
import { isLive } from "./live";
import { defineAdapter, ProviderRefusedError, ProviderUnavailableError } from "./types";

const ROOT = "https://api.heygen.com";
const ENV_KEYS = ["HEYGEN_API_KEY"];
const ID = "heygen-avatar-iv";
const RASTER = new Set(["image/png", "image/jpeg"]);

function headers(): Record<string, string> {
  return { "x-api-key": process.env.HEYGEN_API_KEY?.trim() ?? "" };
}

async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new ProviderUnavailableError(ID, error instanceof Error ? error.message : "network");
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = text.slice(0, 300);
    if (response.status === 400 || response.status === 422 || /safety|refus|blocked|moderation/i.test(message)) {
      throw new ProviderRefusedError(ID, message || "HeyGen refused the request");
    }
    throw new ProviderUnavailableError(ID, message || `HTTP ${response.status}`);
  }
  return json;
}

/** HeyGen animates PNG or JPEG photos. `https:` URLs pass through; data URLs go inline as base64. */
export function heygenImage(imageUrl: string): Record<string, string> {
  if (imageUrl.startsWith("https://")) return { type: "url", url: imageUrl };
  const decoded = decodeDataUrl(imageUrl);
  if (decoded && RASTER.has(decoded.mimeType)) {
    return { type: "base64", media_type: decoded.mimeType, data: Buffer.from(decoded.bytes).toString("base64") };
  }
  throw new ProviderUnavailableError(ID, "HeyGen needs a PNG or JPEG portrait for this avatar");
}

/** Body for `POST /v3/videos`: an image subject lip-synced to our audio. https://developers.heygen.com/reference/create-video — read 2026-10-01. */
export function buildHeygenLipsyncBody(
  req: LipsyncRequest,
  audio: { audio_url: string } | { audio_asset_id: string },
): Record<string, unknown> {
  return {
    type: "image",
    image: heygenImage(req.imageUrl),
    ...audio,
    title: req.title.slice(0, 80),
    aspect_ratio: "9:16",
    resolution: "720p",
  };
}

async function uploadAudio(url: string, mimeType: string): Promise<string> {
  const decoded = decodeDataUrl(url);
  if (!decoded) throw new ProviderUnavailableError(ID, "audio is not a data URL");
  const form = new FormData();
  const extension = mimeType === "audio/wav" ? "wav" : "mp3";
  form.append("file", new Blob([decoded.bytes.slice()], { type: mimeType }), `voice.${extension}`);
  const json = await call(`${ROOT}/v3/assets`, { method: "POST", headers: headers(), body: form });
  const data = (json.data ?? json) as { asset_id?: string; id?: string };
  const assetId = data.asset_id ?? data.id;
  if (!assetId) throw new ProviderUnavailableError(ID, "missing asset_id");
  return assetId;
}

export function readHeygenStatus(json: Record<string, unknown>): LipsyncProgress {
  const data = (json.data ?? {}) as {
    status?: string;
    video_url?: string | null;
    thumbnail_url?: string | null;
    duration?: number | null;
    failure_message?: string | null;
  };
  if (data.status === "failed") return { status: "failed", error: data.failure_message || "HeyGen failed the video" };
  if (data.status === "completed" && data.video_url) {
    return {
      status: "succeeded",
      output: {
        url: data.video_url,
        mimeType: "video/mp4",
        durationMs: Math.round((data.duration ?? 0) * 1000),
        posterUrl: data.thumbnail_url ?? null,
      },
    };
  }
  return { status: "running" };
}

const model = catalog.video(ID);

export const heygenLipsync: LipsyncProvider = {
  id: ID,
  vendor: model.vendor,
  label: model.label,
  usdPerSecond: model.usdPerSecond,
  maxDurationS: model.maxDurationS,
  isLive: () => isLive(ENV_KEYS),
  async submit(req) {
    if (!isLive(ENV_KEYS)) {
      const output = mockLipsync(ID, req);
      return { providerJobId: `mock_${crypto.randomUUID()}`, status: "succeeded", output };
    }
    const audio = req.audio.url.startsWith("https://")
      ? { audio_url: req.audio.url }
      : { audio_asset_id: await uploadAudio(req.audio.url, req.audio.mimeType) };
    const json = await call(`${ROOT}/v3/videos`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(buildHeygenLipsyncBody(req, audio)),
    });
    const videoId = ((json.data ?? {}) as { video_id?: string }).video_id;
    if (!videoId) throw new ProviderUnavailableError(ID, "missing video_id");
    return { providerJobId: videoId, status: "running" };
  },
  async poll(providerJobId) {
    if (providerJobId.startsWith("mock_")) return { status: "failed", error: "Mock jobs finish on submit" };
    if (!isLive(ENV_KEYS)) return { status: "running" };
    return readHeygenStatus(await call(`${ROOT}/v3/videos/${encodeURIComponent(providerJobId)}`, { headers: headers() }));
  },
};

export const adapter = defineAdapter({ id: "heygen-lipsync", lipsync: [heygenLipsync] });
