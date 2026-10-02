import type { BrandBrief } from "@/db/schema";
import { buildHooks, cleanTopic, limit, normalizePhrase, toTitleCase, ugcScenes } from "@/lib/agent/copy";
import { estimateClipCost, type ClipCost, type Tier } from "@/lib/pricing";

export type SceneDraft = {
  visual: string;
  line: string;
  durationS: number;
};

export type VideoPlan = {
  topic: string;
  title: string;
  count: number;
  durationS: number;
  tier: Tier;
  sourcePrompt: string;
  avatarId: string | null;
  avatarName: string | null;
  scenes: SceneDraft[];
  hooks: [string, string, string];
  captions: string;
};

export function sceneDurations(totalSeconds: number, parts = 3): number[] {
  const total = Math.max(parts, Math.round(totalSeconds));
  const base = Math.floor(total / parts);
  const durations = Array.from({ length: parts }, () => base);
  durations[parts - 1] = total - base * (parts - 1);
  return durations;
}

export function buildPlan(input: {
  topic: string;
  count: number;
  durationS: number;
  sourcePrompt: string;
  brief?: BrandBrief | null;
  avatar?: { id: string; name: string; look: string } | null;
  tier?: Tier;
  /** Winning hooks from Knowledge. The best one leads the hook choices. */
  provenHooks?: string[];
}): VideoPlan {
  const tier = input.tier ?? "standard";
  const durations = sceneDurations(input.durationS);
  const topic = cleanTopic(input.topic);
  const company = normalizePhrase(input.brief?.companyName ?? "") || "This brand";
  const audience = normalizePhrase(input.brief?.audience ?? "") || "People with a full day";
  const product = normalizePhrase(input.brief?.products?.find((item) => item.trim()) ?? "") || topic || "This";
  const avatarName = input.avatar?.name?.trim() || "The host";
  const spoken = ugcScenes({ avatarName, product, company });
  const scenes = spoken.lines.map((line, index) => ({
    visual: spoken.visuals[index] ?? topic,
    line,
    durationS: durations[index] ?? 1,
  }));
  const hooks = withProvenHook(buildHooks({ product, audience, company }), input.provenHooks ?? []);
  const title = toTitleCase(topic).slice(0, 80) || "Untitled";
  return {
    topic,
    title,
    count: input.count,
    durationS: scenes.reduce((sum, scene) => sum + scene.durationS, 0),
    tier,
    sourcePrompt: input.sourcePrompt,
    avatarId: input.avatar?.id ?? null,
    avatarName: input.avatar?.name ?? null,
    scenes,
    hooks,
    captions: spoken.lines.join("\n"),
  };
}

/** Puts the top proven hook first and keeps three distinct hooks of at most 60 characters. */
export function withProvenHook(defaults: [string, string, string], proven: string[]): [string, string, string] {
  const lead = proven.map((hook) => limit(hook)).find((hook) => hook.length > 0);
  if (!lead) return defaults;
  const rest = defaults.filter((hook) => hook.toLowerCase() !== lead.toLowerCase());
  return [lead, rest[0] ?? defaults[1], rest[1] ?? defaults[2]];
}

export function planCost(plan: Pick<VideoPlan, "tier" | "durationS">, tier: Tier = plan.tier): ClipCost {
  return estimateClipCost({ tier, durationS: plan.durationS });
}

export function isVideoPlan(value: unknown): value is VideoPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<VideoPlan>;
  return (
    (plan.tier === "budget" || plan.tier === "standard" || plan.tier === "premium") &&
    typeof plan.durationS === "number" &&
    typeof plan.sourcePrompt === "string" &&
    Array.isArray(plan.scenes) &&
    plan.scenes.length === 3 &&
    Array.isArray(plan.hooks) &&
    plan.hooks.length === 3
  );
}

export function isPlanMessage(data: unknown): data is { kind: "plan"; plan: VideoPlan } {
  if (!data || typeof data !== "object") return false;
  const record = data as { kind?: unknown; plan?: unknown };
  return record.kind === "plan" && isVideoPlan(record.plan);
}

export function isReadyMessage(
  data: unknown,
): data is { kind: "ready"; videoId: string; attemptSummary: string | null } {
  if (!data || typeof data !== "object") return false;
  const record = data as { kind?: unknown; videoId?: unknown; attemptSummary?: unknown };
  return (
    record.kind === "ready" &&
    typeof record.videoId === "string" &&
    (record.attemptSummary === null || typeof record.attemptSummary === "string")
  );
}
