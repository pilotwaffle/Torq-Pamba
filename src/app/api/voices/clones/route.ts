import { requireWorkspace } from "@/lib/auth/guards";
import { MAX_CLONE_SAMPLES, MAX_SAMPLE_BYTES, submitClone, type ConsentBasis } from "@/lib/voices/clone";
import { VoiceError } from "@/lib/voices/store";
import type { AudioFile } from "@/lib/voices/types";

export const dynamic = "force-dynamic";

const RETURN_TO = "/app/avatars";

function back(query: Record<string, string>): Response {
  const search = new URLSearchParams(query).toString();
  return new Response(null, { status: 303, headers: { location: `${RETURN_TO}?${search}#voice-clones` } });
}

/** Multipart upload for voice samples. A route handler, not a server action, so samples can exceed 1 MB. */
export async function POST(request: Request) {
  const { user, workspace } = await requireWorkspace();
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return new Response("Cross-site request refused", { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_CLONE_SAMPLES * MAX_SAMPLE_BYTES + 512 * 1024) return back({ cloneError: "Those samples are too large" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back({ cloneError: "Could not read the upload" });
  }
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const files = [...form.getAll("samples"), ...form.getAll("recording")].filter(
    (value): value is File => typeof value !== "string" && value.size > 0,
  );
  const samples: AudioFile[] = await Promise.all(
    files.slice(0, MAX_CLONE_SAMPLES + 1).map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      filename: file.name || "sample",
    })),
  );

  try {
    const { clone } = await submitClone({
      workspaceId: workspace.id,
      actorUserId: user.id,
      cloneId: text("cloneId") || undefined,
      name: text("name"),
      speakerName: text("speakerName"),
      basis: text("basis") as ConsentBasis,
      consent: text("consent") === "on",
      samples,
    });
    if (clone.status !== "ready") return back({ cloneError: clone.error ?? "Cloning failed. Nothing was charged." });
    return back({ cloned: clone.name });
  } catch (error) {
    if (error instanceof VoiceError) return back({ cloneError: error.message });
    throw error;
  }
}
