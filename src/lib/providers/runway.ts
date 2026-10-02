import { SEEDANCE_2_RUNWAY_USD_PER_SEC } from "@/lib/pricing";
import { downloadClip, isLive, pollUntil, postJson, getJson, type PollOptions } from "./live";
import { mockGenerateClip } from "./mock";
import { ProviderRefusedError, ProviderUnavailableError, type ClipRequest, type ClipResult, type VideoProvider } from "./types";

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

type RunwayTask = { status?: string; output?: string[]; failure?: string; failureCode?: string };

export function runwayTaskResult(task: RunwayTask): string | null {
  if (task.status === "FAILED" || task.status === "CANCELLED") {
    const reason = task.failure ?? task.status;
    if (/SAFETY|moderation/i.test(`${task.failureCode ?? ""} ${reason}`)) {
      throw new ProviderRefusedError("seedance-2-runway", reason);
    }
    throw new ProviderUnavailableError("seedance-2-runway", reason);
  }
  if (task.status !== "SUCCEEDED") return null;
  const url = task.output?.[0];
  if (!url) throw new ProviderUnavailableError("seedance-2-runway", "task finished without output");
  return url;
}

export async function liveRunwayClip(req: ClipRequest, poll?: PollOptions): Promise<ClipResult> {
  const key = process.env.RUNWAY_API_KEY?.trim() ?? "";
  const headers = { authorization: `Bearer ${key}`, "x-runway-version": "2024-11-06" };
  const created = (await postJson("seedance-2-runway", `${ROOT}/image_to_video`, buildRunwayRequest(req), headers)) as {
    id?: string;
  };
  if (!created.id) throw new ProviderUnavailableError("seedance-2-runway", "missing task");
  const taskId = created.id;
  const url = await pollUntil(
    "seedance-2-runway",
    async () => runwayTaskResult((await getJson("seedance-2-runway", `${ROOT}/tasks/${taskId}`, headers)) as RunwayTask),
    poll,
  );
  const mediaKey = await downloadClip("seedance-2-runway", url);
  return {
    providerId: "seedance-2-runway",
    durationS: req.durationS,
    frameUrls: [],
    mediaKey,
    costUsd: SEEDANCE_2_RUNWAY_USD_PER_SEC * req.durationS,
  };
}

export const seedanceRunway: VideoProvider = {
  id: "seedance-2-runway",
  vendor: "runway",
  label: "Seedance 2.0 via Runway",
  tier: "premium",
  pricePerSecondUsd: SEEDANCE_2_RUNWAY_USD_PER_SEC,
  maxDurationS: 60,
  async generateClip(req) {
    if (isLive(["RUNWAY_API_KEY"])) return liveRunwayClip(req);
    return mockGenerateClip(this.id, this.pricePerSecondUsd, req);
  },
};
