import { pollUntil } from "@/lib/providers/live";
import { graphVersion } from "../config";
import { PublishRuleError } from "../rules";
import type { PostCounts, PublishContext, PublishOutcome, Publisher } from "../types";
import { platformJson } from "./http";

/** Facebook Page Reels: /{page_id}/video_reels start → hosted upload → finish. */
const graph = () => `https://graph.facebook.com/${graphVersion()}`;

export function reelsStartBody(token: string) {
  return { upload_phase: "start", access_token: token };
}

export function reelsFinishBody(input: { token: string; videoId: string; description: string }) {
  return {
    upload_phase: "finish",
    video_id: input.videoId,
    video_state: "PUBLISHED",
    description: input.description,
    access_token: input.token,
  };
}

export function reelStatusResult(response: {
  status?: { video_status?: string; processing_phase?: { status?: string }; publishing_phase?: { status?: string } };
}): true | null {
  const status = response.status;
  if (status?.video_status === "error" || status?.processing_phase?.status === "error") {
    throw new PublishRuleError("Facebook could not process the reel");
  }
  if (status?.publishing_phase?.status === "complete" || status?.video_status === "published") return true;
  return null;
}

export const facebookPublisher: Publisher = {
  async publish(ctx: PublishContext): Promise<PublishOutcome> {
    if (!ctx.video.mediaUrl) throw new PublishRuleError("No rendered MP4 at a public https URL. Live posting needs a live render and PUBLIC_BASE_URL.");
    const token = ctx.account.accessToken;
    const page = ctx.account.externalId;
    const start = (await platformJson(`${graph()}/${page}/video_reels`, { json: reelsStartBody(token) })) as {
      video_id?: string;
      upload_url?: string;
    };
    if (!start.video_id) throw new PublishRuleError("Facebook did not return a video id");
    await ctx.log("upload_started", { videoId: start.video_id });
    await platformJson(start.upload_url ?? `https://rupload.facebook.com/video-upload/${graphVersion()}/${start.video_id}`, {
      method: "POST",
      headers: { authorization: `OAuth ${token}`, file_url: ctx.video.mediaUrl },
    });
    await platformJson(`${graph()}/${page}/video_reels`, {
      json: reelsFinishBody({ token, videoId: start.video_id, description: ctx.video.caption }),
    });
    await pollUntil(
      "facebook",
      async () =>
        reelStatusResult(
          (await platformJson(`${graph()}/${start.video_id}?fields=status&access_token=${encodeURIComponent(token)}`)) as Parameters<
            typeof reelStatusResult
          >[0],
        ),
      ctx.poll ?? { intervalMs: 5_000, maxIntervalMs: 20_000, timeoutMs: 5 * 60_000 },
    );
    return { externalId: start.video_id, mode: "reel", privacy: "PUBLIC" };
  },

  async metrics({ accessToken, externalIds }) {
    const out: Record<string, PostCounts> = {};
    for (const id of externalIds) {
      const response = (await platformJson(
        `${graph()}/${id}/video_insights?metric=blue_reels_play_count,post_impressions_unique&access_token=${encodeURIComponent(accessToken)}`,
      )) as { data?: { name?: string; values?: { value?: number }[] }[] };
      const value = (name: string) => response.data?.find((entry) => entry.name === name)?.values?.[0]?.value ?? 0;
      out[id] = { views: value("blue_reels_play_count"), reach: value("post_impressions_unique"), likes: 0, comments: 0, shares: 0, saves: 0 };
    }
    return out;
  },
};

export async function exchangeFacebookCode(input: { code: string; redirectUri: string }) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID?.trim() ?? "",
    client_secret: process.env.META_APP_SECRET?.trim() ?? "",
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const user = (await platformJson(`${graph()}/oauth/access_token?${params.toString()}`)) as { access_token?: string };
  if (!user.access_token) throw new PublishRuleError("Facebook did not return a token");
  const pages = (await platformJson(`${graph()}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(user.access_token)}`)) as {
    data?: { id?: string; name?: string; access_token?: string }[];
  };
  const page = pages.data?.find((entry) => entry.id && entry.access_token);
  if (!page?.id || !page.access_token) throw new PublishRuleError("No Facebook Page with posting permission was granted.");
  return {
    externalId: page.id,
    handle: page.name ?? page.id,
    accessToken: page.access_token,
    refreshToken: null,
    scopes: "pages_show_list,pages_manage_posts,pages_read_engagement,read_insights",
    expiresAt: null,
  };
}
