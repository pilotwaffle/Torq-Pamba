import type { PollOptions } from "@/lib/providers/live";
import type { Platform } from "./config";
import type { ApprovalRecord } from "./rules";

export type PublishContext = {
  jobId: string;
  platform: Platform;
  mode: string;
  account: { id: string; externalId: string; handle: string; accessToken: string };
  video: {
    id: string;
    title: string;
    durationS: number;
    caption: string;
    /** Always true: every Torq-Pamba video is AI-generated and posts with the platform's AI label. */
    aiGenerated: true;
    approval: ApprovalRecord;
    /** Absolute https URL of the rendered MP4. Required for live publishing. */
    mediaUrl: string | null;
  };
  audited: boolean;
  /** TikTok accounts that direct-posted through this client in the last 24 h. */
  recentTikTokAccountIds: string[];
  log: (status: string, detail?: Record<string, unknown>) => Promise<void>;
  poll?: PollOptions;
};

export type PublishOutcome = {
  externalId: string;
  /** Mode actually used (TikTok may fall back from direct to draft). */
  mode: string;
  /** Privacy actually sent to the platform. */
  privacy: string;
};

export type PostCounts = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  reach: number;
};

export interface Publisher {
  publish(ctx: PublishContext): Promise<PublishOutcome>;
  metrics(input: { accessToken: string; accountExternalId: string; externalIds: string[] }): Promise<Record<string, PostCounts>>;
}
