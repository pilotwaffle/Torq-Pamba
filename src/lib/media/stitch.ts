import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaError, mediaPath, saveMedia } from "./storage";

/**
 * Real stitching for live clips: concatenate scene MP4s into one 720x1280
 * 30 fps H.264 file and burn the caption track in. No logo or watermark is
 * added (TikTok content-sharing guidelines). The AI label is metadata on the
 * post, never stripped.
 */

export type Caption = { text: string; startS: number; endS: number };

function srtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildSrt(captions: Caption[]): string {
  return captions
    .filter((caption) => caption.text.trim() && caption.endS > caption.startS)
    .map((caption, index) => `${index + 1}\n${srtTime(caption.startS)} --> ${srtTime(caption.endS)}\n${caption.text.trim()}\n`)
    .join("\n");
}

export function buildFfmpegArgs(input: {
  inputs: string[];
  output: string;
  withAudio: boolean;
  srtPath?: string;
}): string[] {
  if (input.inputs.length === 0) throw new MediaError("Nothing to stitch");
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const file of input.inputs) args.push("-i", file);
  const parts: string[] = [];
  input.inputs.forEach((_, index) => {
    parts.push(
      `[${index}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${index}]`,
    );
  });
  const streams = input.inputs
    .map((_, index) => (input.withAudio ? `[v${index}][${index}:a]` : `[v${index}]`))
    .join("");
  const audioOut = input.withAudio ? "[a]" : "";
  parts.push(`${streams}concat=n=${input.inputs.length}:v=1:a=${input.withAudio ? 1 : 0}[vc]${audioOut}`);
  if (input.srtPath) {
    const escaped = input.srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    parts.push(`[vc]subtitles='${escaped}':force_style='Alignment=2,MarginV=180,FontSize=14'[vout]`);
  } else {
    parts.push("[vc]null[vout]");
  }
  args.push("-filter_complex", parts.join(";"), "-map", "[vout]");
  if (input.withAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "128k");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.output);
  return args;
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

export async function hasAudioStream(file: string): Promise<boolean> {
  const result = await run(ffprobePath(), [
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    file,
  ]);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export async function probeDurationS(file: string): Promise<number> {
  const result = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(result.stdout.trim()) || 0;
}

/** Stitch stored scene clips (storage keys, in order) into one MP4. Returns the new storage key. */
export async function stitchClips(input: { sceneKeys: string[]; captions: Caption[] }): Promise<string> {
  const files = input.sceneKeys.map((key) => mediaPath(key));
  const work = await mkdtemp(path.join(tmpdir(), "torq-stitch-"));
  try {
    const audioFlags = await Promise.all(files.map((file) => hasAudioStream(file)));
    const withAudio = audioFlags.every(Boolean);
    const srt = buildSrt(input.captions);
    const srtPath = srt ? path.join(work, "captions.srt") : undefined;
    if (srtPath) await writeFile(srtPath, srt, "utf8");
    const output = path.join(work, "stitched.mp4");
    const result = await run(ffmpegPath(), buildFfmpegArgs({ inputs: files, output, withAudio, srtPath }));
    if (result.code !== 0) throw new MediaError(`ffmpeg failed: ${result.stderr.slice(0, 300)}`);
    return await saveMedia(await readFile(output), "mp4");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
