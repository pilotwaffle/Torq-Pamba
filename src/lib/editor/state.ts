import type { StitchedManifest } from "@/lib/router";

/**
 * Pure editor rules. The database side lives in `store.ts`; regeneration in
 * `regenerate.ts`; the job seam feature a plugs into in `jobs.ts`.
 */

export const MAX_CAPTION_CHARS = 200;
export const MAX_HOOK_CHARS = 100;
export const MAX_HOOKS = 6;
export const MAX_TAKES_PER_SCENE = 12;
export const MAX_DIRECTION_CHARS = 300;

export type EditorTake = {
  id: string;
  number: number;
  status: "pending" | "generating" | "ready" | "failed";
  provider: string | null;
  model: string | null;
  frameUrl: string;
  costUsd: number;
  error: string | null;
};

export type EditorScene = {
  id: string;
  position: number;
  visual: string;
  line: string;
  durationMs: number;
  selectedTakeId: string | null;
  takes: EditorTake[];
};

export type EditorCaption = {
  id: string;
  sceneId: string | null;
  position: number;
  startMs: number;
  endMs: number;
  text: string;
  source: "ai" | "user";
};

export type EditorHook = {
  id: string;
  position: number;
  text: string;
  source: "ai" | "user";
  isSelected: boolean;
};

export type EditorState = {
  videoId: string;
  editable: boolean;
  scenes: EditorScene[];
  captions: EditorCaption[];
  hooks: EditorHook[];
};

export class EditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorError";
  }
}

/**
 * Only a finished, not-yet-approved video can be edited. Once approved, the
 * approval covers exactly what the user saw, so the editor goes read-only.
 */
export function isEditableStatus(status: string): boolean {
  return status === "ready";
}

export function selectedTake(scene: Pick<EditorScene, "selectedTakeId" | "takes">): EditorTake | null {
  return scene.takes.find((take) => take.id === scene.selectedTakeId) ?? null;
}

export function nextTakeNumber(takes: readonly { number: number }[]): number {
  return takes.reduce((max, take) => Math.max(max, take.number), 0) + 1;
}

export function cleanCaption(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new EditorError("A caption cannot be empty.");
  if (cleaned.length > MAX_CAPTION_CHARS) {
    throw new EditorError(`Keep each caption under ${MAX_CAPTION_CHARS} characters.`);
  }
  return cleaned;
}

export function cleanHook(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new EditorError("A hook cannot be empty.");
  if (cleaned.length > MAX_HOOK_CHARS) throw new EditorError(`Keep each hook under ${MAX_HOOK_CHARS} characters.`);
  return cleaned;
}

export function cleanDirection(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_DIRECTION_CHARS);
}

/** The prompt for a new take: the video's prompt, the scene's visual, and the user's optional direction. */
export function takePrompt(input: { videoPrompt: string; visual: string; direction?: string }): string {
  const direction = cleanDirection(input.direction ?? "");
  return [input.videoPrompt, input.visual, direction ? `Direction: ${direction}` : ""].filter(Boolean).join("\n");
}

/** Caption cues from a stitched manifest, matched to scenes by time window. */
export function captionsFromManifest(
  manifest: Pick<StitchedManifest, "captions" | "scenes">,
): { sceneIndex: number | null; startMs: number; endMs: number; text: string }[] {
  const windows = sceneWindows(manifest.scenes.map((scene) => Math.round(scene.durationS * 1000)));
  return manifest.captions.map((cue) => {
    const startMs = Math.max(0, Math.round(cue.startS * 1000));
    const endMs = Math.max(startMs, Math.round(cue.endS * 1000));
    const sceneIndex = windows.findIndex((window) => startMs >= window.startMs && startMs < window.endMs);
    return { sceneIndex: sceneIndex >= 0 ? sceneIndex : null, startMs, endMs, text: cue.text };
  });
}

export function sceneWindows(durationsMs: readonly number[]): { startMs: number; endMs: number }[] {
  let cursor = 0;
  return durationsMs.map((duration) => {
    const window = { startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return window;
  });
}

/**
 * Rebuilds the stitched manifest from editor state, so the preview, approval
 * and a later render all read the edited scenes, captions and hook.
 * Keys the editor does not own are kept.
 */
export function composeManifest(
  previous: StitchedManifest & Record<string, unknown>,
  state: Pick<EditorState, "scenes" | "captions" | "hooks">,
): StitchedManifest & Record<string, unknown> {
  const ordered = [...state.scenes].sort((a, b) => a.position - b.position);
  const scenes = ordered.map((scene, index) => {
    const take = selectedTake(scene);
    const before = previous.scenes[index];
    return {
      index,
      visual: scene.visual,
      line: scene.line,
      durationS: scene.durationMs / 1000,
      model: take?.model || before?.model || "",
      frameUrl: take?.frameUrl || before?.frameUrl || "",
    };
  });
  const captions = [...state.captions]
    .sort((a, b) => a.startMs - b.startMs || a.position - b.position)
    .map((cue) => ({ text: cue.text, startS: cue.startMs / 1000, endS: cue.endMs / 1000 }));
  const hook = state.hooks.find((item) => item.isSelected)?.text ?? previous.hook;
  const totalMs = ordered.reduce((sum, scene) => sum + scene.durationMs, 0);
  return { ...previous, hook, scenes, captions, totalDurationS: totalMs / 1000 };
}

/** The caption text shown over a scene in the preview: every cue that starts inside the scene's window. */
export function sceneCaptionText(manifest: Pick<StitchedManifest, "captions" | "scenes">, index: number): string {
  const windows = sceneWindows(manifest.scenes.map((scene) => Math.round(scene.durationS * 1000)));
  const window = windows[index];
  if (!window) return "";
  const text = manifest.captions
    .filter((cue) => {
      const start = Math.round(cue.startS * 1000);
      return start >= window.startMs && start < window.endMs;
    })
    .map((cue) => cue.text)
    .join(" ");
  return text || manifest.scenes[index]?.line || "";
}
