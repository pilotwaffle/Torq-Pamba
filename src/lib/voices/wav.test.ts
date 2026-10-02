import { describe, expect, it } from "vitest";
import { consentStatement, sniffAudio } from "./consent";
import { mockTalkingSvg, MOCK_MAX_AUDIO_MS } from "./mock";
import { dataUrl, decodeDataUrl, MOCK_SAMPLE_RATE, speechPlan, synthWav, wavDurationMs } from "./wav";

describe("mock speech audio", () => {
  it("writes a real PCM WAV whose header matches its length", () => {
    const wav = synthWav("Hi, I'm Mina. This is how I sound in your videos.", { pitchHz: 196 });
    const ascii = (start: number) => String.fromCharCode(...wav.bytes.subarray(start, start + 4));
    expect(ascii(0)).toBe("RIFF");
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(36)).toBe("data");
    const view = new DataView(wav.bytes.buffer);
    expect(view.getUint32(24, true)).toBe(MOCK_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(8);
    expect(wav.durationMs).toBeGreaterThan(1500);
    expect(wavDurationMs(wav.bytes)).toBeCloseTo(wav.durationMs, -1);
    expect(wav.plan.syllables.length).toBeGreaterThan(8);
    // Not silence: samples move away from the 8-bit midpoint.
    expect(wav.bytes.subarray(44).some((sample) => Math.abs(sample - 128) > 40)).toBe(true);
  });

  it("is deterministic, follows the words, and differs by pitch", () => {
    const a = synthWav("Cold brew for busy commuters", { pitchHz: 110 });
    const b = synthWav("Cold brew for busy commuters", { pitchHz: 110 });
    const c = synthWav("Cold brew for busy commuters", { pitchHz: 220 });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(Buffer.from(a.bytes).equals(Buffer.from(c.bytes))).toBe(false);
    expect(speechPlan("One. Two three four five six seven.").durationMs).toBeGreaterThan(speechPlan("One.").durationMs);
  });

  it("caps long text so inline audio stays small", () => {
    const wav = synthWav("word ".repeat(500), { maxMs: MOCK_MAX_AUDIO_MS });
    expect(wav.durationMs).toBeLessThanOrEqual(MOCK_MAX_AUDIO_MS);
    expect(wav.bytes.length).toBeLessThan(44 + (MOCK_SAMPLE_RATE * MOCK_MAX_AUDIO_MS) / 1000 + 1);
  });

  it("round-trips data URLs and rejects other input", () => {
    const wav = synthWav("hello");
    const url = dataUrl(wav.bytes, "audio/wav");
    expect(url.startsWith("data:audio/wav;base64,")).toBe(true);
    const decoded = decodeDataUrl(url);
    expect(decoded?.mimeType).toBe("audio/wav");
    expect(Buffer.from(decoded!.bytes).equals(Buffer.from(wav.bytes))).toBe(true);
    expect(decodeDataUrl("https://example.com/a.mp3")).toBeNull();
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
  });
});

describe("clone sample checks", () => {
  it("sniffs audio formats from their bytes, not the file name", () => {
    expect(sniffAudio(synthWav("hi").bytes)).toBe("audio/wav");
    expect(sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("audio/mpeg");
    expect(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("audio/webm");
    expect(sniffAudio(new TextEncoder().encode("OggS-----------"))).toBe("audio/ogg");
    expect(sniffAudio(new TextEncoder().encode("<svg>not audio</svg>"))).toBeNull();
  });

  it("states consent for your own voice or with the speaker's permission", () => {
    expect(consentStatement("self", "Dana")).toMatch(/voice in these samples is my own \(Dana\)/);
    expect(consentStatement("permission", "Sam")).toMatch(/Sam’s explicit permission and the rights/);
  });
});

describe("mock lip-sync", () => {
  it("animates the portrait's mouth in time with the line and labels itself as a mock", () => {
    const portrait = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#eee"/><path d="M70 106q10 9 22 0" stroke="#7A4038" fill="none"/></svg>`;
    const svg = mockTalkingSvg(portrait, "Hello there, commuters.", 2000, "heygen-avatar-iv");
    expect(svg).toContain('data-mock-lipsync="true"');
    expect(svg).toContain('attributeName="ry"');
    expect(svg).toContain("Mock lip-sync · heygen-avatar-iv");
    expect(svg).not.toContain('d="M70 106q10 9 22 0"');
    expect(mockTalkingSvg(`<svg><script>alert(1)</script></svg>`, "hi", 800, "x")).not.toContain("<script");
  });
});
