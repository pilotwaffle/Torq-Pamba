import { NextResponse } from "next/server";
import { isMediaKey, mediaExists, readMedia } from "@/lib/media/storage";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  srt: "application/x-subrip",
};

/**
 * Serves stored media by unguessable key. TikTok (PULL_FROM_URL), Instagram and
 * Facebook fetch rendered videos from here, so it cannot require a session.
 */
export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  if (!isMediaKey(key) || !(await mediaExists(key))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = await readMedia(key);
  const ext = key.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=3600",
    },
  });
}
