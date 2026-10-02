import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GET as pull } from "@/app/api/media/[id]/pull/route";
import { getDb } from "@/db";
import { videoRenders, videos } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { storeMedia } from "./assets";
import { MOCK_CLIP_FIXTURE } from "./mock-clip";
import { PULL_TTL_S, publicPullUrl, pullSignature, verifyPull } from "./pull";

const ASSET = "6f1c2a7e-1d2b-4c3d-8e9f-0a1b2c3d4e5f";
const BASE = "https://studio.example.com";

async function renderedVideo(label: string, status: "ready" | "rendering" = "ready") {
  const { workspace } = await signupAccount({
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "correct-horse-battery",
    workspaceName: `${label} Co`,
  });
  const db = await getDb();
  const bytes = await readFile(MOCK_CLIP_FIXTURE);
  const asset = await storeMedia({ workspaceId: workspace.id, kind: "video", source: "render", bytes, mimeType: "video/mp4" });
  const [video] = await db.insert(videos).values({ workspaceId: workspace.id, title: "Pull", status: "approved" }).returning();
  const [render] = await db.insert(videoRenders).values({ videoId: video!.id, status, outputAssetId: asset.id }).returning();
  return { workspace, asset, video: video!, render: render!, bytes };
}

function get(url: string, id: string) {
  return pull(new Request(url), { params: Promise.resolve({ id }) });
}

describe("signed media pull URLs", () => {
  it("are https only, expire, and are bound to one asset", () => {
    const now = new Date("2026-10-02T07:00:00Z");
    expect(publicPullUrl(ASSET, { base: "http://localhost:3000", now })).toBeNull();
    expect(publicPullUrl(ASSET, { base: "", now })).toBeNull();
    const url = new URL(publicPullUrl(ASSET, { base: `${BASE}/`, now })!);
    expect(url.origin + url.pathname).toBe(`${BASE}/api/media/${ASSET}/pull`);
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(Number(exp)).toBe(Math.floor(now.getTime() / 1000) + PULL_TTL_S);
    expect(verifyPull(ASSET, exp, sig, now)).toBe(true);
    // Another asset, a changed expiry, a forged signature, or a late request all fail.
    expect(verifyPull("00000000-0000-4000-8000-000000000000", exp, sig, now)).toBe(false);
    expect(verifyPull(ASSET, String(Number(exp) + 3600), sig, now)).toBe(false);
    expect(verifyPull(ASSET, exp, `${sig!.slice(0, -2)}xx`, now)).toBe(false);
    expect(verifyPull(ASSET, exp, null, now)).toBe(false);
    expect(verifyPull(ASSET, exp, sig, new Date(now.getTime() + (PULL_TTL_S + 1) * 1000))).toBe(false);
    // The signature depends on TOKEN_ENCRYPTION_KEY.
    const other = { TOKEN_ENCRYPTION_KEY: "11".repeat(32) };
    expect(pullSignature(ASSET, Number(exp), other)).not.toBe(sig);
  });

  it("the pull route serves a ready render's MP4 for a valid signature and 404s everything else", async () => {
    const { asset, bytes } = await renderedVideo("pull-route");
    const url = publicPullUrl(asset.id, { base: BASE })!;
    const ok = await get(url, asset.id);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).equals(bytes)).toBe(true);

    expect((await get(url.replace(/sig=[^&]+/, "sig=forged"), asset.id)).status).toBe(404);
    expect((await get(`${BASE}/api/media/${asset.id}/pull`, asset.id)).status).toBe(404);
    expect((await get(url, "not-a-uuid")).status).toBe(404);

    // A validly signed id that is not a ready render's output is still 404.
    const pending = await renderedVideo("pull-pending", "rendering");
    expect((await get(publicPullUrl(pending.asset.id, { base: BASE })!, pending.asset.id)).status).toBe(404);
  });
});
