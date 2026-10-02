import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mockFrameSvg } from "@/lib/providers/mock";
import { withTempDir } from "./assets";
import { probe } from "./ffmpeg";
import { mockClipMp4 } from "./mock-clip";
import { buildStitchArgs, captionsVtt, outputSize, stitchClips, wrapText } from "./stitch";

describe("stitch command", () => {
  it("normalises each clip, pads silent ones, concatenates, and burns in text from files", () => {
    const { args, textFiles } = buildStitchArgs({
      clips: [
        { file: "/t/a.mp4", durationS: 10, hasAudio: true },
        { file: "/t/b.mp4", durationS: 8, hasAudio: false, voiceFile: "/t/voice.mp3" },
      ],
      captions: [
        { text: "First line", startS: 0, endS: 10 },
        { text: "Second line", startS: 10, endS: 18 },
      ],
      hook: "Made for commuters",
      width: 720,
      height: 1280,
      fps: 30,
      burnCaptions: true,
      fontFile: "/fonts/a.ttf",
      workDir: "/t",
      output: "/t/out.mp4",
    });
    expect(args.filter((arg) => arg === "-i")).toHaveLength(3);
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("[0:v]scale=720:1280:force_original_aspect_ratio=decrease");
    expect(graph).toContain("tpad=stop_mode=clone:stop_duration=10,trim=duration=10");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=8");
    expect(graph).toContain("[2:a]aresample=48000");
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("concat=n=2:v=1:a=1[vcat][aout]");
    expect(graph).toContain("enable='between(t,10,17.999)'");
    expect(graph).toContain("fontfile='/fonts/a.ttf'");
    expect(textFiles.map((file) => file.text)).toEqual(["Made for commuters", "First line", "Second line"]);
    expect(args).toContain("+faststart");
    expect(args.at(-1)).toBe("/t/out.mp4");

    const plain = buildStitchArgs({
      clips: [{ file: "/t/a.mp4", durationS: 4, hasAudio: true }],
      captions: [{ text: "x", startS: 0, endS: 4 }],
      width: 360,
      height: 640,
      fps: 12,
      burnCaptions: false,
      workDir: "/t",
      output: "/t/out.mp4",
    });
    expect(plain.textFiles).toEqual([]);
    expect(plain.args).toContain("[vcat]");
  });

  it("wraps text, writes WebVTT and picks a 9:16 output size", () => {
    expect(wrapText("one two three four five six", 9)).toBe("one two\nthree\nfour five\nsix");
    expect(captionsVtt([{ text: "Hi", startS: 0, endS: 1.5 }, { text: " ", startS: 2, endS: 3 }])).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHi\n",
    );
    expect(outputSize([{ width: 360, height: 640 }])).toEqual({ width: 360, height: 640 });
    expect(outputSize([{ width: 1280, height: 720 }])).toEqual({ width: 1080, height: 1920 });
    expect(outputSize([{ width: 720, height: 1280 }, { width: 360, height: 640 }])).toEqual({ width: 720, height: 1280 });
  });
});

describe("stitchClips with ffmpeg", () => {
  it("joins mock clips of different lengths into one playable H.264/AAC mp4", async () => {
    const clips = await Promise.all(
      [0, 1].map(async (index) => ({
        bytes: await mockClipMp4({ frameSvg: mockFrameSvg("omni-flash", "x", { sceneIndex: index }), durationS: 1.5, sceneIndex: index }),
        durationS: index === 0 ? 1 : 2,
      })),
    );
    const result = await stitchClips({
      clips,
      captions: [
        { text: "Hello there", startS: 0, endS: 1 },
        { text: "Second scene", startS: 1, endS: 3 },
      ],
      hook: "A hook",
      fps: 12,
      preset: "ultrafast",
    });
    expect(result.mp4.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(result.durationS).toBeGreaterThan(2.8);
    expect(result.durationS).toBeLessThan(3.3);
    expect(result.width).toBe(360);
    expect(result.height).toBe(640);
    expect(result.poster?.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(result.vtt).toContain("Second scene");
    await withTempDir(async (dir) => {
      const file = path.join(dir, "out.mp4");
      await writeFile(file, result.mp4);
      const meta = await probe(file);
      expect(meta.hasVideo).toBe(true);
      expect(meta.hasAudio).toBe(true);
    });
  });
});
