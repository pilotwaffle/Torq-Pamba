import { catalogVideoProvider } from "./catalog";
import { getJson, pollUntil, postJson } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipRequest, type ClipResult } from "./types";

const ROOT = "https://generativelanguage.googleapis.com/v1beta";

const API_MODEL: Record<string, string> = {
  "omni-flash": "gemini-omni-flash",
  "veo-3.1-lite": "veo-3.1-lite",
  "veo-3.1-standard": "veo-3.1-standard",
};

export function buildGoogleVideoRequest(providerId: string, req: ClipRequest) {
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      durationSeconds: req.durationS,
      aspectRatio: "9:16",
      resolution: providerId === "veo-3.1-standard" ? "1080p" : "720p",
      model: API_MODEL[providerId],
    },
  };
}

async function liveClip(providerId: string, req: ClipRequest, usdPerSecond: number): Promise<ClipResult> {
  const apiModel = API_MODEL[providerId];
  if (!apiModel) throw new ProviderUnavailableError(providerId, "unknown model");
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const headers = { "x-goog-api-key": key };
  const body = buildGoogleVideoRequest(providerId, req);
  const created = (await postJson(
    providerId,
    `${ROOT}/models/${apiModel}:predictLongRunning`,
    body,
    headers,
  )) as { name?: string };
  if (!created.name) throw new ProviderUnavailableError(providerId, "missing operation");
  const operation = created.name;
  await pollUntil(providerId, async () => {
    const status = (await getJson(providerId, `${ROOT}/${operation}`, headers)) as { done?: boolean };
    return status.done ? "done" : "pending";
  });
  return {
    providerId,
    durationS: req.durationS,
    frameUrls: [],
    costUsd: usdPerSecond * req.durationS,
  };
}

function googleProvider(id: string) {
  return catalogVideoProvider(id, {
    envKeys: ["GEMINI_API_KEY"],
    live: (req, model) => liveClip(id, req, model.usdPerSecond),
  });
}

export const omniFlash = googleProvider("omni-flash");
export const veoLite = googleProvider("veo-3.1-lite");
export const veoStandard = googleProvider("veo-3.1-standard");

export const adapter = defineAdapter({ id: "google", video: [omniFlash, veoLite, veoStandard] });
