import { TIERS, type ImageModel, type ModelConfig, type ScriptModel, type ModelKind, type ModelOfKind, type Tier, type VideoModel } from "./types";
import * as vendors from "./vendors";

export * from "./types";

/**
 * Every priced model. Pure data, safe to import from client components.
 * Add a model by appending an entry to its vendor file; add a vendor with one
 * line in `vendors.ts`.
 */
export const MODELS: readonly ModelConfig[] = Object.values(vendors).flat();

export type Catalog = ReturnType<typeof createCatalog>;

export function createCatalog(models: readonly ModelConfig[]) {
  const byId = new Map(models.map((model) => [model.id, model]));

  function find(id: string): ModelConfig | undefined {
    return byId.get(id);
  }

  function modelsOf<K extends ModelKind>(kind: K): ModelOfKind<K>[] {
    return models.filter((model): model is ModelOfKind<K> => model.kind === kind);
  }

  function isVideo(id: string | undefined | null): id is string {
    return Boolean(id) && find(id as string)?.kind === "video";
  }

  function video(id: string): VideoModel {
    const model = find(id);
    if (model?.kind !== "video") throw new Error(`Unknown video model: ${id}`);
    return model;
  }

  function image(id: string): ImageModel {
    const model = find(id);
    if (model?.kind !== "image") throw new Error(`Unknown image model: ${id}`);
    return model;
  }

  function fallbackChain(tier: Tier): string[] {
    return modelsOf("video")
      .filter((model) => model.chains?.[tier] != null)
      .sort((a, b) => (a.chains?.[tier] ?? 0) - (b.chains?.[tier] ?? 0) || a.id.localeCompare(b.id))
      .map((model) => model.id);
  }

  function tierDefault(tier: Tier): string {
    const first = fallbackChain(tier)[0];
    if (!first) throw new Error(`No video model in the ${tier} chain`);
    return first;
  }

  function forTier<K extends "script" | "image">(kind: K, tier: Tier): ModelOfKind<K> {
    const found = modelsOf(kind).find((model) => (model as ScriptModel | ImageModel).tier === tier);
    if (!found) throw new Error(`No ${kind} model for the ${tier} tier`);
    return found;
  }

  function voice(id: string) {
    const model = find(id);
    if (model?.kind !== "voice") throw new Error(`Unknown voice model: ${id}`);
    return model;
  }

  function voiceOver() {
    const found = modelsOf("voice").find((model) => model.voiceOverDefault);
    if (!found) throw new Error("No default voice-over model");
    return found;
  }

  return {
    models,
    find,
    modelsOf,
    isVideo,
    video,
    image,
    fallbackChain,
    tierDefault,
    scriptModel: (tier: Tier) => forTier("script", tier),
    frameModel: (tier: Tier) => forTier("image", tier),
    voice,
    voiceOver,
  };
}

/** Configuration mistakes a new entry could introduce. Empty means the catalog is usable. */
export function catalogProblems(models: readonly ModelConfig[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (seen.has(model.id)) problems.push(`duplicate id ${model.id}`);
    seen.add(model.id);
    if (!model.source.trim()) problems.push(`${model.id} has no pricing source`);
  }
  const catalog = createCatalog(models);
  for (const tier of TIERS) {
    const chain = catalog.modelsOf("video").filter((model) => model.chains?.[tier] != null);
    if (chain.length === 0) problems.push(`${tier} chain is empty`);
    const positions = chain.map((model) => model.chains?.[tier]);
    if (new Set(positions).size !== positions.length) problems.push(`${tier} chain has duplicate positions`);
    for (const kind of ["script", "image"] as const) {
      const count = catalog.modelsOf(kind).filter((model) => model.tier === tier).length;
      if (count !== 1) problems.push(`${tier} tier needs exactly one ${kind} model, found ${count}`);
    }
  }
  const defaults = catalog.modelsOf("voice").filter((model) => model.voiceOverDefault).length;
  if (defaults !== 1) problems.push(`need exactly one voice-over default, found ${defaults}`);
  for (const model of catalog.modelsOf("video")) {
    if (model.avatar && catalog.find(model.avatar.voiceModel)?.kind !== "voice") {
      problems.push(`${model.id} avatar voice ${model.avatar.voiceModel} is not a voice model`);
    }
  }
  return problems;
}

export const catalog = createCatalog(MODELS);
