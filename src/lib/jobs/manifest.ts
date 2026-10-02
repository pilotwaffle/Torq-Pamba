import { estimateClipCost, videoUsdPerSecond, type Tier } from "@/lib/pricing";

export type AttemptStatus = "ok" | "refused" | "error";

export type AttemptRecord = {
  sceneIndex: number;
  step: number;
  provider: string;
  status: AttemptStatus;
  detail?: Record<string, unknown>;
};

export type GeneratedScene = {
  index: number;
  visual: string;
  line: string;
  durationS: number;
  model: string;
  frameUrl: string;
};

export type StitchedManifest = {
  aiGenerated: boolean;
  hook: string;
  totalDurationS: number;
  scenes: GeneratedScene[];
  captions: { text: string; startS: number; endS: number }[];
};

export function parseManifest(value: unknown): StitchedManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StitchedManifest>;
  if (typeof record.hook !== "string" || typeof record.totalDurationS !== "number") return null;
  if (!Array.isArray(record.scenes) || !Array.isArray(record.captions)) return null;
  return {
    aiGenerated: record.aiGenerated !== false,
    hook: record.hook,
    totalDurationS: record.totalDurationS,
    scenes: record.scenes as GeneratedScene[],
    captions: record.captions as StitchedManifest["captions"],
  };
}

/** The ordered scene list, caption timings and hook that the render follows. */
export function stitch(input: { hook: string; scenes: Omit<GeneratedScene, "index">[] }): StitchedManifest {
  let cursor = 0;
  const scenes = input.scenes.map((scene, index) => ({ ...scene, index }));
  const captions = scenes.map((scene) => {
    const startS = cursor;
    cursor += scene.durationS;
    return { text: scene.line, startS, endS: roundDuration(cursor) };
  });
  return {
    aiGenerated: true,
    hook: input.hook,
    totalDurationS: roundDuration(cursor),
    scenes,
    captions,
  };
}

function roundDuration(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function formatAttempts(attempts: AttemptRecord[]): string | null {
  if (!attempts.some((attempt) => attempt.status !== "ok")) return null;
  const byScene = new Map<number, AttemptRecord[]>();
  for (const attempt of attempts) {
    const list = byScene.get(attempt.sceneIndex) ?? [];
    list.push(attempt);
    byScene.set(attempt.sceneIndex, list);
  }
  const lines = [...byScene.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) =>
      list
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((attempt) => `${attempt.provider} ${attempt.status}`)
        .join(" → "),
    );
  return [...new Set(lines)].join("; ");
}

export function chargeForScenes(
  tier: Tier,
  scenes: { durationS: number; model: string }[],
  voiceOver = false,
): number {
  const durationS = scenes.reduce((sum, scene) => sum + scene.durationS, 0);
  const models = new Set(scenes.map((scene) => scene.model));
  if (models.size <= 1) {
    return estimateClipCost({ tier, durationS, model: scenes[0]?.model, voiceOver }).total;
  }
  const fixed = estimateClipCost({ tier, durationS, voiceOver });
  const videoCents = scenes.reduce(
    (sum, scene) => sum + Math.round(videoUsdPerSecond(scene.model) * scene.durationS * 100),
    0,
  );
  return (Math.round(fixed.script * 100) + Math.round(fixed.frames * 100) + Math.round(fixed.voice * 100) + videoCents) / 100;
}

export function splitCents(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const raw = weights.map((weight) => (totalCents * weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value));
  let leftover = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - (floors[index] ?? 0) }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of order) {
    if (leftover <= 0) break;
    floors[item.index] = (floors[item.index] ?? 0) + 1;
    leftover -= 1;
  }
  return floors;
}
