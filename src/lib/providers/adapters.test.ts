import { describe, expect, it } from "vitest";
import { buildOmniRequest, buildVeoRequest, readOmniInteraction, readVeoOperation, VEO_API_MODEL } from "./google";
import { buildHeygenRequest, readHeygenVideo } from "./heygen";
import { buildKlingAvatarRequest, klingBearerToken, readKlingTask } from "./kling";
import { clampDuration, nearestDuration } from "./live";
import { buildRunwayRequest, readRunwayTask } from "./runway";
import { ProviderUnavailableError } from "./types";
import { buildGrokVideoRequest, readGrokVideoStatus } from "./xai";

const req = { prompt: "oat milk cold brew on a commuter train", durationS: 10 };

describe("duration helpers", () => {
  it("snaps to the nearest allowed length, preferring the longer one", () => {
    expect(nearestDuration(10, [4, 6, 8])).toBe(8);
    expect(nearestDuration(5, [4, 6, 8])).toBe(6);
    expect(nearestDuration(3, [4, 6, 8])).toBe(4);
    expect(clampDuration(30, 4, 15)).toBe(15);
    expect(clampDuration(2.4, 4, 15)).toBe(4);
  });
});

describe("xAI Grok Imagine video", () => {
  it("builds a 9:16 request within 1–15 s", () => {
    expect(buildGrokVideoRequest({ ...req, durationS: 20 })).toEqual({
      model: "grok-imagine-video",
      prompt: req.prompt,
      duration: 15,
      resolution: "720p",
      aspect_ratio: "9:16",
    });
    expect(buildGrokVideoRequest({ ...req, imageUrl: "https://example.com/a.png" }).image).toEqual({
      url: "https://example.com/a.png",
    });
  });

  it("reads done, moderation, failed and expired", () => {
    expect(readGrokVideoStatus({ status: "pending" })).toEqual({ state: "pending" });
    expect(readGrokVideoStatus({ status: "done", video: { url: "https://vidgen.x.ai/a.mp4", duration: 8, respect_moderation: true } })).toEqual({
      state: "succeeded",
      output: { kind: "url", url: "https://vidgen.x.ai/a.mp4", mimeType: "video/mp4" },
      durationS: 8,
    });
    expect(readGrokVideoStatus({ status: "done", video: { url: "", respect_moderation: false } })).toMatchObject({
      state: "failed",
      refused: true,
    });
    expect(readGrokVideoStatus({ status: "failed", error: { code: "invalid_argument", message: "blocked" } })).toMatchObject({
      state: "failed",
      refused: true,
    });
    expect(readGrokVideoStatus({ status: "failed", error: { code: "service_unavailable", message: "busy" } })).toMatchObject({
      state: "failed",
      refused: false,
    });
    expect(readGrokVideoStatus({ status: "expired" })).toMatchObject({ state: "failed", refused: false });
  });
});

describe("Google Veo 3.1", () => {
  it("uses the documented model codes and parameters", () => {
    expect(VEO_API_MODEL).toEqual({
      "veo-3.1-lite": "veo-3.1-lite-generate-preview",
      "veo-3.1-standard": "veo-3.1-generate-preview",
    });
    expect(buildVeoRequest("veo-3.1-lite", req)).toEqual({
      instances: [{ prompt: req.prompt }],
      parameters: { aspectRatio: "9:16", durationSeconds: 8, resolution: "720p", personGeneration: "allow_all" },
    });
    const hd = buildVeoRequest("veo-3.1-standard", { ...req, durationS: 4, imageUrl: "data:image/png;base64,AAAA" });
    expect(hd.parameters).toMatchObject({ durationSeconds: 8, resolution: "1080p", personGeneration: "allow_adult" });
    expect(hd.instances[0]?.image).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
    expect(buildVeoRequest("veo-3.1-lite", { ...req, imageUrl: "data:image/svg+xml,<svg/>" }).instances[0]).not.toHaveProperty("image");
  });

  it("downloads the sample uri with the key header, and treats RAI filtering as a refusal", () => {
    expect(readVeoOperation({ done: false })).toEqual({ state: "pending" });
    const done = readVeoOperation({
      done: true,
      response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/x:download?alt=media" } }] } },
    });
    expect(done).toMatchObject({ state: "succeeded", output: { kind: "url", headers: { "x-goog-api-key": expect.any(String) } } });
    expect(
      readVeoOperation({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["blocked"] } } }),
    ).toMatchObject({ state: "failed", refused: true });
    expect(readVeoOperation({ done: true, error: { code: 13, message: "internal" } })).toMatchObject({ state: "failed", refused: false });
  });
});

describe("Gemini Omni Flash", () => {
  it("creates a background interaction for a 9:16 video", () => {
    expect(buildOmniRequest(req)).toEqual({
      model: "gemini-omni-1.1-flash",
      input: req.prompt,
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" },
      background: true,
    });
  });

  it("reads the base64 video from the model_output step", () => {
    expect(readOmniInteraction({ status: "in_progress" })).toEqual({ state: "pending" });
    const done = readOmniInteraction({
      status: "completed",
      steps: [
        { type: "user_input", content: [{ type: "text" }] },
        { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from("mp4!").toString("base64") }] },
      ],
    });
    if (done.state !== "succeeded" || done.output.kind !== "bytes") throw new Error("expected bytes");
    expect(Buffer.from(done.output.bytes).toString()).toBe("mp4!");
    expect(readOmniInteraction({ status: "failed", error: { message: "Blocked by safety policy" } })).toMatchObject({
      state: "failed",
      refused: true,
    });
  });
});

describe("Runway Seedance 2.0", () => {
  it("uses text_to_video without an image and image_to_video with one", () => {
    expect(buildRunwayRequest(req)).toEqual({
      endpoint: "text_to_video",
      body: { model: "seedance2", promptText: req.prompt, duration: 10, ratio: "1080:1920" },
    });
    const withImage = buildRunwayRequest({ ...req, durationS: 2, imageUrl: "https://example.com/a.png" });
    expect(withImage.endpoint).toBe("image_to_video");
    expect(withImage.body).toMatchObject({ duration: 4, promptImage: [{ uri: "https://example.com/a.png", position: "first" }] });
    expect(withImage.body).not.toHaveProperty("resolution");
  });

  it("reads task states, both spellings of canceled, and SAFETY failures", () => {
    expect(readRunwayTask({ status: "THROTTLED" })).toEqual({ state: "pending" });
    expect(readRunwayTask({ status: "SUCCEEDED", output: ["https://dnznrvs05pmza.cloudfront.net/a.mp4"] })).toMatchObject({
      state: "succeeded",
      output: { kind: "url", url: "https://dnznrvs05pmza.cloudfront.net/a.mp4" },
    });
    expect(readRunwayTask({ status: "FAILED", failureCode: "SAFETY.INPUT.TEXT", failure: "nope" })).toMatchObject({
      state: "failed",
      refused: true,
    });
    expect(readRunwayTask({ status: "FAILED", failureCode: "INPUT_PREPROCESSING.SAFETY.TEXT" })).toMatchObject({ refused: true });
    expect(readRunwayTask({ status: "FAILED", failureCode: "INTERNAL.BAD_OUTPUT.01" })).toMatchObject({ refused: false });
    expect(readRunwayTask({ status: "CANCELED" })).toMatchObject({ state: "failed" });
    expect(readRunwayTask({ status: "CANCELLED" })).toMatchObject({ state: "failed" });
  });
});

describe("Kling avatar", () => {
  it("needs a png/jpg portrait and a voice track, and strips the data: prefix", () => {
    expect(() => buildKlingAvatarRequest(req)).toThrow(ProviderUnavailableError);
    expect(() => buildKlingAvatarRequest({ ...req, imageUrl: "https://example.com/a.png" })).toThrow(/voice track/);
    expect(
      buildKlingAvatarRequest({ ...req, imageUrl: "data:image/png;base64,QUJD", audioUrl: "https://example.com/a.mp3" }),
    ).toEqual({ image: "QUJD", sound_file: "https://example.com/a.mp3", prompt: req.prompt, mode: "std" });
  });

  it("signs the legacy AK/SK JWT and reads task states", () => {
    const token = klingBearerToken("ak", "sk", 1_700_000_000);
    const [, payload] = token.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({ iss: "ak", exp: 1_700_001_800, nbf: 1_699_999_995 });
    expect(readKlingTask({ code: 0, data: { task_status: "processing" } })).toEqual({ state: "pending" });
    expect(
      readKlingTask({ code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: "https://cdn.klingai.com/a.mp4", duration: "5.1" }] } } }),
    ).toMatchObject({ state: "succeeded", durationS: 5.1 });
    expect(readKlingTask({ code: 0, data: { task_status: "failed", task_status_msg: "content risk control" } })).toMatchObject({
      refused: true,
    });
  });
});

describe("HeyGen Avatar IV", () => {
  it("uses v3 image videos with exactly one speech source", () => {
    expect(() => buildHeygenRequest(req, "")).toThrow(ProviderUnavailableError);
    expect(buildHeygenRequest({ ...req, imageUrl: "https://example.com/a.jpg" }, "voice_1")).toMatchObject({
      type: "image",
      image: { type: "url", url: "https://example.com/a.jpg" },
      script: req.prompt,
      voice_id: "voice_1",
      aspect_ratio: "9:16",
    });
    const audio = buildHeygenRequest({ ...req, imageUrl: "https://example.com/a.jpg", audioUrl: "https://example.com/a.mp3" }, "voice_1");
    expect(audio).toMatchObject({ audio_url: "https://example.com/a.mp3" });
    expect(audio).not.toHaveProperty("script");
  });

  it("reads completed and failed videos with or without the data envelope", () => {
    expect(readHeygenVideo({ data: { status: "processing" } })).toEqual({ state: "pending" });
    expect(readHeygenVideo({ status: "completed", video_url: "https://files.heygen.ai/a.mp4" })).toMatchObject({ state: "succeeded" });
    expect(readHeygenVideo({ data: { status: "failed", failure_code: "MODERATION", failure_message: "x" } })).toMatchObject({
      refused: true,
    });
  });
});
