import * as registered from "./adapters";
import {
  ProviderUnavailableError,
  type ImageProvider,
  type LlmProvider,
  type ProviderAdapter,
  type ProviderKind,
  type ProviderKinds,
  type VideoProvider,
} from "./types";

export type ProviderRegistry = ReturnType<typeof createRegistry>;

/** Builds lookups over adapters. Throws on duplicate adapter ids or duplicate provider ids within a kind. */
export function createRegistry(adapters: readonly ProviderAdapter[]) {
  const adapterIds = new Set<string>();
  const byKind = new Map<ProviderKind, Map<string, ProviderKinds[ProviderKind]>>();
  for (const adapter of adapters) {
    if (adapterIds.has(adapter.id)) throw new Error(`Duplicate provider adapter ${adapter.id}`);
    adapterIds.add(adapter.id);
    for (const [kind, providers] of Object.entries(adapter)) {
      if (kind === "id" || !Array.isArray(providers)) continue;
      const map = byKind.get(kind as ProviderKind) ?? new Map();
      for (const provider of providers as ProviderKinds[ProviderKind][]) {
        if (map.has(provider.id)) throw new Error(`Duplicate ${kind} provider ${provider.id}`);
        map.set(provider.id, provider);
      }
      byKind.set(kind as ProviderKind, map);
    }
  }

  function list<K extends ProviderKind>(kind: K): ProviderKinds[K][] {
    return [...(byKind.get(kind)?.values() ?? [])] as ProviderKinds[K][];
  }

  function get<K extends ProviderKind>(kind: K, id: string): ProviderKinds[K] {
    const found = byKind.get(kind)?.get(id);
    if (!found) throw new ProviderUnavailableError(id, "not registered");
    return found as ProviderKinds[K];
  }

  return { adapters, list, get };
}

export const registry = createRegistry(Object.values(registered));

export const videoProviders: VideoProvider[] = registry.list("video");
export const imageProviders: ImageProvider[] = registry.list("image");
export const llmProviders: LlmProvider[] = registry.list("llm");

export function videoProvider(id: string): VideoProvider {
  return registry.get("video", id);
}
