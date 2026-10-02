import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaAssets, videoRenders } from "@/db/schema";
import { verifyPull } from "@/lib/media/pull";
import { getMediaStorage } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves a rendered MP4 to a platform pulling it for a post. Needs a valid,
 * unexpired signature (src/lib/media/pull.ts), and the asset must be the output
 * of a ready render. Anything else is 404, so ids cannot be probed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  if (!UUID.test(id) || !verifyPull(id, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Not found", { status: 404 });
  }
  const db = await getDb();
  const [row] = await db
    .select({ asset: mediaAssets })
    .from(mediaAssets)
    .innerJoin(videoRenders, and(eq(videoRenders.outputAssetId, mediaAssets.id), eq(videoRenders.status, "ready")))
    .where(eq(mediaAssets.id, id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  const media = row.asset;
  if (media.kind !== "video") return new Response("Not found", { status: 404 });
  if (media.storage === "external") return Response.redirect(media.url, 302);
  if (media.storage === "inline" || !media.storageKey) return new Response("Not found", { status: 404 });
  return getMediaStorage().serve(media.storageKey, request, media.mimeType);
}
