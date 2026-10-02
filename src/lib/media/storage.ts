import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { s3Storage, s3ConfigFromEnv } from "./s3";

/**
 * Where media bytes live. `driver` is the `media_assets.storage` value.
 * `MEDIA_STORAGE=local` (default) writes under `MEDIA_LOCAL_DIR`;
 * `MEDIA_STORAGE=s3` uses an S3-compatible bucket (AWS S3, Cloudflare R2).
 */
export interface MediaStorage {
  driver: "local" | "s3";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** An HTTP response for the object, honouring `Range` where the driver can. */
  serve(key: string, request: Request, contentType: string): Promise<Response>;
  delete(key: string): Promise<void>;
}

export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export function localMediaRoot(): string {
  const configured = process.env.MEDIA_LOCAL_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "test") return path.join(os.tmpdir(), "torq-media-test");
  return path.resolve(".data/media");
}

/** Keys are relative, slash-separated, and may not climb out of the root. */
export function safeKey(key: string): string {
  const normalized = path.posix.normalize(key.replaceAll("\\", "/"));
  if (!normalized || normalized.startsWith("..") || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new MediaStorageError(`Invalid media key ${key}`);
  }
  return normalized;
}

/** Parses a single `bytes=a-b` range. Returns null for no or unsatisfiable ranges. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size === 0) return null;
  const [, from = "", to = ""] = match;
  if (!from && !to) return null;
  let start: number;
  let end: number;
  if (!from) {
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to ? Math.min(Number(to), size - 1) : size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

export function diskStorage(root = localMediaRoot()): MediaStorage {
  const resolve = (key: string) => path.join(root, ...safeKey(key).split("/"));
  return {
    driver: "local",
    async put(key, bytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      const partial = `${file}.${process.pid}.part`;
      await writeFile(partial, bytes);
      await rename(partial, file);
    },
    async get(key) {
      return readFile(resolve(key));
    },
    async serve(key, request, contentType) {
      const file = resolve(key);
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch {
        return new Response("Not found", { status: 404 });
      }
      const headers: Record<string, string> = {
        "content-type": contentType,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
      };
      const rangeHeader = request.headers.get("range");
      const range = parseRange(rangeHeader, size);
      if (rangeHeader && !range) {
        return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      const body =
        size === 0
          ? null
          : (Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>);
      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          ...headers,
          "content-length": String(size === 0 ? 0 : end - start + 1),
          ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
        },
      });
    },
    async delete(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

export function getMediaStorage(): MediaStorage {
  const driver = (process.env.MEDIA_STORAGE?.trim() || "local").toLowerCase();
  if (driver === "local") return diskStorage();
  if (driver === "s3" || driver === "r2") return s3Storage(s3ConfigFromEnv());
  throw new MediaStorageError(`Unknown MEDIA_STORAGE "${driver}". Use local or s3.`);
}
