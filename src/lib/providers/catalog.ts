import { catalog, type VideoModel } from "@/lib/models";
import { isLive } from "./live";
import { isMockJob, mockPollClip, mockSubmitClip } from "./mock";
import type { ClipPoll, ClipRequest, ClipSubmission, VideoProvider } from "./types";

export type LiveClipApi = {
  submit: (req: ClipRequest, model: VideoModel) => Promise<ClipSubmission>;
  poll: (providerJobId: string, req: ClipRequest, model: VideoModel) => Promise<ClipPoll>;
};

/**
 * A video provider whose label, tier, price and duration cap come from the
 * model's catalog entry. Mock jobs unless PROVIDER_MODE=live and every
 * `envKeys` entry is set (or `liveWhen` says so). A job submitted to the mock
 * is always polled by the mock, even if the mode changes in between.
 */
export function catalogVideoProvider(
  id: string,
  options: { envKeys: string[]; liveWhen?: () => boolean; live: LiveClipApi },
): VideoProvider {
  const model = catalog.video(id);
  const live = () => (options.liveWhen ? options.liveWhen() : isLive(options.envKeys));
  return {
    id,
    vendor: model.vendor,
    label: model.label,
    tier: model.tier,
    pricePerSecondUsd: model.usdPerSecond,
    maxDurationS: model.maxDurationS,
    async submitClip(req) {
      if (live()) return options.live.submit(req, model);
      return mockSubmitClip(id, req);
    },
    async pollClip(providerJobId, req) {
      if (isMockJob(providerJobId)) return mockPollClip(id, req);
      return options.live.poll(providerJobId, req, model);
    },
  };
}
