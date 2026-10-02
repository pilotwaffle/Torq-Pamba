import { pollUntil } from "@/lib/providers/live";
import { graphVersion } from "../config";
import { PublishRuleError } from "../rules";
import type { PostCounts, PublishContext, PublishOutcome, Publisher } from "../types";
import { platformJson } from "./http";

/** Instagram API with Instagram Login: Reels and Trial Reels via container → media_publish. */
const graph = () => `https://graph.instagram.com/${graphVersion()}`;

export function buildReelContainer(input: { videoUrl: string; caption: string; trial: boolean; aiGenerated: boolean }) {
  return {
    media_type: "REELS",
    video_url: input.videoUrl,
    caption: input.caption,
    share_to_feed: !input.trial,
    ...(input.trial ? { trial_params: { graduation_strategy: "SS_PERFORMANCE" } } : {}),
    // AI disclosure on by default. Field name per Meta's content-publishing page; verify before go-live.
    ...(input.aiGenerated ? { is_ai_generated: true } : {}),
  };
}

export function containerStatusResult(response: { status_code?: string; status?: string }): true | null {
  const code = response.status_code ?? "";
  if (code === "FINISHED") return true;
  if (code === "ERROR" || code === "EXPIRED") {
    throw new PublishRuleError(`Instagram could not process the video (${code}${response.status ? `: ${response.status}` : ""})`);
  }
  return null;
}

export function quotaAllows(response: { data?: { quota_usage?: number; config?: { quota_total?: number } }[] }): boolean {
  const entry = response.data?.[0];
  if (!entry?.config?.quota_total) return true;
  return (entry.quota_usage ?? 0) < entry.config.quota_total;
}

export const instagramPublisher: Publisher = {
  async publish(ctx: PublishContext): Promise<PublishOutcome> {
    if (!ctx.video.mediaUrl) throw new PublishRuleError("No rendered MP4 at a public https URL. Live posting needs a live render and PUBLIC_BASE_URL.");
    const token = ctx.account.accessToken;
    const user = ctx.account.externalId;
    const quota = (await platformJson(
      `${graph()}/${user}/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(token)}`,
    )) as Parameters<typeof quotaAllows>[0];
    await ctx.log("quota", { usage: quota.data?.[0]?.quota_usage ?? null, total: quota.data?.[0]?.config?.quota_total ?? null });
    if (!quotaAllows(quota)) throw new PublishRuleError("Instagram's 24-hour publishing limit for this account is used up.");
    const container = (await platformJson(`${graph()}/${user}/media`, {
      json: {
        ...buildReelContainer({ videoUrl: ctx.video.mediaUrl, caption: ctx.video.caption, trial: ctx.mode === "trial_reel", aiGenerated: ctx.video.aiGenerated }),
        access_token: token,
      },
    })) as { id?: string };
    if (!container.id) throw new PublishRuleError("Instagram did not return a container id");
    await ctx.log("container_created", { containerId: container.id });
    await pollUntil(
      "instagram",
      async () =>
        containerStatusResult(
          (await platformJson(`${graph()}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`)) as {
            status_code?: string;
          },
        ),
      ctx.poll ?? { intervalMs: 5_000, maxIntervalMs: 20_000, timeoutMs: 5 * 60_000 },
    );
    const published = (await platformJson(`${graph()}/${user}/media_publish`, {
      json: { creation_id: container.id, access_token: token },
    })) as { id?: string };
    if (!published.id) throw new PublishRuleError("Instagram did not return a media id");
    return { externalId: published.id, mode: ctx.mode, privacy: ctx.mode === "trial_reel" ? "TRIAL_NON_FOLLOWERS" : "PUBLIC" };
  },

  async metrics({ accessToken, externalIds }) {
    const out: Record<string, PostCounts> = {};
    for (const id of externalIds) {
      const response = (await platformJson(
        `${graph()}/${id}/insights?metric=views,reach,likes,comments,shares,saved&access_token=${encodeURIComponent(accessToken)}`,
      )) as { data?: { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[] };
      const value = (name: string) => {
        const metric = response.data?.find((entry) => entry.name === name);
        return metric?.total_value?.value ?? metric?.values?.[0]?.value ?? 0;
      };
      out[id] = { views: value("views"), reach: value("reach"), likes: value("likes"), comments: value("comments"), shares: value("shares"), saves: value("saved") };
    }
    return out;
  },
};

export async function exchangeInstagramCode(input: { code: string; redirectUri: string }) {
  const short = (await platformJson("https://api.instagram.com/oauth/access_token", {
    form: {
      client_id: process.env.INSTAGRAM_APP_ID?.trim() ?? "",
      client_secret: process.env.INSTAGRAM_APP_SECRET?.trim() ?? "",
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: input.code,
    },
  })) as { access_token?: string; user_id?: string | number };
  if (!short.access_token) throw new PublishRuleError("Instagram did not return a token");
  const long = (await platformJson(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env.INSTAGRAM_APP_SECRET?.trim() ?? "")}&access_token=${encodeURIComponent(short.access_token)}`,
  )) as { access_token?: string; expires_in?: number };
  const accessToken = long.access_token ?? short.access_token;
  const me = (await platformJson(`${graph()}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`)) as {
    user_id?: string | number;
    username?: string;
  };
  const externalId = String(me.user_id ?? short.user_id ?? "");
  return {
    externalId,
    handle: me.username ? `@${me.username}` : externalId,
    accessToken,
    refreshToken: null,
    scopes: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}
