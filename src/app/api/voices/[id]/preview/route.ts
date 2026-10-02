import { requireWorkspace } from "@/lib/auth/guards";
import { previewAudio } from "@/lib/voices/preview";
import { getVoice } from "@/lib/voices/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireWorkspace();
  const { id } = await params;
  const voice = await getVoice(workspace.id, id);
  if (!voice) return new Response("Unknown voice", { status: 404 });
  const preview = await previewAudio(voice);
  if (!preview) return new Response("No preview for this voice yet", { status: 404 });
  if ("redirect" in preview) return Response.redirect(preview.redirect, 302);
  return new Response(Buffer.from(preview.bytes), {
    headers: {
      "content-type": preview.mimeType,
      "content-length": String(preview.bytes.length),
      "cache-control": "private, max-age=3600",
    },
  });
}
