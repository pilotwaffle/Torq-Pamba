import { createHash } from "node:crypto";
import { TIKTOK_UNAUDITED_USER_CAP } from "./config";
import { assertBrandedNotPrivate, effectiveTikTokPrivacy, PublishRuleError, tiktokCapAllows } from "./rules";
import type { PostCounts, PublishContext, PublishOutcome, Publisher } from "./types";

/**
 * Mock publisher: applies every platform rule the live publishers apply
 * (consent, privacy narrowing, the unaudited TikTok cap, branded-content rules)
 * but never makes a network call. A title containing "[publish-fail]" fails.
 */

function digest(value: string): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0);
}

export function mockPublisher(platform: "tiktok" | "instagram" | "facebook"): Publisher {
  return {
    async publish(ctx: PublishContext): Promise<PublishOutcome> {
      if (/\[publish-fail\]/i.test(ctx.video.title)) throw new PublishRuleError("Mock platform rejected the upload ([publish-fail])");
      if (platform === "tiktok") {
        let mode = ctx.mode;
        if (
          mode === "direct" &&
          !tiktokCapAllows({ accountId: ctx.account.id, recentAccountIds: ctx.recentTikTokAccountIds, audited: ctx.audited, cap: TIKTOK_UNAUDITED_USER_CAP })
        ) {
          mode = "draft";
          await ctx.log("fallback_to_draft", { reason: "unaudited client: 5 creators per 24 h already posted" });
        }
        if (mode === "draft") {
          await ctx.log("submitted", { mode, mock: true });
          return { externalId: `mock_tiktok_${digest(ctx.jobId).toString(36)}`, mode, privacy: "DRAFT" };
        }
        const effective = effectiveTikTokPrivacy({ approvalPrivacy: String(ctx.video.approval.privacy ?? ""), audited: ctx.audited });
        assertBrandedNotPrivate(ctx.video.approval, effective.privacy);
        if (effective.forcedPrivate) await ctx.log("forced_private", { reason: "TikTok audit pending: SELF_ONLY" });
        await ctx.log("submitted", { mode, mock: true, privacy: effective.privacy, is_aigc: ctx.video.aiGenerated });
        return { externalId: `mock_tiktok_${digest(ctx.jobId).toString(36)}`, mode, privacy: effective.privacy };
      }
      await ctx.log("submitted", { mode: ctx.mode, mock: true, is_ai_generated: ctx.video.aiGenerated });
      const privacy = platform === "instagram" && ctx.mode === "trial_reel" ? "TRIAL_NON_FOLLOWERS" : "PUBLIC";
      return { externalId: `mock_${platform}_${digest(ctx.jobId).toString(36)}`, mode: ctx.mode, privacy };
    },

    async metrics({ externalIds }) {
      const out: Record<string, PostCounts> = {};
      for (const id of externalIds) {
        const seed = digest(id);
        const views = 400 + (seed % 9_600);
        out[id] = {
          views,
          likes: Math.round(views * (0.04 + (seed % 7) / 100)),
          comments: Math.round(views * 0.006),
          shares: Math.round(views * 0.01),
          saves: platform === "tiktok" ? 0 : Math.round(views * 0.012),
          reach: platform === "tiktok" ? 0 : Math.round(views * 0.8),
        };
      }
      return out;
    },
  };
}
