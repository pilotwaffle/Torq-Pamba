import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaAssets, type MediaAsset } from "@/db/schema";

/**
 * Stores a voice track, sample, or talking clip as a `media_assets` row.
 * `data:` URLs are kept inline; vendor URLs are `external` (not copied).
 */
export async function storeMedia(input: {
  workspaceId: string;
  kind: "audio" | "video";
  source: "upload" | "generated";
  url: string;
  mimeType: string;
  bytes?: Uint8Array;
  durationMs?: number | null;
  originalFilename?: string | null;
  createdBy?: string | null;
}): Promise<MediaAsset> {
  const db = await getDb();
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind,
      source: input.source,
      storage: input.url.startsWith("data:") ? "inline" : "external",
      url: input.url,
      mimeType: input.mimeType,
      sizeBytes: input.bytes?.length ?? null,
      durationMs: input.durationMs ?? null,
      sha256: input.bytes ? createHash("sha256").update(input.bytes).digest("hex") : null,
      originalFilename: input.originalFilename ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!asset) throw new Error("Could not store the media asset");
  return asset;
}

export async function getMedia(workspaceId: string, assetId: string | null | undefined): Promise<MediaAsset | null> {
  if (!assetId) return null;
  const db = await getDb();
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.workspaceId, workspaceId)))
    .limit(1);
  return asset ?? null;
}
