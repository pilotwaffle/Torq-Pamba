import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaAssets, type MediaAsset } from "@/db/schema";
import { probe } from "./ffmpeg";
import { getMediaStorage, type MediaStorage } from "./storage";

export type MediaKind = MediaAsset["kind"];
export type MediaSource = MediaAsset["source"];

/** Provider output larger than this is refused (a 15 s 1080p clip is ~10–40 MB). */
export const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "text/vtt": "vtt",
};

export function mediaUrl(assetId: string): string {
  return `/api/media/${assetId}`;
}

/** Writes bytes through the configured storage driver and records a `media_assets` row. */
export async function storeMedia(input: {
  workspaceId: string;
  kind: MediaKind;
  source: MediaSource;
  bytes: Uint8Array;
  mimeType: string;
  createdBy?: string | null;
  originalFilename?: string | null;
  storage?: MediaStorage;
}): Promise<MediaAsset> {
  if (input.bytes.byteLength > MAX_MEDIA_BYTES) throw new Error("Media file is too large");
  const storage = input.storage ?? getMediaStorage();
  const id = randomUUID();
  const now = new Date();
  const ext = EXTENSIONS[input.mimeType] ?? "bin";
  const key = `${input.workspaceId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${ext}`;
  const meta = input.kind === "video" || input.kind === "audio" ? await probeBytes(input.bytes, ext) : null;

  await storage.put(key, input.bytes, input.mimeType);
  const db = await getDb();
  const [row] = await db
    .insert(mediaAssets)
    .values({
      id,
      workspaceId: input.workspaceId,
      kind: input.kind,
      source: input.source,
      storage: storage.driver,
      storageKey: key,
      url: mediaUrl(id),
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      durationMs: meta ? Math.round(meta.durationS * 1000) : null,
      width: meta?.width || null,
      height: meta?.height || null,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      originalFilename: input.originalFilename ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error("Could not record media asset");
  return row;
}

async function probeBytes(bytes: Uint8Array, ext: string) {
  try {
    return await withTempDir(async (dir) => {
      const file = path.join(dir, `probe.${ext}`);
      await writeFile(file, bytes);
      return probe(file);
    });
  } catch {
    // ffprobe missing or the file is not a media container; keep the bytes, skip the metadata.
    return null;
  }
}

export async function readMedia(asset: Pick<MediaAsset, "storage" | "storageKey" | "url">, storage?: MediaStorage): Promise<Buffer> {
  if (asset.storage === "inline") {
    const comma = asset.url.indexOf(",");
    return Buffer.from(asset.url.slice(comma + 1), asset.url.slice(0, comma).endsWith(";base64") ? "base64" : "utf8");
  }
  if (asset.storage === "external" || !asset.storageKey) {
    return fetchBytes(asset.url);
  }
  return (storage ?? getMediaStorage()).get(asset.storageKey);
}

export async function getWorkspaceMedia(workspaceId: string, assetId: string): Promise<MediaAsset | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/**
 * Downloads provider output. https only (plus http on loopback outside
 * production, for local fakes); follows redirects; stops at MAX_MEDIA_BYTES.
 */
export async function fetchBytes(url: string, headers: Record<string, string> = {}, timeoutMs = 300_000): Promise<Buffer> {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback && process.env.NODE_ENV !== "production")) {
    throw new Error(`Refusing to download media over ${parsed.protocol}`);
  }
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES) throw new Error("Download is too large");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error("Download is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "torq-media-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
