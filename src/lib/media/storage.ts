import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local object storage for rendered clips and stitched videos.
 * Files live under MEDIA_DIR (default ./.data/media) and are addressed by an
 * unguessable key. Swap this module for S3/R2 in production (see REPORT.md).
 */

export const MEDIA_KEY_PATTERN = /^[a-f0-9-]{36}\.(mp4|webm|mov|png|jpg|srt)$/;
export const DEFAULT_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaDir(): string {
  return path.resolve(process.env.MEDIA_DIR?.trim() || "./.data/media");
}

export function mediaMaxBytes(): number {
  const raw = Number(process.env.MEDIA_MAX_BYTES ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MEDIA_MAX_BYTES;
}

export function isMediaKey(key: string): boolean {
  return MEDIA_KEY_PATTERN.test(key);
}

export function mediaPath(key: string): string {
  if (!isMediaKey(key)) throw new MediaError("Invalid media key");
  return path.join(mediaDir(), key);
}

export function extensionFor(contentType: string, fallback = "mp4"): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  return fallback;
}

export async function saveMedia(bytes: Uint8Array, ext: string): Promise<string> {
  if (bytes.byteLength > mediaMaxBytes()) throw new MediaError("Media file is over MEDIA_MAX_BYTES");
  const key = `${randomUUID()}.${ext}`;
  const file = mediaPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return key;
}

export async function readMedia(key: string): Promise<Buffer> {
  return readFile(mediaPath(key));
}

export async function mediaExists(key: string): Promise<boolean> {
  try {
    return (await stat(mediaPath(key))).isFile();
  } catch {
    return false;
  }
}

/** Path served by /api/media/[key]. */
export function mediaUrlPath(key: string): string {
  return `/api/media/${key}`;
}

/**
 * Absolute URL that TikTok, Instagram and Facebook can pull from.
 * Requires PUBLIC_BASE_URL (https) because the platforms fetch the file themselves.
 */
export function publicMediaUrl(key: string, base = process.env.PUBLIC_BASE_URL): string | null {
  const root = base?.trim().replace(/\/$/, "") ?? "";
  if (!root.startsWith("https://")) return null;
  return `${root}${mediaUrlPath(key)}`;
}
