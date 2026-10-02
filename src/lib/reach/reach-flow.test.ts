import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { adHandoffs, auditLog, hookExperiments, hookVariants, knowledgeItems, publishAttempts, videos, workspaces } from "@/db/schema";
import { refreshMetrics } from "@/lib/analytics";
import { signupAccount } from "@/lib/auth/account";
import { connectMockAccount } from "@/lib/publish/accounts";
import { openToken } from "@/lib/publish/crypto";
import { processPublishQueue } from "@/lib/publish/queue";
import { getCreatorBrief, saveCreatorBrief } from "./creators";
import { approveVariants, cancelExperiment, createHookExperiment, decideExperiment, launchExperiment, variantStats } from "./experiments";
import { markPartnershipReady, recordSparkCode, revokeHandoff, startHandoff } from "./handoff";
import { addTile, archiveTile, listTiles, provenHooks, seedFromBrief, togglePin } from "./knowledge";

const password = "correct-horse-battery";
const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

const manifest = {
  aiGenerated: true,
  hook: "Stop scrolling — Oat-milk cold brew.",
  totalDurationS: 30,
  scenes: [
    { index: 0, visual: "kitchen", line: "Grab one on the way", durationS: 10, model: "mock", frameUrl: "" },
    { index: 1, visual: "street", line: "Open, go, done", durationS: 10, model: "mock", frameUrl: "" },
    { index: 2, visual: "desk", line: "Try it today", durationS: 10, model: "mock", frameUrl: "" },
  ],
  captions: [
    { text: "Grab one on the way", startS: 0, endS: 10 },
    { text: "Open, go, done", startS: 10, endS: 20 },
    { text: "Try it today", startS: 20, endS: 30 },
  ],
};

const approval = {
  creatorNickname: "Northwind",
  privacy: "public",
  allowComments: true,
  allowDuet: false,
  allowStitch: false,
  commercialDisclosure: false,
  commercialType: "",
  aiGenerated: true,
  musicConsent: true,
  scheduleConsent: true,
};

async function setup(label: string, status: "approved" | "ready" = "approved") {
  const { workspace, user } = await signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
  const db = await getDb();
  const brief = { companyName: "Northwind", products: ["Oat-milk cold brew"], audience: "Night-shift nurses", whatTheyDo: "Cold brew delivered", tone: "warm" };
  await db.update(workspaces).set({ brief }).where(eq(workspaces.id, workspace.id));
  const [video] = await db
    .insert(videos)
    .values({
      workspaceId: workspace.id,
      title: "Cold brew 30s",
      status,
      aiGenerated: true,
      manifest,
      approval: status === "approved" ? approval : null,
      costActualUsd: 4.2,
    })
    .returning();
  return { workspace: { ...workspace, brief }, user, video: video!, db };
}

describe("hook experiments on Instagram Trial Reels", () => {
  it("creates re-hooked variants of an approved video without charging for them", async () => {
    const { workspace, user, video, db } = await setup("hx-create");
    const experiment = await createHookExperiment({ workspace, baseVideoId: video.id, count: 3, actor: user.id });
    const variants = await db.select().from(hookVariants).where(eq(hookVariants.experimentId, experiment.id));
    expect(variants.map((v) => v.label).sort()).toEqual(["A", "B", "C"]);
    const control = variants.find((v) => v.label === "A")!;
    expect(control.videoId).toBe(video.id);
    expect(control.hook).toBe(manifest.hook);
    const b = variants.find((v) => v.label === "B")!;
    const [bVideo] = await db.select().from(videos).where(eq(videos.id, b.videoId));
    expect(bVideo).toMatchObject({ status: "ready", costActualUsd: 0, approval: null, title: "Cold brew 30s · hook B" });
    const bManifest = bVideo!.manifest as typeof manifest;
    expect(bManifest.hook).toBe(b.hook);
    expect(bManifest.captions[0]).toEqual({ text: b.hook, startS: 0, endS: 2 });
    expect(bManifest.scenes).toEqual(manifest.scenes);

    const unapproved = await setup("hx-unapproved", "ready");
    await expect(createHookExperiment({ workspace: unapproved.workspace, baseVideoId: unapproved.video.id, count: 3, actor: "u" })).rejects.toThrow(
      /Approve the video before testing hooks/,
    );
  });

  it("needs explicit variant approval and an Instagram account before launch", async () => {
    const { workspace, user, video, db } = await setup("hx-launch");
    const experiment = await createHookExperiment({ workspace, baseVideoId: video.id, count: 2, actor: user.id });
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    await expect(launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: instagram.id, actor: user.id })).rejects.toThrow(
      /Approve variant B before launch/,
    );
    await expect(approveVariants({ workspace, experimentId: experiment.id, actor: user.id, confirmed: false })).rejects.toThrow(/Confirm/);
    expect(await approveVariants({ workspace, experimentId: experiment.id, actor: user.id, confirmed: true })).toBe(1);
    const [b] = await db.select().from(hookVariants).where(and(eq(hookVariants.experimentId, experiment.id), eq(hookVariants.label, "B")));
    const [bVideo] = await db.select().from(videos).where(eq(videos.id, b!.videoId));
    expect(bVideo?.status).toBe("approved");
    expect(bVideo?.approval).toMatchObject({ privacy: "public", musicConsent: true, scheduleConsent: true, creatorNickname: "Northwind" });

    await expect(launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: tiktok.id, actor: user.id })).rejects.toThrow(
      /Instagram Trial Reels/,
    );
    await launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: instagram.id, actor: user.id });
    const jobs = await db.select().from(publishAttempts).where(eq(publishAttempts.workspaceId, workspace.id));
    expect(jobs).toHaveLength(2);
    expect(
      jobs.every((job) => job.mode === "trial_reel" && job.platform === "instagram" && job.scheduleItemId === null && job.aiDisclosure && job.status === "pending"),
    ).toBe(true);
    const [row] = await db.select().from(hookExperiments).where(eq(hookExperiments.id, experiment.id));
    expect(row?.status).toBe("running");
    await expect(launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: instagram.id, actor: user.id })).rejects.toThrow(
      /already launched/,
    );
  });

  it("posts, measures, picks the winner and writes it back to Knowledge for the next test", async () => {
    const { workspace, user, video, db } = await setup("hx-decide");
    const experiment = await createHookExperiment({ workspace, baseVideoId: video.id, count: 3, actor: user.id });
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    await approveVariants({ workspace, experimentId: experiment.id, actor: user.id, confirmed: true });
    await launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: instagram.id, actor: user.id });
    await expect(decideExperiment({ workspaceId: workspace.id, experimentId: experiment.id, actor: user.id })).rejects.toThrow(/has no metrics/);
    expect(await processPublishQueue({ workspaceId: workspace.id })).toEqual({ succeeded: 3, failed: 0 });
    const posted = await db.select().from(publishAttempts).where(eq(publishAttempts.workspaceId, workspace.id));
    expect(posted.every((job) => job.privacy === "TRIAL_NON_FOLLOWERS")).toBe(true);
    await refreshMetrics(workspace.id);
    const stats = await variantStats(experiment.id);
    expect(stats.every((row) => row.measured && row.views >= 400)).toBe(true);
    const best = [...stats].sort((a, b) => b.views - a.views || a.label.localeCompare(b.label))[0]!;

    const { decision, tile } = await decideExperiment({ workspaceId: workspace.id, experimentId: experiment.id, actor: user.id });
    expect(decision.kind === "winner" && decision.winner.label).toBe(best.label);
    const [row] = await db.select().from(hookExperiments).where(eq(hookExperiments.id, experiment.id));
    expect(row).toMatchObject({ status: "decided", winnerVariantId: best.variantId });
    expect(tile).toMatchObject({ kind: "hook_result", title: best.hook, source: "analytics" });
    expect(tile.sourceRef).toMatchObject({
      origin: "experiment",
      experimentId: experiment.id,
      pattern: best.pattern,
      views: best.views,
      channel: "instagram_trial_reels",
    });
    const audits = await db.select().from(auditLog).where(eq(auditLog.workspaceId, workspace.id));
    expect(audits.map((entry) => entry.action)).toEqual(expect.arrayContaining(["experiment.created", "experiment.launched", "experiment.decided", "knowledge.written"]));
    await expect(decideExperiment({ workspaceId: workspace.id, experimentId: experiment.id, actor: user.id })).rejects.toThrow(/Only a running/);

    const proven = await provenHooks(workspace.id);
    expect(proven.hooks[0]).toBe(best.hook);
    if (best.pattern !== "control") {
      const next = await createHookExperiment({ workspace, baseVideoId: video.id, count: 2, actor: user.id });
      const [nextB] = await db.select().from(hookVariants).where(and(eq(hookVariants.experimentId, next.id), eq(hookVariants.label, "B")));
      expect(nextB?.pattern).toBe(best.pattern);
    }
  });

  it("refuses to decide below the minimum views, and cancel stops queued posts", async () => {
    const { workspace, user, video, db } = await setup("hx-cancel");
    const experiment = await createHookExperiment({ workspace, baseVideoId: video.id, count: 2, minViews: 1_000_000, actor: user.id });
    const instagram = await connectMockAccount({ workspaceId: workspace.id, platform: "instagram", userId: user.id });
    await approveVariants({ workspace, experimentId: experiment.id, actor: user.id, confirmed: true });
    await launchExperiment({ workspaceId: workspace.id, experimentId: experiment.id, accountId: instagram.id, actor: user.id });
    await processPublishQueue({ workspaceId: workspace.id, limit: 1 });
    await refreshMetrics(workspace.id);
    await expect(decideExperiment({ workspaceId: workspace.id, experimentId: experiment.id, actor: user.id })).rejects.toThrow(/Not enough data yet/);
    await cancelExperiment({ workspaceId: workspace.id, experimentId: experiment.id, actor: user.id });
    const jobs = await db.select().from(publishAttempts).where(eq(publishAttempts.workspaceId, workspace.id));
    expect(jobs.map((job) => job.status).sort()).toEqual(["canceled", "published"]);
    const [row] = await db.select().from(hookExperiments).where(eq(hookExperiments.id, experiment.id));
    expect(row?.status).toBe("canceled");
  });
});

describe("knowledge tiles", () => {
  it("orders pinned tiles first, then by score, hides archived ones, and stays inside the workspace", async () => {
    const { workspace, user } = await setup("kn-order");
    const other = await setup("kn-other");
    const low = await addTile({ workspaceId: workspace.id, kind: "hook_result", title: "Low", score: 1, evidence: { pattern: "pov" }, actor: user.id });
    await addTile({ workspaceId: workspace.id, kind: "hook_result", title: "High", score: 40, evidence: { pattern: "number" }, actor: user.id });
    const note = await addTile({ workspaceId: workspace.id, kind: "learning", title: "Mornings win", actor: user.id });
    expect(note).toMatchObject({ source: "user", createdBy: user.id, sourceRef: { origin: "manual" } });
    await expect(addTile({ workspaceId: workspace.id, kind: "hook", title: "Old kind" })).rejects.toThrow(/Choose a tile type/);
    expect((await listTiles(workspace.id)).map((t) => t.title)).toEqual(["High", "Low", "Mornings win"]);
    expect(await togglePin(workspace.id, low.id)).toBe(true);
    expect((await listTiles(workspace.id))[0]?.title).toBe("Low");
    expect(await provenHooks(workspace.id)).toEqual({ hooks: ["Low", "High"], patterns: ["pov", "number"] });
    await expect(archiveTile(other.workspace.id, note.id)).rejects.toThrow(/Tile not found/);
    await archiveTile(workspace.id, note.id, user.id);
    expect((await listTiles(workspace.id)).map((t) => t.title)).toEqual(["Low", "High"]);
    expect(await listTiles(workspace.id, { includeArchived: true })).toHaveLength(3);
    expect(await listTiles(other.workspace.id)).toEqual([]);
    await expect(addTile({ workspaceId: workspace.id, kind: "hook_result", title: "" })).rejects.toThrow(/Title is required/);
  });

  it("imports audience (brand fact), angle and tone (preference) from the brand brief once", async () => {
    const { workspace, db } = await setup("kn-seed");
    expect(await seedFromBrief(workspace.id, workspace.brief)).toBe(3);
    expect(await seedFromBrief(workspace.id, workspace.brief)).toBe(0);
    const tiles = await db.select().from(knowledgeItems).where(eq(knowledgeItems.workspaceId, workspace.id));
    expect(tiles.map((t) => `${t.kind}:${t.title}`).sort()).toEqual(["angle:Cold brew delivered", "brand_fact:Night-shift nurses", "preference:Tone: warm"]);
    expect(tiles.every((t) => t.sourceRef?.origin === "brief")).toBe(true);
    expect(await seedFromBrief(workspace.id, null)).toBe(0);
  });
});

describe("ad hand-offs and creator briefs", () => {
  it("tracks a Spark Ads code sealed, linked to the TikTok post, and wipes it on revoke", async () => {
    const { workspace, user, video, db } = await setup("ho-spark");
    const tiktok = await connectMockAccount({ workspaceId: workspace.id, platform: "tiktok", userId: user.id });
    const [job] = await db
      .insert(publishAttempts)
      .values({
        workspaceId: workspace.id,
        videoId: video.id,
        connectionId: tiktok.id,
        platform: "tiktok",
        mode: "direct",
        status: "published",
        externalPostId: "v_1",
        completedAt: new Date(),
      })
      .returning();
    await expect(startHandoff({ workspaceId: workspace.id, videoId: video.id, kind: "tiktok_spark", creatorHandle: "bad handle!", actor: user.id })).rejects.toThrow(
      /creator's handle/,
    );
    const handoff = await startHandoff({ workspaceId: workspace.id, videoId: video.id, kind: "tiktok_spark", creatorHandle: "northwind.nurse", actor: user.id });
    expect(handoff).toMatchObject({ status: "awaiting_creator", creatorHandle: "@northwind.nurse", jobId: job!.id });
    await expect(startHandoff({ workspaceId: workspace.id, videoId: video.id, kind: "tiktok_spark", creatorHandle: "@x2", actor: user.id })).rejects.toThrow(
      /already exists/,
    );
    await expect(markPartnershipReady({ workspaceId: workspace.id, handoffId: handoff.id, actor: user.id, confirmed: true })).rejects.toThrow(
      /Only partnership ads/,
    );
    await recordSparkCode({ workspaceId: workspace.id, handoffId: handoff.id, code: "#SparkCode123456", actor: user.id });
    const [stored] = await db.select().from(adHandoffs).where(eq(adHandoffs.id, handoff.id));
    expect(stored).toMatchObject({ status: "ready", codeHint: "…3456" });
    expect(stored!.codeEnc).not.toContain("SparkCode");
    expect(openToken(stored!.codeEnc!)).toBe("#SparkCode123456");
    await revokeHandoff({ workspaceId: workspace.id, handoffId: handoff.id, actor: user.id });
    const [revoked] = await db.select().from(adHandoffs).where(eq(adHandoffs.id, handoff.id));
    expect(revoked).toMatchObject({ status: "revoked", codeEnc: null, codeHint: null });
    await expect(recordSparkCode({ workspaceId: workspace.id, handoffId: handoff.id, code: "#another-code", actor: user.id })).rejects.toThrow(/revoked/);
  });

  it("confirms partnership ads explicitly and refuses unapproved videos", async () => {
    const { workspace, user, video } = await setup("ho-meta");
    const handoff = await startHandoff({ workspaceId: workspace.id, videoId: video.id, kind: "meta_partnership", creatorHandle: "@creator", actor: user.id });
    expect(handoff.jobId).toBeNull();
    await expect(recordSparkCode({ workspaceId: workspace.id, handoffId: handoff.id, code: "#SparkCode123456", actor: user.id })).rejects.toThrow(/Only Spark Ads/);
    await expect(markPartnershipReady({ workspaceId: workspace.id, handoffId: handoff.id, actor: user.id, confirmed: false })).rejects.toThrow(/Confirm/);
    await markPartnershipReady({ workspaceId: workspace.id, handoffId: handoff.id, actor: user.id, confirmed: true });
    const draft = await setup("ho-draft", "ready");
    await expect(
      startHandoff({ workspaceId: draft.workspace.id, videoId: draft.video.id, kind: "meta_partnership", creatorHandle: "@creator", actor: "u" }),
    ).rejects.toThrow(/Only an approved video/);
  });

  it("saves a creator brief with proven hooks and keeps it inside the workspace", async () => {
    const { workspace, user, video } = await setup("cb-save");
    const other = await setup("cb-other");
    await addTile({ workspaceId: workspace.id, kind: "hook_result", title: "POV: you finally found Oat-milk cold brew.", score: 30 });
    const brief = await saveCreatorBrief({
      workspaceId: workspace.id,
      brand: workspace.brief,
      videoId: video.id,
      actor: user.id,
      form: {
        title: "Fall UGC",
        budgetUsd: 800,
        videoCount: 3,
        lengthS: 30,
        platforms: ["tiktok"],
        usageRightsDays: 60,
        allowSparkAds: true,
        allowPartnershipAds: false,
        dueDate: "",
        marketplaces: ["collabstr"],
      },
    });
    expect(brief.body.hooks).toEqual(["POV: you finally found Oat-milk cold brew.", manifest.hook]);
    expect(brief.body.referenceVideoTitle).toBe("Cold brew 30s");
    expect(brief.body.deliverables).toEqual([{ platform: "tiktok", format: "Vertical 9:16 TikTok video", count: 3, lengthS: 30 }]);
    expect(await getCreatorBrief(other.workspace.id, brief.id)).toBeNull();
    await expect(
      saveCreatorBrief({ workspaceId: workspace.id, brand: null, actor: "u", form: { ...brief.body, title: "x", videoCount: 0, lengthS: 30, platforms: ["tiktok"], dueDate: "", budgetUsd: 1 } }),
    ).rejects.toThrow(/1 to 50 videos/);
  });

  it("never calls TikTok or Meta marketing APIs from src/", async () => {
    const needles = ["business-api.tiktok" + ".com", "/ad" + "creatives", "/act" + "_", "ads_" + "management"];
    const hits: string[] = [];
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          const text = await readFile(full, "utf8");
          for (const needle of needles) if (text.includes(needle)) hits.push(`${path.relative(process.cwd(), full)}: ${needle}`);
        }
      }
    }
    await walk(path.join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
