import { createHmac } from "node:crypto";
import type { VideoModel } from "@/lib/models";
import { catalogVideoProvider } from "./catalog";
import { getJson, pollUntil, postJson } from "./live";
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

async function liveClip(req: ClipRequest, model: VideoModel): Promise<ClipResult> {
  const access = process.env.KLING_ACCESS_KEY?.trim() ?? "";
  const secret = process.env.KLING_SECRET_KEY?.trim() ?? "";
  const headers = { authorization: `Bearer ${klingBearerToken(access, secret)}` };
  const created = (await postJson(
    "kling-avatar",
    `${ROOT}/videos/avatar/image2video`,
    buildKlingAvatarRequest(req),
    headers,
  )) as { data?: { task_id?: string } };
  const taskId = created.data?.task_id;
  if (!taskId) throw new ProviderUnavailableError("kling-avatar", "missing task");
  await pollUntil("kling-avatar", async () => {
    const status = (await getJson("kling-avatar", `${ROOT}/videos/avatar/image2video/${taskId}`, headers)) as {
      data?: { task_status?: string };
    };
    const state = status.data?.task_status;
    if (state === "failed") throw new ProviderUnavailableError("kling-avatar", "failed");
    return state === "succeed" ? "done" : "pending";
  });
  return {
    providerId: "kling-avatar",
    durationS: req.durationS,
    frameUrls: [],
    costUsd: model.usdPerSecond * req.durationS,
  };
}

export const klingAvatar = catalogVideoProvider("kling-avatar", {
  envKeys: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
  live: liveClip,
});

export const adapter = defineAdapter({ id: "kling", video: [klingAvatar] });
