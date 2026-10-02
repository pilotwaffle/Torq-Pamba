import { catalog } from "@/lib/models";
import { mockClone, mockSynthesize } from "@/lib/voices/mock";
import type { CloneRequest, CloneResult, SpeechRequest, SpeechResult, VoiceProvider } from "@/lib/voices/types";
import { isLive } from "./live";
import { defineAdapter, ProviderRefusedError, ProviderUnavailableError } from "./types";

const ROOT = "https://api.elevenlabs.io";
const ENV_KEYS = ["ELEVENLABS_API_KEY"];
/** 128 kbps CBR, so the duration follows from the byte count. Available on every plan. */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const MP3_BYTES_PER_MS = 128_000 / 8 / 1000;

/** Catalog voice model → ElevenLabs `model_id` and per-request character limit. https://elevenlabs.io/docs/models — read 2026-10-01. */
export const ELEVENLABS_MODELS: Record<string, { modelId: string; maxChars: number }> = {
  "elevenlabs-v3": { modelId: "eleven_v3", maxChars: 5000 },
  "elevenlabs-flash": { modelId: "eleven_flash_v2_5", maxChars: 40_000 },
};

function headers(): Record<string, string> {
  return { "xi-api-key": process.env.ELEVENLABS_API_KEY?.trim() ?? "" };
}

async function call(providerId: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new ProviderUnavailableError(providerId, error instanceof Error ? error.message : "network");
  }
  if (response.ok) return response;
  const message = (await response.text().catch(() => "")).slice(0, 300);
  if (response.status === 400 || response.status === 422 || /safety|refus|blocked/i.test(message)) {
    throw new ProviderRefusedError(providerId, message || "ElevenLabs refused the request");
  }
  throw new ProviderUnavailableError(providerId, message || `HTTP ${response.status}`);
}

export function buildSpeechRequest(modelId: string, req: SpeechRequest): { url: string; body: Record<string, unknown> } {
  return {
    url: `${ROOT}/v1/text-to-speech/${encodeURIComponent(req.providerVoiceId)}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
    body: { text: req.text, model_id: modelId },
  };
}

export function buildCloneForm(req: CloneRequest): FormData {
  const form = new FormData();
  form.append("name", req.name);
  if (req.description) form.append("description", req.description);
  for (const sample of req.samples) {
    form.append("files", new Blob([sample.bytes.slice()], { type: sample.mimeType }), sample.filename);
  }
  return form;
}

function elevenlabsVoice(id: string): VoiceProvider {
  const model = catalog.voice(id);
  const vendorModel = ELEVENLABS_MODELS[id];
  if (!vendorModel) throw new Error(`No ElevenLabs model id for ${id}`);

  async function synthesize(req: SpeechRequest): Promise<SpeechResult> {
    if (!isLive(ENV_KEYS)) return mockSynthesize(id, model.usdPer1KChars, req);
    const { url, body } = buildSpeechRequest(vendorModel!.modelId, req);
    const response = await call(id, url, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new ProviderUnavailableError(id, "empty audio");
    return {
      providerId: id,
      audio: { bytes, mimeType: "audio/mpeg", filename: "speech.mp3" },
      durationMs: Math.round(bytes.length / MP3_BYTES_PER_MS),
      costUsd: (model.usdPer1KChars * req.text.length) / 1000,
    };
  }

  async function cloneVoice(req: CloneRequest): Promise<CloneResult> {
    if (!isLive(ENV_KEYS)) return mockClone(req);
    const response = await call(id, `${ROOT}/v1/voices/add`, {
      method: "POST",
      headers: headers(),
      body: buildCloneForm(req),
    });
    const json = (await response.json()) as { voice_id?: string; requires_verification?: boolean };
    if (!json.voice_id) throw new ProviderUnavailableError(id, "missing voice_id");
    return { provider: "elevenlabs", providerVoiceId: json.voice_id, requiresVerification: Boolean(json.requires_verification) };
  }

  async function deleteVoice(providerVoiceId: string): Promise<void> {
    if (!isLive(ENV_KEYS)) return;
    await call(id, `${ROOT}/v1/voices/${encodeURIComponent(providerVoiceId)}`, { method: "DELETE", headers: headers() });
  }

  async function previewUrl(providerVoiceId: string): Promise<string | null> {
    if (!isLive(ENV_KEYS)) return null;
    const response = await call(id, `${ROOT}/v1/voices/${encodeURIComponent(providerVoiceId)}`, { headers: headers() });
    const json = (await response.json()) as { preview_url?: string | null };
    return typeof json.preview_url === "string" && json.preview_url.startsWith("https://") ? json.preview_url : null;
  }

  return {
    id,
    vendor: model.vendor,
    label: model.label,
    usdPer1KChars: model.usdPer1KChars,
    maxChars: vendorModel.maxChars,
    isLive: () => isLive(ENV_KEYS),
    synthesize,
    cloneVoice,
    deleteVoice,
    previewUrl,
  };
}

export const elevenlabsV3 = elevenlabsVoice("elevenlabs-v3");
export const elevenlabsFlash = elevenlabsVoice("elevenlabs-flash");

export const adapter = defineAdapter({ id: "elevenlabs", voice: [elevenlabsV3, elevenlabsFlash] });
