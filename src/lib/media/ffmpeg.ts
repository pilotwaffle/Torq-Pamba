import { spawn } from "node:child_process";

/** `FFMPEG_PATH` / `FFPROBE_PATH` override the binaries on PATH. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

function run(binary: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new FfmpegError(`${binary} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1_000_000) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new FfmpegError(`${binary} could not start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new FfmpegError(`${binary} exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

export function runFfmpeg(args: string[], timeoutMs = 120_000) {
  return run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);
}

type Capabilities = { ok: boolean; filters: Set<string>; decoders: Set<string> };
let capabilities: Promise<Capabilities> | null = null;

/** What the local ffmpeg build can do. Cached for the process. */
export function ffmpegCapabilities(): Promise<Capabilities> {
  capabilities ??= (async () => {
    try {
      const [filters, decoders] = await Promise.all([
        run(ffmpegPath(), ["-hide_banner", "-filters"], 10_000),
        run(ffmpegPath(), ["-hide_banner", "-decoders"], 10_000),
      ]);
      const names = (text: string, column: number) =>
        new Set(
          text
            .split("\n")
            .map((line) => line.trim().split(/\s+/)[column] ?? "")
            .filter(Boolean),
        );
      return { ok: true, filters: names(filters.stdout, 1), decoders: names(decoders.stdout, 1) };
    } catch {
      return { ok: false, filters: new Set<string>(), decoders: new Set<string>() };
    }
  })();
  return capabilities;
}

export type ProbeResult = { durationS: number; width: number; height: number; hasVideo: boolean; hasAudio: boolean };

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(
    ffprobePath(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    30_000,
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const durationS = Number(parsed.format?.duration ?? video?.duration ?? 0);
  return {
    durationS: Number.isFinite(durationS) ? durationS : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasVideo: Boolean(video),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
}
