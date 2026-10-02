import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFfmpegArgs, buildSrt, probeDurationS, stitchClips } from "./stitch";
import { isMediaKey, mediaPath, publicMediaUrl, readMedia, saveMedia } from "./storage";

let root = "";
let previous: string | undefined;

beforeEach(async () => {
  previous = process.env.MEDIA_DIR;
  root = await mkdtemp(path.join(tmpdir(), "torq-media-test-"));
  process.env.MEDIA_DIR = root;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.MEDIA_DIR;
  else process.env.MEDIA_DIR = previous;
  await rm(root, { recursive: true, force: true });
});

describe("media storage", () => {
  it("stores under an unguessable key and refuses path traversal", async () => {
    const key = await saveMedia(new Uint8Array([1, 2, 3]), "mp4");
    expect(isMediaKey(key)).toBe(true);
    expect([...(await readMedia(key))]).toEqual([1, 2, 3]);
    for (const bad of ["../etc/passwd", "x.mp4", "..%2f.mp4", `${key}/../../a`]) {
      expect(isMediaKey(bad)).toBe(false);
      expect(() => mediaPath(bad)).toThrow(/Invalid media key/);
    }
  });

  it("builds a public pull URL only for an https PUBLIC_BASE_URL", () => {
    const key = "0b5f1e7c-3f7e-4f6e-9a49-2b0f6a6c1f10.mp4";
    expect(publicMediaUrl(key, "https://studio.example.com/")).toBe(`https://studio.example.com/api/media/${key}`);
    expect(publicMediaUrl(key, "http://localhost:3000")).toBeNull();
    expect(publicMediaUrl(key, "")).toBeNull();
  });
});

describe("stitching", () => {
  it("writes an SRT caption track with millisecond timestamps", () => {
    expect(
      buildSrt([
        { text: "Cold brew, zero wait.", startS: 0, endS: 10 },
        { text: "  ", startS: 10, endS: 12 },
        { text: "Grab one on the way.", startS: 12, endS: 21.5 },
      ]),
    ).toBe("1\n00:00:00,000 --> 00:00:10,000\nCold brew, zero wait.\n\n2\n00:00:12,000 --> 00:00:21,500\nGrab one on the way.\n");
  });

  it("builds a 720x1280 concat with burned captions and no watermark", () => {
    const args = buildFfmpegArgs({ inputs: ["a.mp4", "b.mp4"], output: "out.mp4", withAudio: true, srtPath: "/tmp/c.srt" });
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[vc][a]");
    expect(graph).toContain("scale=720:1280");
    expect(graph).toContain("subtitles='/tmp/c.srt'");
    expect(graph).not.toMatch(/drawtext|overlay|watermark|logo/i);
    expect(args.at(-1)).toBe("out.mp4");
    const silent = buildFfmpegArgs({ inputs: ["a.mp4"], output: "o.mp4", withAudio: false });
    expect(silent).not.toContain("[a]");
    expect(silent.join(" ")).toContain("concat=n=1:v=1:a=0");
  });

  it("stitches real clips with ffmpeg into one MP4 whose length is the sum of the scenes", async () => {
    const keys: string[] = [];
    for (const [color, seconds] of [["red", 1], ["blue", 2]] as const) {
      const file = path.join(root, `${color}.mp4`);
      execFileSync("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=${color}:s=360x640:d=${seconds}:r=30`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file,
      ]);
      const { readFile } = await import("node:fs/promises");
      keys.push(await saveMedia(await readFile(file), "mp4"));
    }
    const key = await stitchClips({
      sceneKeys: keys,
      captions: [
        { text: "Scene one", startS: 0, endS: 1 },
        { text: "Scene two", startS: 1, endS: 3 },
      ],
    });
    const duration = await probeDurationS(mediaPath(key));
    expect(duration).toBeGreaterThan(2.8);
    expect(duration).toBeLessThan(3.3);
    const dims = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", mediaPath(key),
    ]).toString().trim();
    expect(dims).toBe("720,1280");
  });
});
