import { createHash, createHmac } from "node:crypto";
import type { MediaStorage } from "./storage";

export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com. Default: https://s3.<region>.amazonaws.com */
  endpoint?: string;
  /** Path-style (`endpoint/bucket/key`). Default true when `endpoint` is set (R2, MinIO). */
  forcePathStyle?: boolean;
  /** Serve objects from this public base URL (a CDN or R2 public bucket) instead of presigned URLs. */
  publicBaseUrl?: string;
};

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const read = (key: string) => env[key]?.trim() ?? "";
  const endpoint = read("MEDIA_S3_ENDPOINT") || undefined;
  const config: S3Config = {
    bucket: read("MEDIA_S3_BUCKET"),
    region: read("MEDIA_S3_REGION") || (endpoint ? "auto" : "us-east-1"),
    accessKeyId: read("MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: read("MEDIA_S3_SECRET_ACCESS_KEY"),
    endpoint,
    forcePathStyle: read("MEDIA_S3_FORCE_PATH_STYLE") ? read("MEDIA_S3_FORCE_PATH_STYLE") === "1" : undefined,
    publicBaseUrl: read("MEDIA_S3_PUBLIC_BASE_URL") || undefined,
  };
  const missing = (["bucket", "accessKeyId", "secretAccessKey"] as const).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`MEDIA_STORAGE=s3 needs MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY`);
  }
  return config;
}

/** RFC 3986 encoding as SigV4 requires; `/` is kept when encoding an object key path. */
function encode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replaceAll("%2F", "/") : encoded;
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

export function objectUrl(config: S3Config, key: string): URL {
  const path = `/${encode(key, true)}`;
  const endpoint = new URL(config.endpoint ?? `https://s3.${config.region}.amazonaws.com`);
  const pathStyle = config.forcePathStyle ?? Boolean(config.endpoint);
  if (pathStyle) return new URL(`${endpoint.origin}/${encode(config.bucket)}${path}`);
  return new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}${path}`);
}

/**
 * AWS Signature Version 4 query-string presigning with only `host` signed and
 * an `UNSIGNED-PAYLOAD` body hash. Checked against the example in
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html.
 * R2 accepts the same URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 */
export function presignS3Url(
  config: S3Config,
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  key: string,
  options: { expiresS?: number; now?: Date } = {},
): string {
  const url = objectUrl(config, key);
  const now = options.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(options.expiresS ?? 3600)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = params
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonical = [method, url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, day), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${signature}`;
}

async function check(response: Response, action: string, key: string): Promise<Response> {
  if (response.ok) return response;
  const text = (await response.text()).slice(0, 200);
  throw new Error(`S3 ${action} ${key} failed: HTTP ${response.status} ${text}`);
}

export function s3Storage(config: S3Config): MediaStorage {
  return {
    driver: "s3",
    async put(key, bytes, contentType) {
      const response = await fetch(presignS3Url(config, "PUT", key), {
        method: "PUT",
        headers: { "content-type": contentType },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(120_000),
      });
      await check(response, "PUT", key);
    },
    async get(key) {
      const response = await check(
        await fetch(presignS3Url(config, "GET", key), { signal: AbortSignal.timeout(120_000) }),
        "GET",
        key,
      );
      return Buffer.from(await response.arrayBuffer());
    },
    async serve(key) {
      // The bucket serves ranges itself; the media route has already checked access.
      const location = config.publicBaseUrl
        ? `${config.publicBaseUrl.replace(/\/$/, "")}/${encode(key, true)}`
        : presignS3Url(config, "GET", key, { expiresS: 3600 });
      return new Response(null, { status: 302, headers: { location, "cache-control": "private, no-store" } });
    },
    async delete(key) {
      const response = await fetch(presignS3Url(config, "DELETE", key), { method: "DELETE" });
      if (response.status !== 404) await check(response, "DELETE", key);
    },
  };
}
