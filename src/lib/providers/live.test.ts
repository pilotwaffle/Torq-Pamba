import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaPath } from "@/lib/media/storage";
import { googleOperationResult, liveGoogleClip, liveNanoBanana, nanoBananaInlineImage, buildNanoBananaRequest } from "./google";
import { heygenStatusResult, liveHeygenClip } from "./heygen";
import { klingBearerToken, liveKlingClip } from "./kling";
import { downloadClip, pollTimeoutMs, pollUntil } from "./live";
import { liveRunwayClip, runwayTaskResult } from "./runway";
import { ProviderRefusedError, ProviderUnavailableError } from "./types";
import { liveGrokVideo } from "./xai";

type Route = (url: string, init?: RequestInit) => Response | undefined;
const calls: { url: string; init?: RequestInit }[] = [];
const fastPoll = { intervalMs: 1, maxIntervalMs: 1, timeoutMs: 5_000 };
const VIDEO_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
let mediaRoot = "";
const saved: Record<string, string | undefined> = {};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function video() {
  return new Response(VIDEO_BYTES, { headers: { "content-type": "video/mp4" } });
}

function stubFetch(routes: Route[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      for (const route of routes) {
        const response = route(url, init);
        if (response) return response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

/** Returns each queued response in order for URLs that contain `needle`. */
function sequence(needle: string, responses: (() => Response)[]): Route {
  let index = 0;
  return (url) => {
    if (!url.includes(needle)) return undefined;
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return next?.();
  };
}

async function storedBytes(key: string | undefined) {
  expect(key).toMatch(/^[a-f0-9-]{36}\.mp4$/);
  return new Uint8Array(await readFile(mediaPath(key!)));
}

beforeEach(async () => {
  calls.length = 0;
  mediaRoot = await mkdtemp(path.join(tmpdir(), "torq-media-"));
  for (const name of ["MEDIA_DIR", "GEMINI_API_KEY", "XAI_API_KEY", "RUNWAY_API_KEY", "KLING_ACCESS_KEY", "KLING_SECRET_KEY", "HEYGEN_API_KEY"]) {
    saved[name] = process.env[name];
  }
  process.env.MEDIA_DIR = mediaRoot;
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.XAI_API_KEY = "test-xai";
  process.env.RUNWAY_API_KEY = "test-runway";
  process.env.KLING_ACCESS_KEY = "ak";
  process.env.KLING_SECRET_KEY = "sk";
  process.env.HEYGEN_API_KEY = "test-heygen";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(mediaRoot, { recursive: true, force: true });
});

describe("pollUntil", () => {
  it("backs off between polls and returns the first non-null result", async () => {
    const sleeps: number[] = [];
    let polls = 0;
    const result = await pollUntil(
      "test",
      async () => (++polls >= 4 ? "done-url" : null),
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe("done-url");
    expect(sleeps).toEqual([5000, 7500, 11250]);
  });

  it("gives up with ProviderUnavailableError once the time budget is spent", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const run = pollUntil("slow", async () => null, {
      timeoutMs: 120_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await expect(run).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(run).rejects.toThrow(/timed out/);
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(120_000);
    expect(Math.max(...sleeps)).toBe(20_000);
  });

  it("defaults to a 10 minute budget, overridable by PROVIDER_POLL_TIMEOUT_MS", () => {
    const previous = process.env.PROVIDER_POLL_TIMEOUT_MS;
    try {
      delete process.env.PROVIDER_POLL_TIMEOUT_MS;
      expect(pollTimeoutMs()).toBe(600_000);
      process.env.PROVIDER_POLL_TIMEOUT_MS = "90000";
      expect(pollTimeoutMs()).toBe(90_000);
    } finally {
      if (previous === undefined) delete process.env.PROVIDER_POLL_TIMEOUT_MS;
      else process.env.PROVIDER_POLL_TIMEOUT_MS = previous;
    }
  });
});

describe("live adapters download the finished clip", () => {
  it("Google: submits, polls the operation, and downloads the video with the API key", async () => {
    stubFetch([
      (url, init) => (init?.method === "POST" && url.includes(":predictLongRunning") ? json({ name: "operations/op-1" }) : undefined),
      sequence("/operations/op-1", [
        () => json({ done: false }),
        () => json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files.example/veo.mp4" } }] } } }),
      ]),
      (url) => (url === "https://files.example/veo.mp4" ? video() : undefined),
    ]);
    const result = await liveGoogleClip("veo-3.1-lite", { prompt: "cold brew", durationS: 8 }, fastPoll);
    expect(result.providerId).toBe("veo-3.1-lite");
    expect(result.costUsd).toBeCloseTo(0.4);
    expect(await storedBytes(result.mediaKey)).toEqual(VIDEO_BYTES);
    const download = calls.find((call) => call.url === "https://files.example/veo.mp4");
    expect((download?.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-gemini");
    expect(calls.filter((call) => call.url.includes("/operations/op-1"))).toHaveLength(2);
  });

  it("Google: a safety-filtered operation is a refusal, so the router falls back", () => {
    expect(googleOperationResult("omni-flash", { done: false })).toBeNull();
    expect(() =>
      googleOperationResult("omni-flash", { done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["celebrity"] } } }),
    ).toThrow(ProviderRefusedError);
    expect(() => googleOperationResult("omni-flash", { done: true, error: { message: "blocked by safety policy" } })).toThrow(
      ProviderRefusedError,
    );
    expect(() => googleOperationResult("omni-flash", { done: true, error: { message: "internal" } })).toThrow(
      ProviderUnavailableError,
    );
  });

  it("xAI: polls the Grok Imagine job and downloads video.url", async () => {
    stubFetch([
      (url, init) => (init?.method === "POST" && url.endsWith("/videos/generations") ? json({ request_id: "req-9" }) : undefined),
      sequence("/videos/generations/req-9", [() => json({ status: "pending" }), () => json({ status: "done", video: { url: "https://cdn.x.ai/v.mp4" } })]),
      (url) => (url === "https://cdn.x.ai/v.mp4" ? video() : undefined),
    ]);
    const result = await liveGrokVideo({ prompt: "p", durationS: 10 }, fastPoll);
    expect(await storedBytes(result.mediaKey)).toEqual(VIDEO_BYTES);
    expect(result.costUsd).toBeCloseTo(0.7);
  });

  it("Runway: SUCCEEDED output is downloaded and a SAFETY failure is a refusal", async () => {
    expect(() => runwayTaskResult({ status: "FAILED", failureCode: "SAFETY.INPUT.TEXT", failure: "flagged" })).toThrow(
      ProviderRefusedError,
    );
    expect(runwayTaskResult({ status: "RUNNING" })).toBeNull();
    stubFetch([
      (url, init) => (init?.method === "POST" && url.endsWith("/image_to_video") ? json({ id: "task-1" }) : undefined),
      sequence("/tasks/task-1", [() => json({ status: "RUNNING" }), () => json({ status: "SUCCEEDED", output: ["https://dnznrvs05pmza.cloudfront.net/x.mp4"] })]),
      (url) => (url.endsWith("/x.mp4") ? video() : undefined),
    ]);
    const result = await liveRunwayClip({ prompt: "p", durationS: 5 }, fastPoll);
    expect(await storedBytes(result.mediaKey)).toEqual(VIDEO_BYTES);
  });

  it("Kling: signs every request with a fresh HS256 bearer and downloads task_result.videos[0]", async () => {
    stubFetch([
      (url, init) => (init?.method === "POST" && url.endsWith("/image2video") ? json({ data: { task_id: "k-1" } }) : undefined),
      sequence("/image2video/k-1", [
        () => json({ data: { task_status: "processing" } }),
        () => json({ data: { task_status: "succeed", task_result: { videos: [{ url: "https://cdn.klingai.com/k.mp4" }] } } }),
      ]),
      (url) => (url === "https://cdn.klingai.com/k.mp4" ? video() : undefined),
    ]);
    const result = await liveKlingClip({ prompt: "p", durationS: 5 }, fastPoll);
    expect(await storedBytes(result.mediaKey)).toEqual(VIDEO_BYTES);
    const authed = calls.filter((call) => call.url.includes("klingai.com/v1"));
    expect(authed).toHaveLength(3);
    for (const call of authed) {
      const auth = (call.init?.headers as Record<string, string>).authorization ?? "";
      expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    }
    const token = klingBearerToken("ak", "sk", 1_000);
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, number | string>;
    expect(payload).toEqual({ iss: "ak", exp: 2_800, nbf: 995 });
  });

  it("HeyGen: completed status returns video_url and failed status throws", async () => {
    expect(() => heygenStatusResult({ data: { status: "failed", error: { message: "bad photo" } } })).toThrow(/bad photo/);
    stubFetch([
      (url, init) => (init?.method === "POST" && url.endsWith("/v2/video/generate") ? json({ data: { video_id: "h-1" } }) : undefined),
      sequence("video_status.get", [() => json({ data: { status: "processing" } }), () => json({ data: { status: "completed", video_url: "https://files.heygen.ai/h.mp4" } })]),
      (url) => (url === "https://files.heygen.ai/h.mp4" ? video() : undefined),
    ]);
    const result = await liveHeygenClip({ prompt: "hello", durationS: 30 }, fastPoll);
    expect(await storedBytes(result.mediaKey)).toEqual(VIDEO_BYTES);
  });

  it("downloadClip refuses non-https URLs and non-video bodies", async () => {
    await expect(downloadClip("t", "http://insecure.example/v.mp4")).rejects.toThrow(/https/);
    stubFetch([(url) => (url.includes("page") ? new Response("<html>", { headers: { "content-type": "text/html" } }) : undefined)]);
    await expect(downloadClip("t", "https://cdn.example/page")).rejects.toThrow(/not video/);
  });
});

describe("Nano Banana", () => {
  it("builds a 9:16 image request, decodes inline data, and stores the image", async () => {
    expect(buildNanoBananaRequest("a can").generationConfig).toEqual({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "9:16" },
    });
    expect(nanoBananaInlineImage({ candidates: [{ content: { parts: [{}] } }] })).toBeNull();
    const png = Buffer.from([137, 80, 78, 71]).toString("base64");
    stubFetch([
      (url) =>
        url.includes(":generateContent")
          ? json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: png } }] } }] })
          : undefined,
    ]);
    const result = await liveNanoBanana("nano-banana-2", "a can of cold brew");
    expect(result.costUsd).toBe(0.067);
    expect(result.url).toMatch(/^\/api\/media\/[a-f0-9-]{36}\.png$/);
    expect(calls[0]?.url).toContain("gemini-3.1-flash-image-preview:generateContent");
  });
});
