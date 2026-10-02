import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withTempDir } from "./assets";
import { ffmpegCapabilities, FfmpegError, probe, runFfmpeg } from "./ffmpeg";

export type Caption = { text: string; startS: number; endS: number };

export type StitchClip = {
  file: string;
  /** Scene length in the final cut. Longer clips are trimmed; shorter ones hold their last frame. */
  durationS: number;
  hasAudio: boolean;
  /** Optional voice-over mixed over the clip's own audio. */
  voiceFile?: string;
};

export type StitchPlan = {
  clips: StitchClip[];
  captions: Caption[];
  hook?: string;
  width: number;
  height: number;
  fps: number;
  burnCaptions: boolean;
  fontFile?: string;
  /** Directory for caption text files (drawtext reads them, so no escaping of user text is needed). */
  workDir: string;
  output: string;
  preset?: string;
};

export type TextFile = { file: string; text: string };

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial.ttf",
];

/** `FFMPEG_FONT_FILE`, else a common system font, else fontconfig's default. */
export function captionFont(): string | undefined {
  const configured = process.env.FFMPEG_FONT_FILE?.trim();
  if (configured) return configured;
  return FONT_CANDIDATES.find((file) => existsSync(file));
}

/** Greedy word wrap for burned-in text; drawtext does not wrap on its own. */
export function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function seconds(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** Even dimensions, 9:16, no larger than 1080×1920 and no smaller than the largest input. */
export function outputSize(inputs: { width: number; height: number }[]): { width: number; height: number } {
  const tallest = Math.max(0, ...inputs.map((input) => Math.max(input.height, Math.round((input.width * 16) / 9))));
  const height = Math.min(1920, Math.max(640, tallest));
  const even = (value: number) => Math.round(value / 2) * 2;
  return { width: even((height * 9) / 16), height: even(height) };
}

/**
 * The ffmpeg command that normalises every clip to the same size, frame rate
 * and 48 kHz stereo audio, fits each to its scene length, concatenates them,
 * and burns in the hook and captions.
 */
export function buildStitchArgs(plan: StitchPlan): { args: string[]; textFiles: TextFile[] } {
  const { width: W, height: H, fps } = plan;
  const inputs: string[] = [];
  const filters: string[] = [];
  const textFiles: TextFile[] = [];
  let next = 0;

  plan.clips.forEach((clip, index) => {
    const d = seconds(clip.durationS);
    const videoIn = next;
    inputs.push("-i", clip.file);
    next += 1;
    filters.push(
      `[${videoIn}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d},setpts=PTS-STARTPTS[v${index}]`,
    );
    const clipAudio = clip.hasAudio
      ? `[${videoIn}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${d},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS`;
    if (clip.voiceFile) {
      const voiceIn = next;
      inputs.push("-i", clip.voiceFile);
      next += 1;
      filters.push(`${clipAudio}[c${index}]`);
      filters.push(
        `[${voiceIn}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[o${index}]`,
      );
      filters.push(`[c${index}][o${index}]amix=inputs=2:duration=first:dropout_transition=0:weights='0.35 1':normalize=0[a${index}]`);
    } else {
      filters.push(`${clipAudio}[a${index}]`);
    }
  });

  const pairs = plan.clips.map((_, index) => `[v${index}][a${index}]`).join("");
  filters.push(`${pairs}concat=n=${plan.clips.length}:v=1:a=1[vcat][aout]`);

  let video = "[vcat]";
  if (plan.burnCaptions) {
    const font = plan.fontFile ? `fontfile='${plan.fontFile}':` : "";
    const size = Math.round(H * 0.034);
    const box = `fontcolor=white:fontsize=${size}:line_spacing=${Math.round(size * 0.25)}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.45)}`;
    const draws: string[] = [];
    const hook = plan.hook?.trim();
    if (hook) {
      const file = path.join(plan.workDir, "hook.txt");
      textFiles.push({ file, text: wrapText(hook, 24) });
      const until = Math.min(3, plan.clips[0]?.durationS ?? 3);
      draws.push(`drawtext=${font}textfile='${file}':${box}:x=(w-text_w)/2:y=h*0.08:enable='between(t,0,${seconds(until)})'`);
    }
    plan.captions.forEach((caption, index) => {
      if (!caption.text.trim()) return;
      const file = path.join(plan.workDir, `caption-${index}.txt`);
      textFiles.push({ file, text: wrapText(caption.text, 28) });
      draws.push(
        `drawtext=${font}textfile='${file}':${box}:x=(w-text_w)/2:y=h-text_h-h*0.12:` +
          `enable='between(t,${seconds(caption.startS)},${seconds(Math.max(caption.startS, caption.endS - 0.001))})'`,
      );
    });
    if (draws.length > 0) {
      filters.push(`[vcat]${draws.join(",")}[vout]`);
      video = "[vout]";
    }
  }

  const args = [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    video,
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    plan.preset ?? "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    plan.output,
  ];
  return { args, textFiles };
}

function vttTime(value: number): string {
  const ms = Math.round(value * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

export function captionsVtt(captions: Caption[]): string {
  const cues = captions
    .filter((caption) => caption.text.trim())
    .map((caption, index) => `${index + 1}\n${vttTime(caption.startS)} --> ${vttTime(caption.endS)}\n${caption.text.trim()}`);
  return ["WEBVTT", ...cues].join("\n\n") + "\n";
}

export type StitchSource = { bytes: Uint8Array; durationS: number; voice?: Uint8Array };

export type StitchResult = {
  mp4: Buffer;
  poster: Buffer | null;
  vtt: string;
  durationS: number;
  width: number;
  height: number;
  captionsBurnedIn: boolean;
};

/**
 * Stitches scene clips (in order) into one H.264/AAC mp4 with faststart,
 * burning in the hook and captions when the ffmpeg build has drawtext. If the
 * burn-in fails (for example no usable font), the cut is rendered without it
 * and the captions are only in the WebVTT track.
 */
export async function stitchClips(input: {
  clips: StitchSource[];
  captions: Caption[];
  hook?: string;
  fps?: number;
  preset?: string;
}): Promise<StitchResult> {
  if (input.clips.length === 0) throw new FfmpegError("Nothing to stitch");
  const caps = await ffmpegCapabilities();
  if (!caps.ok) throw new FfmpegError("ffmpeg is not installed. Install it or set FFMPEG_PATH.");

  return withTempDir(async (dir) => {
    const clips: StitchClip[] = [];
    const sizes: { width: number; height: number }[] = [];
    for (const [index, clip] of input.clips.entries()) {
      const file = path.join(dir, `clip-${index}.mp4`);
      await writeFile(file, clip.bytes);
      const meta = await probe(file);
      if (!meta.hasVideo) throw new FfmpegError(`Clip ${index + 1} has no video stream`);
      sizes.push(meta);
      let voiceFile: string | undefined;
      if (clip.voice) {
        voiceFile = path.join(dir, `voice-${index}`);
        await writeFile(voiceFile, clip.voice);
      }
      clips.push({ file, durationS: clip.durationS, hasAudio: meta.hasAudio, voiceFile });
    }
    const { width, height } = outputSize(sizes);
    const output = path.join(dir, "final.mp4");
    const base = {
      clips,
      captions: input.captions,
      hook: input.hook,
      width,
      height,
      fps: input.fps ?? 30,
      fontFile: captionFont(),
      workDir: dir,
      output,
      preset: input.preset,
    };

    let captionsBurnedIn = caps.filters.has("drawtext");
    const attempt = async (burnCaptions: boolean) => {
      const { args, textFiles } = buildStitchArgs({ ...base, burnCaptions });
      for (const text of textFiles) await writeFile(text.file, text.text);
      await runFfmpeg(args, 600_000);
    };
    try {
      await attempt(captionsBurnedIn);
    } catch (error) {
      if (!captionsBurnedIn) throw error;
      captionsBurnedIn = false;
      await attempt(false);
    }

    const meta = await probe(output);
    let poster: Buffer | null = null;
    try {
      const posterFile = path.join(dir, "poster.jpg");
      await runFfmpeg(["-ss", seconds(Math.min(1, meta.durationS / 2)), "-i", output, "-frames:v", "1", "-q:v", "4", posterFile]);
      poster = await readFile(posterFile);
    } catch {
      poster = null;
    }
    return {
      mp4: await readFile(output),
      poster,
      vtt: captionsVtt(input.captions),
      durationS: meta.durationS,
      width: meta.width,
      height: meta.height,
      captionsBurnedIn,
    };
  });
}
