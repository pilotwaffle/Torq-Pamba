import { createHmac } from "node:crypto";
import { catalog } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { downloadClip, getJson, pollUntil, postJson, type PollOptions } from "./live";
import { defineAdapter, ProviderUnavailableError, type ClipRequest, type ClipResult } from "./types";

const ROOT = "https://api.klingai.com/v1";

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function klingBearerToken(accessKey: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: nowSeconds + 1800, nbf: nowSeconds - 5 }));
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function buildKlingAvatarRequest(req: ClipRequest) {
  return {
    model: "kling-avatar",
    prompt: req.prompt,
    duration: req.durationS,
    mode: "std",
    aspect_ratio: "9:16",
    image: req.imageUrl,
  };
}

type KlingTask = {
  data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: { url?: string }[] } };
};

export function klingTaskResult(task: KlingTask): string | null {
  const state = task.data?.task_status;
  if (state === "failed") throw new ProviderUnavailableError("kling-avatar", task.data?.task_status_msg || "failed");
  if (state !== "succeed") return null;
  const url = task.data?.task_result?.videos?.[0]?.url;
  if (!url) throw new ProviderUnavailableError("kling-avatar", "task finished without a video");
  return url;
}

export async function liveKlingClip(req: ClipRequest, poll?: PollOptions): Promise<ClipResult> {
  const model = catalog.video("kling-avatar");
  const access = process.env.KLING_ACCESS_KEY?.trim() ?? "";
  const secret = process.env.KLING_SECRET_KEY?.trim() ?? "";
  // Kling bearer JWTs expire after 30 minutes, so mint a fresh one for every request.
  const headers = () => ({ authorization: `Bearer ${klingBearerToken(access, secret)}` });
  const created = (await postJson(
    "kling-avatar",
    `${ROOT}/videos/avatar/image2video`,
    buildKlingAvatarRequest(req),
    headers(),
  )) as { data?: { task_id?: string } };
  const taskId = created.data?.task_id;
  if (!taskId) throw new ProviderUnavailableError("kling-avatar", "missing task");
  const url = await pollUntil(
    "kling-avatar",
    async () => klingTaskResult((await getJson("kling-avatar", `${ROOT}/videos/avatar/image2video/${taskId}`, headers())) as KlingTask),
    poll,
  );
  const mediaKey = await downloadClip("kling-avatar", url);
  return {
    providerId: "kling-avatar",
    durationS: req.durationS,
    frameUrls: [],
    mediaKey,
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const klingAvatar = catalogVideoProvider("kling-avatar", {
  envKeys: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
  live: (req) => liveKlingClip(req),
});

export const adapter = defineAdapter({ id: "kling", video: [klingAvatar] });
