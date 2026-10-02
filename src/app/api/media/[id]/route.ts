import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mediaAssets, members } from "@/db/schema";
import { readSession } from "@/lib/auth/session";
import { getMediaStorage } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Streams a stored media file to a member of its workspace. Supports Range for video seeking. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await readSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const db = await getDb();
  const [asset] = await db
    .select({ asset: mediaAssets })
    .from(mediaAssets)
    .innerJoin(members, and(eq(members.workspaceId, mediaAssets.workspaceId), eq(members.userId, session.user.id)))
    .where(eq(mediaAssets.id, id))
    .limit(1);
  if (!asset) return new Response("Not found", { status: 404 });

  const media = asset.asset;
  if (media.storage === "external") return Response.redirect(media.url, 302);
  if (media.storage === "inline" || !media.storageKey) return new Response("Not found", { status: 404 });
  return getMediaStorage().serve(media.storageKey, request, media.mimeType);
}
