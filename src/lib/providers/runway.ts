import type { VideoModel } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { getJson, pollUntil, postJson } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipRequest, type ClipResult } from "./types";

const ROOT = "https://api.dev.runwayml.com/v1";

export function buildRunwayRequest(req: ClipRequest) {
  return {
    model: "seedance2",
    promptText: req.prompt,
    duration: req.durationS,
    ratio: "720:1280",
    resolution: "1080p",
  };
}

async function liveClip(req: ClipRequest, model: VideoModel): Promise<ClipResult> {
  const key = process.env.RUNWAY_API_KEY?.trim() ?? "";
  const headers = { authorization: `Bearer ${key}`, "x-runway-version": "2024-11-06" };
  const created = (await postJson("seedance-2-runway", `${ROOT}/image_to_video`, buildRunwayRequest(req), headers)) as {
    id?: string;
  };
  if (!created.id) throw new ProviderUnavailableError("seedance-2-runway", "missing task");
  const taskId = created.id;
  await pollUntil("seedance-2-runway", async () => {
    const status = (await getJson("seedance-2-runway", `${ROOT}/tasks/${taskId}`, headers)) as { status?: string };
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      throw new ProviderUnavailableError("seedance-2-runway", status.status);
    }
    return status.status === "SUCCEEDED" ? "done" : "pending";
  });
  return {
    providerId: "seedance-2-runway",
    durationS: req.durationS,
    frameUrls: [],
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const seedanceRunway = catalogVideoProvider("seedance-2-runway", { envKeys: ["RUNWAY_API_KEY"], live: liveClip });

export const adapter = defineAdapter({ id: "runway", video: [seedanceRunway] });
