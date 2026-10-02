import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpegCapabilities, runFfmpeg } from "./ffmpeg";

/** A committed 2 s, 360×640 H.264 + AAC clip used when ffmpeg is not installed. */
export const MOCK_CLIP_FIXTURE = path.join(process.cwd(), "src/lib/media/fixtures/mock-clip.mp4");

const WIDTH = 360;
const HEIGHT = 640;
const FPS = 12;
const BACKGROUNDS = ["0xE7B98A", "0x9BB6CC", "0xC5D0DA"];
const TONES = [392, 440, 523.25];

function cacheDir(): string {
  return path.join(os.tmpdir(), "torq-mock-clips");
}

/**
 * A real, tiny H.264/AAC mp4 for a mock scene: the scene's placeholder SVG
 * frame (when ffmpeg has librsvg; otherwise a flat colour) with a quiet tone,
 * `durationS` long. Clips are cached in the OS temp dir by content hash.
 */
export async function mockClipMp4(input: { frameSvg: string; durationS: number; sceneIndex: number }): Promise<Buffer> {
  const caps = await ffmpegCapabilities();
  if (!caps.ok) return readFile(MOCK_CLIP_FIXTURE);

  const durationS = Math.max(0.5, Math.min(60, input.durationS));
  const useSvg = caps.decoders.has("librsvg");
  const index = ((input.sceneIndex % 3) + 3) % 3;
  const key = createHash("sha256")
    .update(JSON.stringify({ v: 1, svg: useSvg ? input.frameSvg : "", durationS, index }))
    .digest("hex")
    .slice(0, 32);
  const dir = cacheDir();
  const file = path.join(dir, `${key}.mp4`);
  try {
    return await readFile(file);
  } catch {
    // Not cached yet.
  }

  await mkdir(dir, { recursive: true });
  const unique = `${key}.${process.pid}.${Math.random().toString(16).slice(2)}`;
  const partial = path.join(dir, `${unique}.part.mp4`);
  const visual: string[] = [];
  if (useSvg) {
    const svgFile = path.join(dir, `${unique}.svg`);
    const sized = input.frameSvg.replace("<svg ", `<svg width="${WIDTH}" height="${HEIGHT}" `);
    await writeFile(svgFile, sized);
    visual.push("-loop", "1", "-framerate", String(FPS), "-i", svgFile);
  } else {
    visual.push("-f", "lavfi", "-i", `color=c=${BACKGROUNDS[index]}:s=${WIDTH}x${HEIGHT}:r=${FPS}`);
  }
  await runFfmpeg([
    ...visual,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${TONES[index]}:sample_rate=48000`,
    "-t",
    durationS.toFixed(3),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-vf",
    `scale=${WIDTH}:${HEIGHT},format=yuv420p`,
    "-af",
    "volume=0.08",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "32",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    partial,
  ]);
  await rename(partial, file);
  return readFile(file);
}
