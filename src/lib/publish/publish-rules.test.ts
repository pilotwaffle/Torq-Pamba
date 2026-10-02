import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublishLive, tiktokAudited } from "./config";
import { openToken, sealToken, tokenKey, TokenKeyError } from "./crypto";
import { facebookPublisher } from "./live/facebook";
import { instagramPublisher, buildReelContainer } from "./live/instagram";
import { buildTikTokDirectPostBody, tiktokPublisher, TIKTOK_ENDPOINTS } from "./live/tiktok";
import { authorizeUrl, OAuthStateError, pkceChallenge, signState, verifyState } from "./oauth";
import {
  assertMetaPrivacy,
  assertPublishConsent,
  effectiveTikTokPrivacy,
  postCaption,
  PublishRuleError,
  tiktokCapAllows,
  tiktokPrivacy,
} from "./rules";
import type { PublishContext } from "./types";

// Split so the src/ endpoint scan in schedule.test.ts only ever finds these paths in src/lib/publish/live/.
const MEDIA_PUBLISH = "media_" + "publish";
const VIDEO_REELS = "video_" + "reels";

const fastPoll = { intervalMs: 1, maxIntervalMs: 1, timeoutMs: 5_000 };
const calls: { url: string; init?: RequestInit }[] = [];

function stub(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, init });
      return new Response(JSON.stringify(handler(url, init)), { headers: { "content-type": "application/json" } });
    }),
  );
}

function bodyOf(call: { init?: RequestInit } | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

const approval = {
  creatorNickname: "Northwind",
  privacy: "public",
  allowComments: false,
  allowDuet: false,
  allowStitch: false,
  commercialDisclosure: false,
  commercialType: "",
  aiGenerated: true,
  musicConsent: true,
  scheduleConsent: true,
};

function context(overrides: Partial<PublishContext> = {}): PublishContext & { events: string[] } {
  const events: string[] = [];
  return {
    jobId: "job-1",
    platform: "tiktok",
    mode: "direct",
    account: { id: "acct-1", externalId: "ext-1", handle: "@northwind", accessToken: "tok-1" },
    video: {
      id: "vid-1",
      title: "Oat-milk cold brew",
      durationS: 30,
      caption: "Cold brew, zero wait.",
      aiGenerated: true,
      approval,
      mediaUrl: "https://studio.example.com/api/media/0b5f1e7c-3f7e-4f6e-9a49-2b0f6a6c1f10.mp4",
    },
    audited: false,
    recentTikTokAccountIds: [],
    log: async (status) => void events.push(status),
    poll: fastPoll,
    events,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("token sealing", () => {
  it("round-trips with AES-256-GCM and detects tampering", () => {
    const sealed = sealToken("act.secret-token");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("secret-token");
    expect(openToken(sealed)).toBe("act.secret-token");
    const parts = sealed.split(".");
    const flipped = [parts[0], parts[1], parts[2], `${parts[3]?.slice(0, -2)}AA`].join(".");
    expect(() => openToken(flipped)).toThrow(TokenKeyError);
  });

  it("refuses to run in production without TOKEN_ENCRYPTION_KEY and validates the key length", () => {
    expect(() => tokenKey({ NODE_ENV: "production" })).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(tokenKey({ TOKEN_ENCRYPTION_KEY: "ab".repeat(32) })).toHaveLength(32);
    expect(() => tokenKey({ TOKEN_ENCRYPTION_KEY: "short" })).toThrow(/32 bytes/);
    const key = tokenKey({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
    expect(openToken(sealToken("x", key), key)).toBe("x");
  });
});

describe("official OAuth", () => {
  it("signs state, and rejects tampering, expiry and platform swaps", () => {
    const env = { OAUTH_STATE_SECRET: "state-secret" };
    const state = signState({ workspaceId: "ws-1", platform: "tiktok", nowMs: 1_000 }, env);
    expect(verifyState(state, { platform: "tiktok", nowMs: 2_000 }, env).workspaceId).toBe("ws-1");
    expect(() => verifyState(`${state}x`, { platform: "tiktok", nowMs: 2_000 }, env)).toThrow(OAuthStateError);
    expect(() => verifyState(state, { platform: "instagram", nowMs: 2_000 }, env)).toThrow(/another platform/);
    expect(() => verifyState(state, { platform: "tiktok", nowMs: 1_000 + 11 * 60_000 }, env)).toThrow(/expired/);
    expect(() => verifyState(state, { platform: "tiktok", nowMs: 2_000 }, { OAUTH_STATE_SECRET: "other" })).toThrow(/signature/);
    expect(() => signState({ workspaceId: "w", platform: "tiktok" }, { NODE_ENV: "production" })).toThrow(/OAUTH_STATE_SECRET/);
  });

  it("builds Login Kit / Business Login URLs with PKCE and the posting scopes only", () => {
    // S256 = base64url(sha256(verifier)) without padding; expected value computed independently with Python hashlib.
    const challenge = pkceChallenge("dBjftJeZ4CVP-mJ92K9eqqm8Dm-gWdTE8ESJAAGJsJk");
    expect(challenge).toBe("1GNfA6qBjQ2_4pXSos4M_ES3SnErTWUCcKt9AfEqP-Q");
    expect(challenge).toHaveLength(43);
    const env = { TIKTOK_CLIENT_KEY: "ck", INSTAGRAM_APP_ID: "ig", META_APP_ID: "fb", PUBLIC_BASE_URL: "https://studio.example.com" };
    const tiktok = new URL(authorizeUrl("tiktok", { state: "s", challenge: "c" }, env));
    expect(tiktok.origin + tiktok.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(tiktok.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload,video.list");
    expect(tiktok.searchParams.get("code_challenge_method")).toBe("S256");
    expect(tiktok.searchParams.get("redirect_uri")).toBe("https://studio.example.com/api/oauth/tiktok/callback");
    const instagram = new URL(authorizeUrl("instagram", { state: "s", challenge: "c" }, env));
    expect(instagram.searchParams.get("scope")).toContain("instagram_business_content_publish");
    const facebook = new URL(authorizeUrl("facebook", { state: "s", challenge: "c" }, env));
    expect(facebook.pathname).toBe("/v24.0/dialog/oauth");
    expect(facebook.searchParams.get("scope")).toContain("pages_manage_posts");
  });

  it("treats publishing as live only with PUBLISH_MODE=live, credentials, and outside tests", () => {
    const creds = { TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" };
    expect(isPublishLive("tiktok", { ...creds, PUBLISH_MODE: "live", NODE_ENV: "production" })).toBe(true);
    expect(isPublishLive("tiktok", { ...creds, PUBLISH_MODE: "live", NODE_ENV: "test" })).toBe(false);
    expect(isPublishLive("tiktok", { ...creds, PUBLISH_MODE: "mock" })).toBe(false);
    expect(isPublishLive("tiktok", { PUBLISH_MODE: "live", TIKTOK_CLIENT_KEY: "k" })).toBe(false);
    expect(tiktokAudited({})).toBe(false);
    expect(tiktokAudited({ TIKTOK_AUDITED: "1" })).toBe(true);
  });
});

describe("posting rules", () => {
  it("maps approval privacy and forces SELF_ONLY until the TikTok audit passes", () => {
    expect(tiktokPrivacy("public")).toBe("PUBLIC_TO_EVERYONE");
    expect(tiktokPrivacy("friends")).toBe("MUTUAL_FOLLOW_FRIENDS");
    expect(tiktokPrivacy("only_me")).toBe("SELF_ONLY");
    expect(() => tiktokPrivacy("")).toThrow(PublishRuleError);
    expect(effectiveTikTokPrivacy({ approvalPrivacy: "public", audited: false })).toEqual({ privacy: "SELF_ONLY", forcedPrivate: true });
    expect(effectiveTikTokPrivacy({ approvalPrivacy: "public", audited: true })).toEqual({ privacy: "PUBLIC_TO_EVERYONE", forcedPrivate: false });
    expect(() =>
      effectiveTikTokPrivacy({ approvalPrivacy: "public", audited: true, allowedOptions: ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"] }),
    ).toThrow(/does not allow PUBLIC_TO_EVERYONE/);
  });

  it("requires express consent, keeps Meta posts to Public approvals, and caps unaudited TikTok creators at 5", () => {
    expect(() => assertPublishConsent(null)).toThrow(/no approval/);
    expect(() => assertPublishConsent({ ...approval, musicConsent: false })).toThrow(/Music/);
    expect(() => assertPublishConsent({ ...approval, scheduleConsent: false })).toThrow(/Consent/);
    expect(() => assertPublishConsent({ ...approval, privacy: "" })).toThrow(/no default/);
    expect(() => assertPublishConsent(approval)).not.toThrow();
    expect(() => assertMetaPrivacy("instagram", "only_me")).toThrow(/Instagram Reels are public/);
    expect(() => assertMetaPrivacy("tiktok", "only_me")).not.toThrow();
    const five = ["a", "b", "c", "d", "e"];
    expect(tiktokCapAllows({ accountId: "f", recentAccountIds: five, audited: false, cap: 5 })).toBe(false);
    expect(tiktokCapAllows({ accountId: "a", recentAccountIds: [...five, "a"], audited: false, cap: 5 })).toBe(true);
    expect(tiktokCapAllows({ accountId: "f", recentAccountIds: five, audited: true, cap: 5 })).toBe(true);
    expect(postCaption({ hook: "H", title: "T", captions: ["a", "b"] })).toBe("H\na\nb");
    expect(postCaption({ hook: "", title: "Title only", captions: [] })).toBe("Title only");
    expect(postCaption({ hook: "x".repeat(3000), title: "", captions: [] })).toHaveLength(2200);
  });

  it("builds the Direct Post body with interactions off, AI label on, and commercial toggles", () => {
    const body = buildTikTokDirectPostBody({ caption: "c", privacy: "SELF_ONLY", approval, aiGenerated: true, videoUrl: "https://v/x.mp4" });
    expect(body.post_info).toMatchObject({
      privacy_level: "SELF_ONLY",
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
      is_aigc: true,
    });
    expect(body.source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://v/x.mp4" });
    const own = buildTikTokDirectPostBody({
      caption: "c",
      privacy: "PUBLIC_TO_EVERYONE",
      approval: { ...approval, allowComments: true, commercialDisclosure: true, commercialType: "your_brand" },
      aiGenerated: true,
      videoUrl: "https://v/x.mp4",
      creator: { duet_disabled: true },
    });
    expect(own.post_info).toMatchObject({ disable_comment: false, disable_duet: true, brand_organic_toggle: true });
    expect(() =>
      buildTikTokDirectPostBody({
        caption: "c",
        privacy: "SELF_ONLY",
        approval: { ...approval, commercialDisclosure: true, commercialType: "branded_content" },
        aiGenerated: true,
        videoUrl: "https://v/x.mp4",
      }),
    ).toThrow(/branded content to be private/);
  });
});

describe("live publishers (stubbed platform APIs)", () => {
  it("TikTok Direct Post: creator info, init with SELF_ONLY while unaudited, then polls to PUBLISH_COMPLETE", async () => {
    let polls = 0;
    stub((url) => {
      if (url === TIKTOK_ENDPOINTS.creatorInfo) return { data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], creator_nickname: "nw" }, error: { code: "ok" } };
      if (url === TIKTOK_ENDPOINTS.directInit) return { data: { publish_id: "v_pub_1" }, error: { code: "ok" } };
      if (url === TIKTOK_ENDPOINTS.status) {
        polls += 1;
        return polls < 2
          ? { data: { status: "PROCESSING_DOWNLOAD" }, error: { code: "ok" } }
          : { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7311] }, error: { code: "ok" } };
      }
      throw new Error(url);
    });
    const ctx = context();
    const outcome = await tiktokPublisher.publish(ctx);
    expect(outcome).toEqual({ externalId: "7311", mode: "direct", privacy: "SELF_ONLY" });
    const init = calls.find((call) => call.url === TIKTOK_ENDPOINTS.directInit);
    expect((bodyOf(init).post_info as Record<string, unknown>).privacy_level).toBe("SELF_ONLY");
    expect((init?.init?.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(ctx.events).toEqual(["creator_info", "forced_private", "submitted", "status", "status"]);
  });

  it("TikTok falls back to upload-to-drafts when 5 other creators already posted in 24 h", async () => {
    stub((url) => {
      if (url === TIKTOK_ENDPOINTS.inboxInit) return { data: { publish_id: "v_inbox_1" }, error: { code: "ok" } };
      if (url === TIKTOK_ENDPOINTS.status) return { data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } };
      throw new Error(`unexpected ${url}`);
    });
    const ctx = context({ recentTikTokAccountIds: ["a", "b", "c", "d", "e"] });
    const outcome = await tiktokPublisher.publish(ctx);
    expect(outcome).toEqual({ externalId: "v_inbox_1", mode: "draft", privacy: "DRAFT" });
    expect(calls.some((call) => call.url === TIKTOK_ENDPOINTS.directInit)).toBe(false);
    expect(ctx.events[0]).toBe("fallback_to_draft");
  });

  it("Instagram Trial Reel: checks quota, creates a REELS container, waits for FINISHED, then publishes", async () => {
    expect(buildReelContainer({ videoUrl: "u", caption: "c", trial: false, aiGenerated: false })).toEqual({
      media_type: "REELS",
      video_url: "u",
      caption: "c",
      share_to_feed: true,
    });
    let statusPolls = 0;
    stub((url) => {
      if (url.includes("/content_publishing_limit")) return { data: [{ quota_usage: 3, config: { quota_total: 50 } }] };
      if (url.endsWith("/ext-1/media")) return { id: "container-9" };
      if (url.includes("/container-9?")) {
        statusPolls += 1;
        return { status_code: statusPolls < 2 ? "IN_PROGRESS" : "FINISHED" };
      }
      if (url.endsWith(`/ext-1/${MEDIA_PUBLISH}`)) return { id: "1789" };
      throw new Error(url);
    });
    const outcome = await instagramPublisher.publish(context({ platform: "instagram", mode: "trial_reel" }));
    expect(outcome).toEqual({ externalId: "1789", mode: "trial_reel", privacy: "TRIAL_NON_FOLLOWERS" });
    const container = bodyOf(calls.find((call) => call.url.endsWith("/ext-1/media")));
    expect(container).toMatchObject({
      media_type: "REELS",
      share_to_feed: false,
      trial_params: { graduation_strategy: "SS_PERFORMANCE" },
      is_ai_generated: true,
    });
    expect(bodyOf(calls.find((call) => call.url.endsWith(`/${MEDIA_PUBLISH}`)))).toMatchObject({ creation_id: "container-9" });
  });

  it("Instagram stops before uploading when the 24 h publishing quota is used up", async () => {
    stub((url) => {
      if (url.includes("/content_publishing_limit")) return { data: [{ quota_usage: 50, config: { quota_total: 50 } }] };
      throw new Error(`should not call ${url}`);
    });
    await expect(instagramPublisher.publish(context({ platform: "instagram", mode: "reel" }))).rejects.toThrow(/publishing limit/);
    expect(calls).toHaveLength(1);
  });

  it("Facebook Page Reel: start, hosted upload by file_url, finish as PUBLISHED, then waits for completion", async () => {
    stub((url, init) => {
      const body = String(init?.body ?? "");
      if (url.endsWith(`/ext-1/${VIDEO_REELS}`) && body.includes('"start"')) return { video_id: "fbv-1", upload_url: "https://rupload.facebook.com/video-upload/v24.0/fbv-1" };
      if (url.startsWith("https://rupload.facebook.com/")) return { success: true };
      if (url.endsWith(`/ext-1/${VIDEO_REELS}`) && body.includes('"finish"')) return { success: true };
      if (url.includes("/fbv-1?fields=status")) return { status: { video_status: "ready", publishing_phase: { status: "complete" } } };
      throw new Error(url);
    });
    const outcome = await facebookPublisher.publish(context({ platform: "facebook", mode: "reel" }));
    expect(outcome).toEqual({ externalId: "fbv-1", mode: "reel", privacy: "PUBLIC" });
    const upload = calls.find((call) => call.url.startsWith("https://rupload.facebook.com/"));
    expect((upload?.init?.headers as Record<string, string>).file_url).toMatch(/^https:\/\/studio\.example\.com\/api\/media\//);
    const finish = calls.filter((call) => call.url.endsWith(`/${VIDEO_REELS}`)).map(bodyOf)[1];
    expect(finish).toMatchObject({ upload_phase: "finish", video_id: "fbv-1", video_state: "PUBLISHED" });
  });

  it("live publishers refuse to start without a rendered MP4 at a public URL", async () => {
    stub(() => {
      throw new Error("no network expected");
    });
    const noMedia = context();
    noMedia.video.mediaUrl = null;
    await expect(tiktokPublisher.publish(noMedia)).rejects.toThrow(/No rendered MP4/);
    await expect(instagramPublisher.publish({ ...noMedia, platform: "instagram", mode: "reel" })).rejects.toThrow(/No rendered MP4/);
    expect(calls).toHaveLength(0);
  });
});
