import { pollUntil } from "@/lib/providers/live";
import { TIKTOK_UNAUDITED_USER_CAP } from "../config";
import { assertBrandedNotPrivate, effectiveTikTokPrivacy, PublishRuleError, tiktokCapAllows, type ApprovalRecord, type TikTokPrivacy } from "../rules";
import type { PostCounts, PublishContext, PublishOutcome, Publisher } from "../types";
import { platformJson } from "./http";

/** TikTok Content Posting API (Direct Post + upload to inbox/drafts) and Display API. */
const API = "https://open.tiktokapis.com/v2";
export const TIKTOK_ENDPOINTS = {
  token: `${API}/oauth/token/`,
  userInfo: `${API}/user/info/?fields=open_id,display_name`,
  creatorInfo: `${API}/post/publish/creator_info/query/`,
  directInit: `${API}/post/publish/video/init/`,
  inboxInit: `${API}/post/publish/inbox/video/init/`,
  status: `${API}/post/publish/status/fetch/`,
  videoQuery: `${API}/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
};

export type CreatorInfo = {
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

export function buildTikTokDirectPostBody(input: {
  caption: string;
  privacy: TikTokPrivacy;
  approval: ApprovalRecord;
  aiGenerated: boolean;
  videoUrl: string;
  creator?: CreatorInfo;
}) {
  const branded = input.approval.commercialDisclosure === true && input.approval.commercialType === "branded_content";
  const ownBrand = input.approval.commercialDisclosure === true && input.approval.commercialType === "your_brand";
  assertBrandedNotPrivate(input.approval, input.privacy);
  return {
    post_info: {
      title: input.caption,
      privacy_level: input.privacy,
      disable_comment: input.approval.allowComments !== true || input.creator?.comment_disabled === true,
      disable_duet: input.approval.allowDuet !== true || input.creator?.duet_disabled === true,
      disable_stitch: input.approval.allowStitch !== true || input.creator?.stitch_disabled === true,
      brand_content_toggle: branded,
      brand_organic_toggle: ownBrand,
      is_aigc: input.aiGenerated,
    },
    source_info: { source: "PULL_FROM_URL", video_url: input.videoUrl },
  };
}

export function buildTikTokDraftBody(videoUrl: string) {
  return { source_info: { source: "PULL_FROM_URL", video_url: videoUrl } };
}

type StatusResponse = { data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } };

export function tiktokStatusResult(response: StatusResponse, mode: string): { postId: string | null } | null {
  const status = response.data?.status ?? "";
  if (status === "FAILED") throw new PublishRuleError(`TikTok failed the post: ${response.data?.fail_reason ?? "unknown reason"}`);
  if (status === "PUBLISH_COMPLETE") return { postId: response.data?.publicaly_available_post_id?.[0]?.toString() ?? null };
  if (mode === "draft" && status === "SEND_TO_USER_INBOX") return { postId: null };
  return null;
}

export const tiktokPublisher: Publisher = {
  async publish(ctx: PublishContext): Promise<PublishOutcome> {
    if (!ctx.video.mediaUrl) throw new PublishRuleError("No rendered MP4 at a public https URL. Live posting needs a live render and PUBLIC_BASE_URL.");
    const auth = { authorization: `Bearer ${ctx.account.accessToken}` };
    let mode = ctx.mode;
    if (
      mode === "direct" &&
      !tiktokCapAllows({ accountId: ctx.account.id, recentAccountIds: ctx.recentTikTokAccountIds, audited: ctx.audited, cap: TIKTOK_UNAUDITED_USER_CAP })
    ) {
      mode = "draft";
      await ctx.log("fallback_to_draft", { reason: "unaudited client: 5 creators per 24 h already posted" });
    }
    let privacy = "";
    let init: { data?: { publish_id?: string } };
    if (mode === "direct") {
      const creator = ((await platformJson(TIKTOK_ENDPOINTS.creatorInfo, { headers: auth, json: {} })) as { data?: CreatorInfo }).data ?? {};
      await ctx.log("creator_info", { options: creator.privacy_level_options ?? [], nickname: creator.creator_nickname ?? "" });
      if (creator.max_video_post_duration_sec && ctx.video.durationS > creator.max_video_post_duration_sec) {
        throw new PublishRuleError(`This account allows videos up to ${creator.max_video_post_duration_sec}s.`);
      }
      const effective = effectiveTikTokPrivacy({
        approvalPrivacy: String(ctx.video.approval.privacy ?? ""),
        audited: ctx.audited,
        allowedOptions: creator.privacy_level_options,
      });
      privacy = effective.privacy;
      if (effective.forcedPrivate) await ctx.log("forced_private", { reason: "TikTok audit pending: SELF_ONLY" });
      const body = buildTikTokDirectPostBody({
        caption: ctx.video.caption,
        privacy: effective.privacy,
        approval: ctx.video.approval,
        aiGenerated: ctx.video.aiGenerated,
        videoUrl: ctx.video.mediaUrl,
        creator,
      });
      init = (await platformJson(TIKTOK_ENDPOINTS.directInit, { headers: auth, json: body })) as typeof init;
    } else {
      init = (await platformJson(TIKTOK_ENDPOINTS.inboxInit, { headers: auth, json: buildTikTokDraftBody(ctx.video.mediaUrl) })) as typeof init;
    }
    const publishId = init.data?.publish_id;
    if (!publishId) throw new PublishRuleError("TikTok did not return a publish_id");
    await ctx.log("submitted", { publishId, mode });
    const done = await pollUntil(
      "tiktok",
      async () => {
        const status = (await platformJson(TIKTOK_ENDPOINTS.status, { headers: auth, json: { publish_id: publishId } })) as StatusResponse;
        await ctx.log("status", { status: status.data?.status ?? "" });
        return tiktokStatusResult(status, mode);
      },
      ctx.poll ?? { intervalMs: 3_000, maxIntervalMs: 15_000, timeoutMs: 5 * 60_000 },
    );
    return { externalId: done.postId ?? publishId, mode, privacy: mode === "draft" ? "DRAFT" : privacy };
  },

  async metrics({ accessToken, externalIds }) {
    if (externalIds.length === 0) return {};
    const response = (await platformJson(TIKTOK_ENDPOINTS.videoQuery, {
      headers: { authorization: `Bearer ${accessToken}` },
      json: { filters: { video_ids: externalIds.slice(0, 20) } },
    })) as { data?: { videos?: { id?: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] } };
    const out: Record<string, PostCounts> = {};
    for (const video of response.data?.videos ?? []) {
      if (!video.id) continue;
      out[video.id] = {
        views: video.view_count ?? 0,
        likes: video.like_count ?? 0,
        comments: video.comment_count ?? 0,
        shares: video.share_count ?? 0,
        saves: 0,
        reach: 0,
      };
    }
    return out;
  },
};

export async function exchangeTikTokCode(input: { code: string; verifier: string; redirectUri: string }) {
  const token = (await platformJson(TIKTOK_ENDPOINTS.token, {
    form: {
      client_key: process.env.TIKTOK_CLIENT_KEY?.trim() ?? "",
      client_secret: process.env.TIKTOK_CLIENT_SECRET?.trim() ?? "",
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
  })) as { access_token?: string; refresh_token?: string; open_id?: string; scope?: string; expires_in?: number };
  if (!token.access_token || !token.open_id) throw new PublishRuleError("TikTok did not return a token");
  const user = (await platformJson(TIKTOK_ENDPOINTS.userInfo, { headers: { authorization: `Bearer ${token.access_token}` } })) as {
    data?: { user?: { display_name?: string } };
  };
  return {
    externalId: token.open_id,
    handle: user.data?.user?.display_name ?? token.open_id,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scopes: token.scope ?? "",
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
  };
}
