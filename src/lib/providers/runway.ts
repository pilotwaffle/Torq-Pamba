import { catalogVideoProvider } from "./catalog";
import { clampDuration, getJson, postJson } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipPoll, type ClipRequest } from "./types";

const ROOT = "https://api.dev.runwayml.com/v1";
const ID = "seedance-2-runway";

function headers() {
  // Every request needs X-Runway-Version. https://docs.dev.runwayml.com/ai-context.md (read 2026-10-01).
  return { authorization: `Bearer ${process.env.RUNWAY_API_KEY?.trim() ?? ""}`, "x-runway-version": "2024-11-06" };
}

/**
 * Seedance 2.0 on Runway. Text-to-video is POST /v1/text_to_video with model
 * `seedance2`, `promptText` (≤ 3,500 chars), `duration` 4–15 and a `ratio`;
 * 1080:1920 is 9:16 at 1080p (the 40 credits/s rate in the catalog). With a
 * start frame it is POST /v1/image_to_video with `promptImage: [{ uri, position: "first" }]`.
 * There is no `resolution` field for seedance2; the ratio sets the size.
 * https://docs.dev.runwayml.com/api.md — "POST /v1/text_to_video - model `seedance2`" (read 2026-10-01).
 */
export function buildRunwayRequest(req: ClipRequest) {
  const body = {
    model: "seedance2",
    promptText: req.prompt.slice(0, 3500),
    duration: clampDuration(req.durationS, 4, 15),
    ratio: "1080:1920",
  };
  if (req.imageUrl && /^(https:|data:image\/)/.test(req.imageUrl)) {
    return { endpoint: "image_to_video", body: { ...body, promptImage: [{ uri: req.imageUrl, position: "first" }] } };
  }
  return { endpoint: "text_to_video", body };
}

type RunwayTask = { status?: string; output?: string[]; failure?: string; failureCode?: string };

/**
 * GET /v1/tasks/{id}: `status` is PENDING | THROTTLED | RUNNING | SUCCEEDED |
 * FAILED | CANCELLED (the API reference spells it CANCELLED; the guide says
 * CANCELED, so both are handled). `output` holds URLs that expire in 24–48 h.
 * `failureCode` starting with SAFETY. (or INPUT_PREPROCESSING.SAFETY) is moderation.
 * https://docs.dev.runwayml.com/api.md and https://docs.dev.runwayml.com/errors/task-failures (read 2026-10-01).
 */
export function readRunwayTask(task: RunwayTask): ClipPoll {
  const status = task.status ?? "";
  if (status === "SUCCEEDED") {
    const url = task.output?.[0];
    if (!url) return { state: "failed", refused: false, message: "Task succeeded without output" };
    return { state: "succeeded", output: { kind: "url", url, mimeType: "video/mp4" } };
  }
  if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") {
    const code = task.failureCode ?? "";
    return {
      state: "failed",
      refused: /(^|\.)SAFETY(\.|$)/.test(code),
      message: [code, task.failure].filter(Boolean).join(": ") || status,
    };
  }
  return { state: "pending" };
}

export const seedanceRunway = catalogVideoProvider(ID, {
  envKeys: ["RUNWAY_API_KEY"],
  live: {
    async submit(req) {
      const { endpoint, body } = buildRunwayRequest(req);
      const created = (await postJson(ID, `${ROOT}/${endpoint}`, body, headers())) as { id?: string };
      if (!created.id) throw new ProviderUnavailableError(ID, "missing task");
      return { providerJobId: created.id };
    },
    async poll(providerJobId) {
      return readRunwayTask((await getJson(ID, `${ROOT}/tasks/${encodeURIComponent(providerJobId)}`, headers())) as RunwayTask);
    },
  },
});

export const adapter = defineAdapter({ id: "runway", video: [seedanceRunway] });
