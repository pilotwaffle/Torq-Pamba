import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as cronTick } from "@/app/api/cron/tick/route";
import { getDb } from "@/db";
import { auditLog, publishEvents, publishJobs, scheduleItems, socialAccounts, videos } from "@/db/schema";
import { refreshMetrics, workspaceAnalytics } from "@/lib/analytics";
import { signupAccount } from "@/lib/auth/account";
import { cancel, processDueItems, reschedule, scheduleVideo } from "@/lib/schedule";
import { accessTokenOf, connectMockAccount, disconnectAccount, listAccounts, MOCK_TOKEN_MARKER, REVOKED_TOKEN_MARKER } from "./accounts";
import { runPublishJob } from "./dispatch";
import { tiktokPublisher, TIKTOK_ENDPOINTS } from "./live/tiktok";
import { processPublishQueue } from "./queue";

const password = "correct-horse-battery";
const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

const manifest = {
  aiGenerated: true,
  hook: "Cold brew, zero wait",
  totalDurationS: 30,
  scenes: [],
  captions: [{ text: "Grab one on the way", startS: 0, endS: 30 }],
};

function approvalFor(privacy: string) {
  return {
    creatorNickname: "Northwind",
    privacy,
    allowComments: false,
    allowDuet: false,
    allowStitch: false,
    commercialDisclosure: false,
    commercialType: "",
    aiGenerated: true,
    musicConsent: true,
    scheduleConsent: true,
  };
}

async function setup(label: string, privacy = "public", title = "Oat-milk cold brew") {
  const { workspace, user } = await signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
  const db = await getDb();
  const [video] = await db
    .insert(videos)
    .values({ workspaceId: workspace.id, title, status: "approved", aiGenerated: true, manifest, approval: approvalFor(privacy) })
    .returning();
  return { workspace, user, video: video!, db };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publish flow (mock platforms)", () => {
  it("due items with targets become publish jobs; TikTok posts private until audit, Instagram posts a Reel", async () => {
    const { workspace, user, video, db } = await setup("flow");
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    expect(tiktok.accessTokenEnc).toBe(MOCK_TOKEN_MARKER);
    expect(accessTokenOf(tiktok)).toBe("");

    const item = await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [
      { accountId: tiktok.id, mode: "direct" },
      { accountId: instagram.id, mode: "reel" },
    ]);
    expect(item.targets).toHaveLength(2);
    expect(await processDueItems(new Date(), { workspaceId: workspace.id })).toContain(item.id);
    const [row] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, item.id));
    expect(row?.status).toBe("publishing");

    const result = await processPublishQueue({ workspaceId: workspace.id });
    expect(result).toEqual({ succeeded: 2, failed: 0 });
    const jobs = await db.select().from(publishJobs).where(eq(publishJobs.videoId, video.id));
    const tiktokJob = jobs.find((job) => job.platform === "tiktok");
    const igJob = jobs.find((job) => job.platform === "instagram");
    expect(tiktokJob).toMatchObject({ status: "succeeded", privacy: "SELF_ONLY", mode: "direct" });
    expect(tiktokJob?.externalId).toMatch(/^mock_tiktok_/);
    expect(igJob).toMatchObject({ status: "succeeded", privacy: "PUBLIC", mode: "reel" });

    const events = await db.select().from(publishEvents).where(eq(publishEvents.jobId, tiktokJob!.id));
    expect(events.map((event) => event.status)).toEqual(["processing", "forced_private", "submitted", "succeeded"]);
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.filter((entry) => entry.action === "publish.succeeded")).toHaveLength(2);
    expect(audits.some((entry) => entry.action === "schedule.publishing")).toBe(true);
    await expect(reschedule(item.id, "next", user.id)).rejects.toThrow(/already sent/);
  });

  it("re-checks the approval at post time and refuses Meta posts for a narrower-than-public approval", async () => {
    const { workspace, user, video, db } = await setup("narrow", "only_me");
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [
      { accountId: instagram.id, mode: "reel" },
      { accountId: tiktok.id, mode: "direct" },
    ]);
    await processDueItems(new Date(), { workspaceId: workspace.id });
    const queued = await db.select().from(publishJobs).where(eq(publishJobs.videoId, video.id));
    const igJob = queued.find((job) => job.platform === "instagram")!;
    const ttJob = queued.find((job) => job.platform === "tiktok")!;
    const ig = await runPublishJob(igJob.id);
    expect(ig.status).toBe("failed");
    expect(ig.error).toMatch(/Instagram Reels are public/);
    // Someone strips consent after scheduling: the TikTok job must refuse too.
    await db
      .update(videos)
      .set({ approval: { ...approvalFor("only_me"), musicConsent: false } })
      .where(eq(videos.id, video.id));
    const tt = await runPublishJob(ttJob.id);
    expect(tt.error).toMatch(/Music usage/);
    expect(await processPublishQueue({ workspaceId: workspace.id })).toEqual({ succeeded: 0, failed: 0 });
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.filter((entry) => entry.action === "publish.failed")).toHaveLength(2);
  });

  it("a live account never posts while PUBLISH_MODE is not live, and makes no network call", async () => {
    const { workspace, user, video, db } = await setup("liveguard");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const mock = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    await db.update(socialAccounts).set({ mode: "live" }).where(eq(socialAccounts.id, mock.id));
    await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [{ accountId: mock.id, mode: "direct" }]);
    await processDueItems(new Date(), { workspaceId: workspace.id });
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.videoId, video.id));
    const result = await runPublishJob(job!.id);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/PUBLISH_MODE is not live/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates targets, cancels queued jobs with the slot, and fails jobs for disconnected accounts", async () => {
    const { workspace, user, video, db } = await setup("targets");
    const other = await setup("other-ws");
    const foreign = await connectMockAccount({ workspaceId: other.workspace.id, platform: "tiktok" });
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    await expect(scheduleVideo(video.id, "next", user.id, [{ accountId: foreign.id, mode: "direct" }])).rejects.toThrow(/connected account/);
    await expect(scheduleVideo(video.id, "next", user.id, [{ accountId: tiktok.id, mode: "trial_reel" }])).rejects.toThrow(/does not support/);

    const item = await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [{ accountId: tiktok.id, mode: "draft" }]);
    await processDueItems(new Date(), { workspaceId: workspace.id });
    await cancel(item.id, user.id);
    const [canceledJob] = await db.select().from(publishJobs).where(eq(publishJobs.scheduleItemId, item.id));
    expect(canceledJob?.status).toBe("canceled");

    const second = await setup("disconnect");
    const acct = await connectMockAccount({ workspaceId: second.workspace.id, platform: "facebook" });
    await scheduleVideo(second.video.id, new Date(Date.now() - 1_000), "u", [{ accountId: acct.id, mode: "reel" }]);
    await processDueItems(new Date(), { workspaceId: second.workspace.id });
    await disconnectAccount(second.workspace.id, acct.id);
    expect(await listAccounts(second.workspace.id)).toHaveLength(0);
    const [revoked] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, acct.id));
    expect(revoked!.accessTokenEnc).toBe(REVOKED_TOKEN_MARKER);
    expect(revoked!.refreshTokenEnc).toBeNull();
    expect(() => accessTokenOf(revoked!)).toThrow(/disconnected/);
    expect(await processPublishQueue({ workspaceId: second.workspace.id })).toEqual({ succeeded: 0, failed: 1 });
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.accountId, acct.id));
    expect(job?.lastError).toMatch(/disconnected/);
  });

  it("cron tick needs CRON_SECRET, then runs due items and the publish queue", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "tick-secret";
    try {
      const { workspace, user, video } = await setup("crontick");
      const fb = await connectMockAccount({ workspaceId: workspace.id, platform: "facebook", userId: user.id });
      await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [{ accountId: fb.id, mode: "reel" }]);
      const response = await cronTick(
        new Request("http://localhost/api/cron/tick", { method: "POST", headers: { authorization: "Bearer tick-secret" } }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { due: number; jobsSucceeded: number };
      expect(body.due).toBeGreaterThanOrEqual(1);
      expect(body.jobsSucceeded).toBeGreaterThanOrEqual(1);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });
});

describe("analytics", () => {
  it("stores metric snapshots for posted jobs, skips drafts, and reports totals and engagement", async () => {
    const { workspace, user, video, db } = await setup("analytics");
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    const draftVideo = (await setup("analytics-draft")).video;
    await db.update(videos).set({ workspaceId: workspace.id }).where(eq(videos.id, draftVideo.id));
    await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [
      { accountId: tiktok.id, mode: "direct" },
      { accountId: instagram.id, mode: "reel" },
    ]);
    await scheduleVideo(draftVideo.id, new Date(Date.now() - 1_000), user.id, [{ accountId: tiktok.id, mode: "draft" }]);
    await processDueItems(new Date(), { workspaceId: workspace.id });
    await processPublishQueue({ workspaceId: workspace.id });

    const refreshed = await refreshMetrics(workspace.id);
    expect(refreshed).toEqual({ snapshots: 2, skipped: 1 });
    const report = await workspaceAnalytics(workspace.id);
    expect(report.posts).toHaveLength(2);
    expect(report.totals.views).toBe(report.posts.reduce((sum, post) => sum + post.views, 0));
    expect(report.totals.views).toBeGreaterThan(0);
    const ig = report.posts.find((post) => post.platform === "instagram");
    expect(ig?.reach).toBeGreaterThan(0);
    expect(report.engagementRate).toBeGreaterThan(0);
    await refreshMetrics(workspace.id);
    expect((await workspaceAnalytics(workspace.id)).posts).toHaveLength(2);
  });

  it("reads TikTok counts through the video query endpoint for live accounts", async () => {
    const { workspace, user, video, db } = await setup("tt-metrics");
    const acct = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    await scheduleVideo(video.id, new Date(Date.now() - 1_000), user.id, [{ accountId: acct.id, mode: "direct" }]);
    await processDueItems(new Date(), { workspaceId: workspace.id });
    await processPublishQueue({ workspaceId: workspace.id });
    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.accountId, acct.id));
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(TIKTOK_ENDPOINTS.videoQuery);
        seen.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ data: { videos: [{ id: job!.externalId, view_count: 1200, like_count: 90, comment_count: 4, share_count: 6 }] }, error: { code: "ok" } }),
        );
      }),
    );
    expect(await refreshMetrics(workspace.id, { publishers: { tiktok: tiktokPublisher } })).toEqual({ snapshots: 1, skipped: 0 });
    expect(seen[0]).toEqual({ filters: { video_ids: [job!.externalId] } });
    const report = await workspaceAnalytics(workspace.id);
    expect(report.posts[0]).toMatchObject({ views: 1200, likes: 90, comments: 4, shares: 6, engagementRate: 8.33 });
  });
});
