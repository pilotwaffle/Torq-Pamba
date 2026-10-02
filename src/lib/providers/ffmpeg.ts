import { stitchClips, type Caption, type StitchResult, type StitchSource } from "@/lib/media/stitch";
import { defineAdapter } from "./types";

export type RenderRequest = {
  clips: StitchSource[];
  captions: Caption[];
  hook?: string;
  /** Mock renders use a lower frame rate and the fastest preset so tests stay quick. */
  draft?: boolean;
};

/** Turns scene clips, captions and audio into one final mp4. */
export interface RenderProvider {
  id: string;
  label: string;
  render(req: RenderRequest): Promise<StitchResult>;
}

declare module "@/lib/providers/types" {
  interface ProviderKinds {
    render: RenderProvider;
  }
}

/** Local ffmpeg (`FFMPEG_PATH`). Runs in the job worker, never in the browser. */
export const ffmpegRender: RenderProvider = {
  id: "ffmpeg",
  label: "ffmpeg",
  render(req) {
    return stitchClips({
      clips: req.clips,
      captions: req.captions,
      hook: req.hook,
      fps: req.draft ? 12 : 30,
      preset: req.draft ? "ultrafast" : "veryfast",
    });
  },
};

export const adapter = defineAdapter({ id: "ffmpeg", render: [ffmpegRender] });
