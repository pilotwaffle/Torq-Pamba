import { catalog, type VideoModel } from "@/lib/models";
import { isLive } from "./live";
import { mockGenerateClip } from "./mock";
import type { ClipRequest, ClipResult, VideoProvider } from "./types";

/**
 * A video provider whose label, tier, price and duration cap come from the
 * model's catalog entry. Mock clips unless PROVIDER_MODE=live and every
 * `envKeys` entry is set.
 */
export function catalogVideoProvider(
  id: string,
  options: { envKeys: string[]; live: (req: ClipRequest, model: VideoModel) => Promise<ClipResult> },
): VideoProvider {
  const model = catalog.video(id);
  return {
    id,
    vendor: model.vendor,
    label: model.label,
    tier: model.tier,
    pricePerSecondUsd: model.usdPerSecond,
    maxDurationS: model.maxDurationS,
    async generateClip(req) {
      if (isLive(options.envKeys)) return options.live(req, model);
      return mockGenerateClip(id, model.usdPerSecond, req);
    },
  };
}
