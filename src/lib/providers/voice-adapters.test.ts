import { describe, expect, it } from "vitest";
import { catalog } from "@/lib/models";
import { synthWav, dataUrl } from "@/lib/voices/wav";
import { buildCloneForm, buildSpeechRequest, ELEVENLABS_MODELS, elevenlabsV3 } from "./elevenlabs";
import { buildHeygenLipsyncBody, heygenImage, heygenLipsync, readHeygenStatus } from "./heygen-lipsync";
import { ProviderUnavailableError } from "./types";

describe("ElevenLabs voice adapter", () => {
  it("builds the text-to-speech request from the current API shape", () => {
    const { url, body } = buildSpeechRequest("eleven_v3", { providerVoiceId: "JBFqnCBsd6RMkjVDRZzb", text: "Hello" });
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128");
    expect(body).toEqual({ text: "Hello", model_id: "eleven_v3" });
    expect(ELEVENLABS_MODELS["elevenlabs-flash"]?.modelId).toBe("eleven_flash_v2_5");
  });

  it("sends clone samples as multipart files", () => {
    const wav = synthWav("sample");
    const form = buildCloneForm({ name: "Dana", description: "Clone of Dana", samples: [{ bytes: wav.bytes, mimeType: "audio/wav", filename: "a.wav" }] });
    expect(form.get("name")).toBe("Dana");
    expect(form.get("description")).toBe("Clone of Dana");
    const file = form.getAll("files")[0] as File;
    expect(file.name).toBe("a.wav");
    expect(file.size).toBe(wav.bytes.length);
  });

  it("is priced from the catalog and mocks with no key", async () => {
    expect(elevenlabsV3.usdPer1KChars).toBe(catalog.voice("elevenlabs-v3").usdPer1KChars);
    expect(elevenlabsV3.isLive()).toBe(false);
    const speech = await elevenlabsV3.synthesize({ providerVoiceId: "x", text: "a".repeat(1000) });
    expect(speech.audio.mimeType).toBe("audio/wav");
    expect(speech.costUsd).toBeCloseTo(0.1, 10);
    expect(await elevenlabsV3.previewUrl("x")).toBeNull();
    expect((await elevenlabsV3.cloneVoice({ name: "n", samples: [] })).provider).toBe("mock");
  });
});

describe("HeyGen lip-sync adapter", () => {
  it("builds a v3 image-plus-audio video request", () => {
    const body = buildHeygenLipsyncBody(
      { imageUrl: "https://cdn.example.com/p.png", audio: { url: "https://cdn.example.com/a.mp3", mimeType: "audio/mpeg", durationMs: 1000 }, title: "Mina: hi" },
      { audio_url: "https://cdn.example.com/a.mp3" },
    );
    expect(body).toEqual({
      type: "image",
      image: { type: "url", url: "https://cdn.example.com/p.png" },
      audio_url: "https://cdn.example.com/a.mp3",
      title: "Mina: hi",
      aspect_ratio: "9:16",
      resolution: "720p",
    });
  });

  it("inlines raster portraits as base64 and refuses SVG", () => {
    const png = dataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");
    expect(heygenImage(png)).toEqual({ type: "base64", media_type: "image/png", data: "iVBORw==" });
    expect(() => heygenImage("data:image/svg+xml;base64,PHN2Zy8+")).toThrow(ProviderUnavailableError);
  });

  it("reads job status from GET /v3/videos/{id}", () => {
    expect(readHeygenStatus({ data: { status: "processing" } })).toEqual({ status: "running" });
    expect(readHeygenStatus({ data: { status: "pending" } })).toEqual({ status: "running" });
    expect(readHeygenStatus({ data: { status: "failed", failure_message: "bad photo" } })).toEqual({
      status: "failed",
      error: "bad photo",
    });
    expect(
      readHeygenStatus({ data: { status: "completed", video_url: "https://x/v.mp4", thumbnail_url: "https://x/t.jpg", duration: 2.5 } }),
    ).toEqual({
      status: "succeeded",
      output: { url: "https://x/v.mp4", mimeType: "video/mp4", durationMs: 2500, posterUrl: "https://x/t.jpg" },
    });
  });

  it("uses the HeyGen Avatar IV catalog price and mocks with no key", async () => {
    expect(heygenLipsync.usdPerSecond).toBe(catalog.video("heygen-avatar-iv").usdPerSecond);
    const started = await heygenLipsync.submit({
      imageUrl: "<svg></svg>",
      audio: { url: "data:audio/wav;base64,AA==", mimeType: "audio/wav", durationMs: 1200 },
      title: "t",
      script: "Hello there",
    });
    expect(started.status).toBe("succeeded");
    expect(started.providerJobId).toMatch(/^mock_/);
  });
});
