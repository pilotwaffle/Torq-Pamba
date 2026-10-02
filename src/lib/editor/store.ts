import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  chatMessages,
  mediaAssets,
  sceneTakes,
  videoCaptions,
  videoHooks,
  videoScenes,
  videos,
} from "@/db/schema";
import { isVideoPlan } from "@/lib/agent/plan";
import { writeAudit } from "@/lib/audit";
import { parseManifest } from "@/lib/router";
import { getWorkspaceVideo } from "@/lib/videos";
import {
  captionsFromManifest,
  cleanCaption,
  cleanHook,
  composeManifest,
  EditorError,
  isEditableStatus,
  MAX_HOOKS,
  type EditorCaption,
  type EditorHook,
  type EditorScene,
  type EditorState,
  type EditorTake,
} from "./state";

type Video = typeof videos.$inferSelect;

/** Stores a generated frame or clip URL as a media asset. Data URLs are `inline`; anything else is `external`. */
export async function storeTakeAsset(input: {
  workspaceId: string;
  url: string;
  kind?: "image" | "video";
  durationMs?: number | null;
}): Promise<string | null> {
  if (!input.url) return null;
  const db = await getDb();
  const inline = input.url.startsWith("data:");
  const mime = inline ? (input.url.slice(5).split(/[;,]/)[0] ?? "") : "";
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      workspaceId: input.workspaceId,
      kind: input.kind ?? "image",
      source: "generated",
      storage: inline ? "inline" : "external",
      url: input.url,
      mimeType: mime || (input.kind === "video" ? "video/mp4" : "image/svg+xml"),
      durationMs: input.durationMs ?? null,
    })
    .returning({ id: mediaAssets.id });
  return asset?.id ?? null;
}

/**
 * Creates the editor rows for a generated video the first time it is opened:
 * one scene per manifest scene with take 1 selected, the caption cues, and the
 * plan's hook options with the used hook selected. Safe to call repeatedly.
 */
export async function ensureEditor(video: Video): Promise<void> {
  const manifest = parseManifest(video.manifest);
  if (!manifest || manifest.scenes.length === 0) return;
  const db = await getDb();
  const [existing] = await db
    .select({ id: videoScenes.id })
    .from(videoScenes)
    .where(eq(videoScenes.videoId, video.id))
    .limit(1);
  if (existing) return;

  const hookOptions = await planHooksFor(video, manifest.hook);
  const assetIds = await Promise.all(
    manifest.scenes.map((scene) => storeTakeAsset({ workspaceId: video.workspaceId, url: scene.frameUrl })),
  );

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(videoScenes)
      .values(
        manifest.scenes.map((scene, index) => ({
          videoId: video.id,
          position: index,
          visual: scene.visual,
          line: scene.line,
          durationMs: Math.max(1, Math.round(scene.durationS * 1000)),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: videoScenes.id, position: videoScenes.position });
    // Another request seeded this video first.
    if (inserted.length === 0) return;
    const sceneByPosition = new Map(inserted.map((row) => [row.position, row.id]));

    for (const [index, scene] of manifest.scenes.entries()) {
      const sceneId = sceneByPosition.get(index);
      if (!sceneId) continue;
      const [take] = await tx
        .insert(sceneTakes)
        .values({
          sceneId,
          number: 1,
          status: "ready",
          provider: scene.model || null,
          model: scene.model || null,
          prompt: `${video.prompt}\n${scene.visual}`.trim(),
          posterAssetId: assetIds[index] ?? null,
          durationMs: Math.round(scene.durationS * 1000),
        })
        .returning({ id: sceneTakes.id });
      if (take) await tx.update(videoScenes).set({ selectedTakeId: take.id }).where(eq(videoScenes.id, sceneId));
    }

    const cues = captionsFromManifest(manifest);
    if (cues.length > 0) {
      await tx.insert(videoCaptions).values(
        cues.map((cue, position) => ({
          videoId: video.id,
          sceneId: cue.sceneIndex == null ? null : (sceneByPosition.get(cue.sceneIndex) ?? null),
          position,
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: cue.text,
        })),
      );
    }

    if (hookOptions.length > 0) {
      await tx.insert(videoHooks).values(
        hookOptions.map((text, position) => ({
          videoId: video.id,
          position,
          text,
          isSelected: text === manifest.hook,
        })),
      );
    }
  });
}

/** The plan's hook options for this video, with the hook it was generated with first if the plan is gone. */
async function planHooksFor(video: Video, usedHook: string): Promise<string[]> {
  const db = await getDb();
  const [message] = await db
    .select({ data: chatMessages.data })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.workspaceId, video.workspaceId),
        sql`${chatMessages.data}->>'generatedVideoId' = ${video.id}`,
      ),
    )
    .limit(1);
  const plan = (message?.data as { plan?: unknown } | null)?.plan;
  const options = isVideoPlan(plan) ? [...plan.hooks] : [];
  if (usedHook && !options.includes(usedHook)) options.unshift(usedHook);
  return [...new Set(options.map((hook) => hook.trim()).filter(Boolean))].slice(0, MAX_HOOKS);
}

/** Editor state for a workspace's video, seeding it on first open. Null when the video is not in this workspace. */
export async function loadEditor(workspaceId: string, videoId: string): Promise<EditorState | null> {
  const video = await getWorkspaceVideo(workspaceId, videoId);
  if (!video) return null;
  await ensureEditor(video);
  return readEditor(video);
}

async function readEditor(video: Video): Promise<EditorState> {
  const db = await getDb();
  const sceneRows = await db
    .select()
    .from(videoScenes)
    .where(eq(videoScenes.videoId, video.id))
    .orderBy(asc(videoScenes.position));
  const sceneIds = sceneRows.map((scene) => scene.id);
  const takeRows =
    sceneIds.length === 0
      ? []
      : await db
          .select({
            id: sceneTakes.id,
            sceneId: sceneTakes.sceneId,
            number: sceneTakes.number,
            status: sceneTakes.status,
            provider: sceneTakes.provider,
            model: sceneTakes.model,
            costUsd: sceneTakes.costUsd,
            error: sceneTakes.error,
            frameUrl: mediaAssets.url,
          })
          .from(sceneTakes)
          .leftJoin(mediaAssets, eq(mediaAssets.id, sceneTakes.posterAssetId))
          .where(inArray(sceneTakes.sceneId, sceneIds))
          .orderBy(asc(sceneTakes.number));
  const captionRows = await db
    .select()
    .from(videoCaptions)
    .where(eq(videoCaptions.videoId, video.id))
    .orderBy(asc(videoCaptions.startMs), asc(videoCaptions.position));
  const hookRows = await db
    .select()
    .from(videoHooks)
    .where(eq(videoHooks.videoId, video.id))
    .orderBy(asc(videoHooks.position));

  const scenes: EditorScene[] = sceneRows.map((scene) => ({
    id: scene.id,
    position: scene.position,
    visual: scene.visual,
    line: scene.line,
    durationMs: scene.durationMs,
    selectedTakeId: scene.selectedTakeId,
    takes: takeRows
      .filter((take) => take.sceneId === scene.id)
      .map(
        (take): EditorTake => ({
          id: take.id,
          number: take.number,
          status: take.status,
          provider: take.provider,
          model: take.model,
          frameUrl: take.frameUrl ?? "",
          costUsd: Number(take.costUsd ?? 0),
          error: take.error,
        }),
      ),
  }));
  const captions: EditorCaption[] = captionRows.map((cue) => ({
    id: cue.id,
    sceneId: cue.sceneId,
    position: cue.position,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    source: cue.source,
  }));
  const hooks: EditorHook[] = hookRows.map((hook) => ({
    id: hook.id,
    position: hook.position,
    text: hook.text,
    source: hook.source,
    isSelected: hook.isSelected,
  }));
  return { videoId: video.id, editable: isEditableStatus(video.status), scenes, captions, hooks };
}

/** Loads the video and its editor state, or throws when it is missing or no longer editable. */
export async function requireEditable(workspaceId: string, videoId: string): Promise<{ video: Video; state: EditorState }> {
  const video = await getWorkspaceVideo(workspaceId, videoId);
  if (!video) throw new EditorError("Video not found");
  if (!isEditableStatus(video.status)) {
    throw new EditorError("This video is approved, so its scenes, captions and hooks are locked.");
  }
  await ensureEditor(video);
  return { video, state: await readEditor(video) };
}

/** Writes the edited scenes, captions and hook back into `videos.manifest`. */
export async function syncManifest(videoId: string): Promise<void> {
  const db = await getDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  const previous = video ? parseManifest(video.manifest) : null;
  if (!video || !previous) return;
  const state = await readEditor(video);
  if (state.scenes.length === 0) return;
  const manifest = composeManifest({ ...(video.manifest ?? {}), ...previous }, state);
  await db.update(videos).set({ manifest, updatedAt: new Date() }).where(eq(videos.id, videoId));
}

export async function selectTake(input: {
  workspaceId: string;
  videoId: string;
  takeId: string;
  actor: string;
}): Promise<void> {
  const { state } = await requireEditable(input.workspaceId, input.videoId);
  const scene = state.scenes.find((item) => item.takes.some((take) => take.id === input.takeId));
  const take = scene?.takes.find((item) => item.id === input.takeId);
  if (!scene || !take) throw new EditorError("That take is not part of this video.");
  if (take.status !== "ready") throw new EditorError("Only a finished take can be used.");
  if (scene.selectedTakeId === take.id) return;

  const db = await getDb();
  await db
    .update(videoScenes)
    .set({ selectedTakeId: take.id, updatedAt: new Date() })
    .where(eq(videoScenes.id, scene.id));
  await syncManifest(input.videoId);
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "video.take_selected",
    data: { videoId: input.videoId, scene: scene.position + 1, take: take.number },
  });
}

/** Saves edited caption text. Unchanged cues are left alone; changed cues become `user` cues. */
export async function saveCaptions(input: {
  workspaceId: string;
  videoId: string;
  actor: string;
  edits: { id: string; text: string }[];
}): Promise<number> {
  const { state } = await requireEditable(input.workspaceId, input.videoId);
  const byId = new Map(state.captions.map((cue) => [cue.id, cue]));
  const changes: { id: string; text: string }[] = [];
  for (const edit of input.edits) {
    const cue = byId.get(edit.id);
    if (!cue) throw new EditorError("That caption is not part of this video.");
    const text = cleanCaption(edit.text);
    if (text !== cue.text) changes.push({ id: cue.id, text });
  }
  if (changes.length === 0) return 0;

  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const change of changes) {
      await tx
        .update(videoCaptions)
        .set({ text: change.text, source: "user", updatedBy: input.actor, updatedAt: new Date() })
        .where(and(eq(videoCaptions.id, change.id), eq(videoCaptions.videoId, input.videoId)));
    }
  });
  await syncManifest(input.videoId);
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "video.captions_edited",
    data: { videoId: input.videoId, count: changes.length },
  });
  return changes.length;
}

/**
 * Saves hook text edits, an optional new hook, and which hook is used.
 * `selected` is a hook id, or `"new"` for the added hook.
 */
export async function saveHooks(input: {
  workspaceId: string;
  videoId: string;
  actor: string;
  edits: { id: string; text: string }[];
  added?: string;
  selected: string;
}): Promise<void> {
  const { state } = await requireEditable(input.workspaceId, input.videoId);
  const byId = new Map(state.hooks.map((hook) => [hook.id, hook]));
  const changes = input.edits.map((edit) => {
    const hook = byId.get(edit.id);
    if (!hook) throw new EditorError("That hook is not part of this video.");
    return { hook, text: cleanHook(edit.text) };
  });
  const added = input.added?.trim() ? cleanHook(input.added) : "";
  if (added && state.hooks.length >= MAX_HOOKS) throw new EditorError(`A video can have up to ${MAX_HOOKS} hooks.`);
  if (input.selected === "new" ? !added : !byId.has(input.selected)) throw new EditorError("Pick the hook to use.");

  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const { hook, text } of changes) {
      if (text === hook.text) continue;
      await tx
        .update(videoHooks)
        .set({ text, source: "user", updatedBy: input.actor, updatedAt: new Date() })
        .where(eq(videoHooks.id, hook.id));
    }
    let selectedId = input.selected;
    if (added) {
      const position = state.hooks.reduce((max, hook) => Math.max(max, hook.position), -1) + 1;
      const [row] = await tx
        .insert(videoHooks)
        .values({ videoId: input.videoId, position, text: added, source: "user", updatedBy: input.actor })
        .returning({ id: videoHooks.id });
      if (input.selected === "new" && row) selectedId = row.id;
    }
    // Clear first: a partial unique index allows one selected hook per video.
    await tx
      .update(videoHooks)
      .set({ isSelected: false })
      .where(and(eq(videoHooks.videoId, input.videoId), eq(videoHooks.isSelected, true)));
    await tx
      .update(videoHooks)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(and(eq(videoHooks.id, selectedId), eq(videoHooks.videoId, input.videoId)));
  });
  await syncManifest(input.videoId);
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "video.hooks_edited",
    data: { videoId: input.videoId, added: Boolean(added) },
  });
}
