import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs, videoRenders } from "@/db/schema";
import { mediaUrl } from "./assets";

export type RenderView = {
  status: "queued" | "rendering" | "ready" | "failed" | "none";
  videoUrl: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  captionsBurnedIn: boolean;
  mock: boolean;
  durationS: number | null;
  error: string | null;
  scenesDone: number;
  scenesTotal: number;
};

/** The render a video page should show: the current one, else the newest attempt, plus clip progress. */
export async function renderViewFor(video: { id: string; currentRenderId: string | null; plan: unknown }): Promise<RenderView> {
  const db = await getDb();
  const [render] = video.currentRenderId
    ? await db.select().from(videoRenders).where(eq(videoRenders.id, video.currentRenderId)).limit(1)
    : await db.select().from(videoRenders).where(eq(videoRenders.videoId, video.id)).orderBy(desc(videoRenders.createdAt)).limit(1);
  const clips = await db
    .select({ status: generationJobs.status, request: generationJobs.request })
    .from(generationJobs)
    .where(and(eq(generationJobs.videoId, video.id), eq(generationJobs.kind, "clip")));
  const plan = (video.plan ?? {}) as { scenes?: unknown[] };
  const done = new Set(
    clips.filter((clip) => clip.status === "succeeded").map((clip) => (clip.request as { sceneIndex?: number } | null)?.sceneIndex ?? 0),
  );
  const snapshot = (render?.manifest ?? {}) as { captionsAssetId?: string; mock?: boolean };
  const ready = render?.status === "ready" && !!render.outputAssetId;
  return {
    status: render?.status ?? "none",
    videoUrl: ready && render?.outputAssetId ? mediaUrl(render.outputAssetId) : null,
    posterUrl: ready && render?.posterAssetId ? mediaUrl(render.posterAssetId) : null,
    captionsUrl: ready && snapshot.captionsAssetId ? mediaUrl(snapshot.captionsAssetId) : null,
    captionsBurnedIn: render?.captionsBurnedIn ?? true,
    mock: snapshot.mock === true,
    durationS: render?.durationMs ? render.durationMs / 1000 : null,
    error: render?.error ?? null,
    scenesDone: done.size,
    scenesTotal: Array.isArray(plan.scenes) ? plan.scenes.length : 0,
  };
}
