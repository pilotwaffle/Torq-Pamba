import {
  OMNI_FLASH_USD_PER_SEC,
  VEO_31_LITE_USD_PER_SEC,
  VEO_31_STANDARD_USD_PER_SEC,
  type Tier,
} from "@/lib/pricing";
import { isLive, pollUntil, postJson, getJson } from "./live";
import { mockGenerateClip } from "./mock";
import { ProviderUnavailableError, type ClipRequest, type ClipResult, type VideoProvider } from "./types";

const ROOT = "https://generativelanguage.googleapis.com/v1beta";

const MODELS: Record<string, { apiModel: string; tier: Tier; price: number; label: string }> = {
  "omni-flash": {
    apiModel: "gemini-omni-flash",
    tier: "standard",
    price: OMNI_FLASH_USD_PER_SEC,
    label: "Gemini Omni Flash",
  },
  "veo-3.1-lite": {
    apiModel: "veo-3.1-lite",
    tier: "budget",
    price: VEO_31_LITE_USD_PER_SEC,
    label: "Veo 3.1 Lite",
  },
  "veo-3.1-standard": {
    apiModel: "veo-3.1-standard",
    tier: "premium",
    price: VEO_31_STANDARD_USD_PER_SEC,
    label: "Veo 3.1 Standard",
  },
};

export function buildGoogleVideoRequest(providerId: string, req: ClipRequest) {
  const spec = MODELS[providerId];
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      durationSeconds: req.durationS,
      aspectRatio: "9:16",
      resolution: providerId === "veo-3.1-standard" ? "1080p" : "720p",
      model: spec?.apiModel,
    },
  };
}

async function liveClip(providerId: string, req: ClipRequest): Promise<ClipResult> {
  const spec = MODELS[providerId];
  if (!spec) throw new ProviderUnavailableError(providerId, "unknown model");
  const key = process.env.GEMINI_API_KEY?.trim() ?? "";
  const headers = { "x-goog-api-key": key };
  const body = buildGoogleVideoRequest(providerId, req);
  const created = (await postJson(
    providerId,
    `${ROOT}/models/${spec.apiModel}:predictLongRunning`,
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
    costUsd: spec.price * req.durationS,
  };
}

function googleProvider(id: string): VideoProvider {
  const spec = MODELS[id];
  if (!spec) throw new Error(`Unknown Google model ${id}`);
  return {
    id,
    vendor: "google",
    label: spec.label,
    tier: spec.tier,
    pricePerSecondUsd: spec.price,
    maxDurationS: 60,
    async generateClip(req) {
      if (isLive(["GEMINI_API_KEY"])) return liveClip(id, req);
      return mockGenerateClip(id, spec.price, req);
    },
  };
}

export const omniFlash = googleProvider("omni-flash");
export const veoLite = googleProvider("veo-3.1-lite");
export const veoStandard = googleProvider("veo-3.1-standard");
