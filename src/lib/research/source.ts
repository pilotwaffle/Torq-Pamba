import { isLive } from "@/lib/providers/live";
import { registry } from "@/lib/providers/registry";
import { PLATFORM_LABEL, ResearchError, type ResearchSource, type SocialPlatform } from "./types";

/**
 * Sources named in RESEARCH_SOURCE (comma-separated, in order of preference),
 * keeping only those that can run: live sources need PROVIDER_MODE=live and
 * their key. With nothing live, research uses the mock source.
 */
export function liveResearchSources(env: string | undefined = process.env.RESEARCH_SOURCE): ResearchSource[] {
  const ids = (env ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id && id !== "mock");
  const sources: ResearchSource[] = [];
  for (const id of new Set(ids)) {
    const source = registry.list("research-source").find((item) => item.id === id);
    if (source && isLive([...source.envKeys])) sources.push(source);
  }
  return sources;
}

/** The source for a platform, or for any platform when `platform` is unset. */
export function researchSource(platform?: SocialPlatform | null): ResearchSource {
  const live = liveResearchSources();
  if (live.length === 0) return registry.get("research-source", "mock");
  const found = platform ? live.find((source) => source.platforms.includes(platform)) : live[0];
  if (!found) {
    throw new ResearchError(
      `No configured research source covers ${platform ? PLATFORM_LABEL[platform] : "that platform"}. Add one to RESEARCH_SOURCE`,
    );
  }
  return found;
}
