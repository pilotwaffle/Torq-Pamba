import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sceneTakes, videoScenes } from "@/db/schema";
import { queueRender, renderInputFor } from "@/lib/jobs/render";
import type { StitchedManifest } from "@/lib/router";

/**
 * A hook variant is a re-cut of the base video: the same clips with a new hook
 * and captions. It gets editor scenes whose selected takes point at the base's
 * clip assets, and then a render goes through the wave 1 render API. The
 * variant's own manifest supplies the hook and captions. Returns false (and
 * queues nothing) when the base has no clips to reuse, e.g. a video made
 * before the render pipeline.
 */
export async function queueVariantRender(input: {
  baseVideoId: string;
  variantVideoId: string;
  manifest: StitchedManifest;
}): Promise<boolean> {
  let base;
  try {
    base = await renderInputFor(input.baseVideoId);
  } catch {
    return false;
  }
  if (base.scenes.length === 0) return false;
  const db = await getDb();
  const scenes = input.manifest.scenes;
  for (const [position, scene] of base.scenes.entries()) {
    const durationMs = Math.max(1, Math.round(scene.durationS * 1000));
    const [row] = await db
      .insert(videoScenes)
      .values({
        videoId: input.variantVideoId,
        position,
        visual: scenes[position]?.visual ?? "",
        line: scenes[position]?.line ?? "",
        durationMs,
      })
      .returning({ id: videoScenes.id });
    if (!row) throw new Error("Could not copy a scene for the variant");
    const [take] = await db
      .insert(sceneTakes)
      .values({
        sceneId: row.id,
        number: 1,
        status: "ready",
        prompt: "Reused from the base video (hook test re-cut)",
        clipAssetId: scene.clipAssetId,
        voiceAssetId: scene.voiceAssetId,
        durationMs,
      })
      .returning({ id: sceneTakes.id });
    if (!take) throw new Error("Could not copy a take for the variant");
    await db.update(videoScenes).set({ selectedTakeId: take.id }).where(eq(videoScenes.id, row.id));
  }
  await queueRender(input.variantVideoId, "hook_variant");
  return true;
}
