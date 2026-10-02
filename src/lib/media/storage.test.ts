import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { objectUrl, presignS3Url, s3ConfigFromEnv } from "./s3";
import { diskStorage, getMediaStorage, parseRange, safeKey } from "./storage";

describe("S3-compatible storage", () => {
  it("matches the AWS SigV4 presigned URL example", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignS3Url(
      {
        bucket: "examplebucket",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        endpoint: "https://s3.amazonaws.com",
        forcePathStyle: false,
      },
      "GET",
      "test.txt",
      { expiresS: 86400, now: new Date("2013-05-24T00:00:00Z") },
    );
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("uses path-style URLs for an R2 endpoint and reads its config from env", () => {
    const config = s3ConfigFromEnv({
      MEDIA_S3_BUCKET: "torq-media",
      MEDIA_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
      MEDIA_S3_ACCESS_KEY_ID: "id",
      MEDIA_S3_SECRET_ACCESS_KEY: "secret",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.region).toBe("auto");
    expect(objectUrl(config, "ws/2026/10/a b.mp4").toString()).toBe(
      "https://acct.r2.cloudflarestorage.com/torq-media/ws/2026/10/a%20b.mp4",
    );
    expect(() => s3ConfigFromEnv({} as unknown as NodeJS.ProcessEnv)).toThrow(/MEDIA_S3_BUCKET/);
  });
});

describe("local disk storage", () => {
  let root = "";
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("defaults to the local driver", () => {
    expect(getMediaStorage().driver).toBe("local");
  });

  it("rejects keys that leave the root", () => {
    expect(() => safeKey("../etc/passwd")).toThrow();
    expect(() => safeKey("/abs")).toThrow();
    expect(safeKey("a/./b.mp4")).toBe("a/b.mp4");
  });

  it("parses byte ranges", () => {
    expect(parseRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=20-", 10)).toBeNull();
    expect(parseRange(null, 10)).toBeNull();
  });

  it("stores, reads and serves with Range", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "torq-storage-test-"));
    const storage = diskStorage(root);
    await storage.put("ws/clip.mp4", Buffer.from("0123456789"), "video/mp4");
    expect((await storage.get("ws/clip.mp4")).toString()).toBe("0123456789");

    const full = await storage.serve("ws/clip.mp4", new Request("http://x/"), "video/mp4");
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(await full.text()).toBe("0123456789");

    const part = await storage.serve("ws/clip.mp4", new Request("http://x/", { headers: { range: "bytes=2-5" } }), "video/mp4");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");

    const bad = await storage.serve("ws/clip.mp4", new Request("http://x/", { headers: { range: "bytes=50-" } }), "video/mp4");
    expect(bad.status).toBe(416);
    expect((await storage.serve("ws/missing.mp4", new Request("http://x/"), "video/mp4")).status).toBe(404);

    await storage.delete("ws/clip.mp4");
    await expect(storage.get("ws/clip.mp4")).rejects.toThrow();
  });
});
