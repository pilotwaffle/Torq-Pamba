import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  generationJobs,
  mediaAssets,
  sceneTakes,
  videoCaptions,
  videoHooks,
  videoRenders,
  videos,
  videoScenes,
  type GenerationJob,
  type MediaAsset,
} from "@/db/schema";
import { readMedia, storeMedia } from "@/lib/media/assets";
import type { Caption, StitchSource } from "@/lib/media/stitch";
import { isMockJob } from "@/lib/providers/mock";
import { renderProvider } from "@/lib/providers/registry";
import { clipRequestOf } from "./clips";
import { MAX_RENDER_ATTEMPTS, retryDelayMs } from "./config";
import { parseManifest } from "./manifest";
import { markVideoReady } from "./settle";

export type RenderInputScene = { clipAssetId: string; voiceAssetId: string | null; durationS: number; mock: boolean };
export type RenderInput = { scenes: RenderInputScene[]; captions: Caption[]; hook: string };

/**
 * What a render uses. Editor scenes (`video_scenes` with a selected take that
 * has a clip) win when every scene has one; otherwise the succeeded clip jobs
 * in scene order. Captions and hook come from `video_captions` / the selected
 * `video_hooks` row when the editor has written them, else from the manifest.
 */
export async function renderInputFor(videoId: string): Promise<RenderInput> {
  const db = await getDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error("Video not found");
  const manifest = parseManifest(video.manifest);

  let scenes: RenderInputScene[] = [];
  const editorScenes = await db
    .select({
      durationMs: videoScenes.durationMs,
      clipAssetId: sceneTakes.clipAssetId,
      voiceAssetId: sceneTakes.voiceAssetId,
      lipsyncAssetId: sceneTakes.lipsyncAssetId,
      jobId: sceneTakes.jobId,
    })
    .from(videoScenes)
    .leftJoin(sceneTakes, eq(sceneTakes.id, videoScenes.selectedTakeId))
    .where(eq(videoScenes.videoId, videoId))
    .orderBy(asc(videoScenes.position));
  if (editorScenes.length > 0 && editorScenes.every((scene) => scene.lipsyncAssetId || scene.clipAssetId)) {
    const jobIds = editorScenes.map((scene) => scene.jobId).filter((id): id is string => !!id);
    const jobs = jobIds.length ? await db.select().from(generationJobs).where(inArray(generationJobs.id, jobIds)) : [];
    scenes = editorScenes.map((scene) => ({
      clipAssetId: (scene.lipsyncAssetId ?? scene.clipAssetId) as string,
      // A lip-synced clip already carries the voice.
      voiceAssetId: scene.lipsyncAssetId ? null : scene.voiceAssetId,
      durationS: scene.durationMs / 1000,
      mock: isMockJob(jobs.find((job) => job.id === scene.jobId)?.providerJobId ?? ""),
    }));
  } else {
    const clipJobs = await db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.videoId, videoId), eq(generationJobs.kind, "clip"), eq(generationJobs.status, "succeeded")));
    const byScene = new Map<number, GenerationJob>();
    for (const job of clipJobs) byScene.set(clipRequestOf(job).sceneIndex, job);
    const sceneCount = manifest?.scenes.length ?? byScene.size;
    for (let index = 0; index < sceneCount; index += 1) {
      const job = byScene.get(index);
      if (!job?.outputAssetId) throw new Error(`Scene ${index + 1} has no clip`);
      scenes.push({
        clipAssetId: job.outputAssetId,
        voiceAssetId: null,
        durationS: manifest?.scenes[index]?.durationS ?? clipRequestOf(job).durationS,
        mock: isMockJob(job.providerJobId ?? ""),
      });
    }
  }

  const editorCaptions = await db
    .select()
    .from(videoCaptions)
    .where(eq(videoCaptions.videoId, videoId))
    .orderBy(asc(videoCaptions.position));
  const captions: Caption[] = editorCaptions.length
    ? editorCaptions.map((cue) => ({ text: cue.text, startS: cue.startMs / 1000, endS: cue.endMs / 1000 }))
    : (manifest?.captions ?? []);
  const [selectedHook] = await db
    .select({ text: videoHooks.text })
    .from(videoHooks)
    .where(and(eq(videoHooks.videoId, videoId), eq(videoHooks.isSelected, true)))
    .limit(1);
  return { scenes, captions, hook: selectedHook?.text ?? manifest?.hook ?? "" };
}

/**
 * Queues a new render of a video's current scenes, captions and hook (the
 * editor calls this after a change). The live render switches when it is ready.
 */
export async function queueRender(videoId: string, reason = "edit"): Promise<{ jobId: string; renderId: string }> {
  const db = await getDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error("Video not found");
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generationJobs)
    .where(and(eq(generationJobs.videoId, videoId), eq(generationJobs.kind, "render")));
  const [job] = await db
    .insert(generationJobs)
    .values({
      workspaceId: video.workspaceId,
      videoId,
      kind: "render",
      provider: "ffmpeg",
      providerJobId: `render:${videoId}:${count + 1}`,
      status: "queued",
      request: { reason },
      nextPollAt: new Date(),
    })
    .returning();
  if (!job) throw new Error("Could not queue the render");
  const [render] = await db.insert(videoRenders).values({ videoId, status: "queued", jobId: job.id, manifest: { reason } }).returning();
  if (!render) throw new Error("Could not queue the render");
  return { jobId: job.id, renderId: render.id };
}

/** Runs one render job: stitch with ffmpeg, store mp4 + poster + WebVTT, point the video at it. */
export async function advanceRenderJob(job: GenerationJob, now = new Date()): Promise<void> {
  if (job.status !== "queued" || !job.videoId) return;
  const db = await getDb();
  const videoId = job.videoId;
  const [render] = await db.select().from(videoRenders).where(eq(videoRenders.jobId, job.id)).limit(1);
  const attempt = job.pollCount + 1;
  await db.update(generationJobs).set({ status: "running", submittedAt: job.submittedAt ?? now, updatedAt: now }).where(eq(generationJobs.id, job.id));
  if (render) await db.update(videoRenders).set({ status: "rendering" }).where(eq(videoRenders.id, render.id));

  try {
    const input = await renderInputFor(videoId);
    const assetIds = [
      ...input.scenes.map((scene) => scene.clipAssetId),
      ...input.scenes.map((scene) => scene.voiceAssetId).filter((id): id is string => !!id),
    ];
    const assets = await db.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds));
    const byId = new Map<string, MediaAsset>(assets.map((asset) => [asset.id, asset]));
    const load = async (id: string) => {
      const asset = byId.get(id);
      if (!asset) throw new Error(`Media ${id} is missing`);
      return readMedia(asset);
    };
    const clips: StitchSource[] = [];
    for (const scene of input.scenes) {
      clips.push({
        bytes: await load(scene.clipAssetId),
        durationS: scene.durationS,
        ...(scene.voiceAssetId ? { voice: await load(scene.voiceAssetId) } : {}),
      });
    }
    const mock = input.scenes.every((scene) => scene.mock);
    const result = await renderProvider(job.provider).render({ clips, captions: input.captions, hook: input.hook, draft: mock });

    const output = await storeMedia({ workspaceId: job.workspaceId, kind: "video", source: "render", bytes: result.mp4, mimeType: "video/mp4" });
    const poster = result.poster
      ? await storeMedia({ workspaceId: job.workspaceId, kind: "image", source: "render", bytes: result.poster, mimeType: "image/jpeg" })
      : null;
    const vtt = await storeMedia({
      workspaceId: job.workspaceId,
      kind: "captions",
      source: "render",
      bytes: Buffer.from(result.vtt),
      mimeType: "text/vtt",
    });
    const done = new Date();
    const snapshot = {
      scenes: input.scenes,
      captions: input.captions,
      hook: input.hook,
      captionsAssetId: vtt.id,
      mock,
      width: result.width,
      height: result.height,
    };
    let renderId = render?.id ?? null;
    if (render) {
      await db
        .update(videoRenders)
        .set({
          status: "ready",
          outputAssetId: output.id,
          posterAssetId: poster?.id ?? null,
          durationMs: Math.round(result.durationS * 1000),
          manifest: snapshot,
          captionsBurnedIn: result.captionsBurnedIn,
          error: null,
          completedAt: done,
        })
        .where(eq(videoRenders.id, render.id));
    } else {
      const [created] = await db
        .insert(videoRenders)
        .values({
          videoId,
          jobId: job.id,
          status: "ready",
          outputAssetId: output.id,
          posterAssetId: poster?.id ?? null,
          durationMs: Math.round(result.durationS * 1000),
          manifest: snapshot,
          captionsBurnedIn: result.captionsBurnedIn,
          completedAt: done,
        })
        .returning();
      renderId = created?.id ?? null;
    }
    await db
      .update(generationJobs)
      .set({ status: "succeeded", outputAssetId: output.id, pollCount: attempt, completedAt: done, nextPollAt: null, error: null, updatedAt: done })
      .where(eq(generationJobs.id, job.id));
    await db.update(videos).set({ currentRenderId: renderId, updatedAt: done }).where(eq(videos.id, videoId));
    await markVideoReady(videoId, renderId);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    if (attempt < MAX_RENDER_ATTEMPTS) {
      await db
        .update(generationJobs)
        .set({ status: "queued", pollCount: attempt, error: message, nextPollAt: new Date(now.getTime() + retryDelayMs(attempt)), updatedAt: new Date() })
        .where(eq(generationJobs.id, job.id));
      if (render) await db.update(videoRenders).set({ status: "queued", error: message }).where(eq(videoRenders.id, render.id));
      return;
    }
    await db
      .update(generationJobs)
      .set({ status: "failed", pollCount: attempt, error: message, completedAt: new Date(), nextPollAt: null, updatedAt: new Date() })
      .where(eq(generationJobs.id, job.id));
    if (render) await db.update(videoRenders).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(videoRenders.id, render.id));
    // The clips exist and were charged, so the video is still reviewable as the scene slideshow.
    await markVideoReady(videoId, null);
  }
}
