import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  hookExperiments,
  hookVariants,
  postAnalyticsSnapshots,
  publishAttempts,
  videos,
  workspaces,
  type HookExperiment,
  type Workspace,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import type { ApprovalDraft, Privacy } from "@/lib/approval";
import { engagementRate } from "@/lib/analytics";
import { validateTargets } from "@/lib/publish/accounts";
import { enqueuePublishJobs } from "@/lib/publish/queue";
import { parseManifest } from "@/lib/router";
import { approveVideo, getWorkspaceVideo } from "@/lib/videos";
import { captionsWithHook, generateHookVariants, hookPolicyIssues } from "./hooks";
import { addTile, provenHooks } from "./knowledge";

/**
 * Hook experiments on Instagram Trial Reels. Trial Reels are shown to
 * non-followers first, so a hook can be tested without spamming followers.
 * Flow: create (variants as re-cut videos) -> approve variants -> launch (one
 * trial_reel publish job per variant) -> refresh metrics -> decide (winner is
 * written back to Knowledge).
 */

export class ExperimentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentError";
  }
}

export type ExperimentMetric = "views" | "engagement";
export const MIN_LIFT_PCT = 10;

export type VariantStats = {
  variantId: string;
  label: string;
  hook: string;
  pattern: string;
  videoId: string;
  jobStatus: string | null;
  views: number;
  engagementRate: number;
  measured: boolean;
};

export type Decision =
  | { kind: "insufficient"; reason: string }
  | {
      kind: "winner";
      winner: VariantStats;
      runnerUp: VariantStats | null;
      liftPct: number;
      confidence: "clear" | "low";
      ranking: VariantStats[];
    };

/** Pure winner selection. Every variant must be measured with at least minViews. */
export function pickWinner(rows: VariantStats[], options: { metric: ExperimentMetric; minViews: number; minLiftPct?: number }): Decision {
  if (rows.length < 2) return { kind: "insufficient", reason: "A hook test needs at least two variants" };
  const short = rows.find((row) => !row.measured || row.views < options.minViews);
  if (short) {
    return {
      kind: "insufficient",
      reason: short.measured
        ? `Not enough data yet: variant ${short.label} has ${short.views} views (needs ${options.minViews}).`
        : `Not enough data yet: variant ${short.label} has no metrics. Refresh metrics after it posts.`,
    };
  }
  const score = (row: VariantStats) => (options.metric === "views" ? row.views : row.engagementRate);
  const ranking = [...rows].sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label));
  const winner = ranking[0]!;
  const runnerUp = ranking[1] ?? null;
  const runnerScore = runnerUp ? score(runnerUp) : 0;
  const liftPct = runnerScore > 0 ? Math.round(((score(winner) - runnerScore) / runnerScore) * 1000) / 10 : 100;
  const confidence = liftPct >= (options.minLiftPct ?? MIN_LIFT_PCT) ? "clear" : "low";
  return { kind: "winner", winner, runnerUp, liftPct, confidence, ranking };
}

function approvalDraftFrom(approval: Record<string, unknown> | null, aiGenerated: boolean): ApprovalDraft {
  const a = approval ?? {};
  const privacy = a.privacy === "public" || a.privacy === "friends" || a.privacy === "only_me" ? (a.privacy as Privacy) : "";
  const type = a.commercialType === "your_brand" || a.commercialType === "branded_content" ? a.commercialType : "";
  return {
    creatorNickname: typeof a.creatorNickname === "string" ? a.creatorNickname : "",
    privacy,
    allowComments: a.allowComments === true,
    allowDuet: a.allowDuet === true,
    allowStitch: a.allowStitch === true,
    commercialDisclosure: a.commercialDisclosure === true,
    commercialType: type,
    aiGenerated,
    confirmAiOff: !aiGenerated,
    musicConsent: a.musicConsent === true,
    scheduleConsent: a.scheduleConsent === true,
  };
}

export async function createHookExperiment(input: {
  workspace: Workspace;
  baseVideoId: string;
  count: number;
  metric?: ExperimentMetric;
  minViews?: number;
  actor: string;
}): Promise<HookExperiment> {
  const base = await getWorkspaceVideo(input.workspace.id, input.baseVideoId);
  if (!base) throw new ExperimentError("Video not found");
  if (base.status !== "approved" && base.status !== "scheduled") throw new ExperimentError("Approve the video before testing hooks");
  const manifest = parseManifest(base.manifest);
  if (!manifest) throw new ExperimentError("This video has no finished cut to re-hook");
  const brief = input.workspace.brief ?? {};
  const proven = await provenHooks(input.workspace.id);
  const drafts = generateHookVariants({
    product: brief.products?.find((item) => item.trim()) ?? base.title,
    audience: brief.audience ?? "",
    company: brief.companyName ?? "",
    baseHook: manifest.hook,
    count: input.count,
    preferPatterns: proven.patterns,
  });
  if (drafts.length < 2) throw new ExperimentError("Could not write distinct hook variants for this video");

  const db = await getDb();
  const [experiment] = await db
    .insert(hookExperiments)
    .values({
      workspaceId: input.workspace.id,
      baseVideoId: base.id,
      metric: input.metric ?? "views",
      minViews: Math.max(1, Math.round(input.minViews ?? 300)),
      createdBy: input.actor,
    })
    .returning();
  if (!experiment) throw new ExperimentError("Could not create the experiment");

  for (const draft of drafts) {
    let videoId = base.id;
    if (draft.pattern !== "control") {
      const variantManifest = { ...manifest, hook: draft.hook, captions: captionsWithHook(manifest.captions, draft.hook) };
      const [row] = await db
        .insert(videos)
        .values({
          workspaceId: input.workspace.id,
          avatarId: base.avatarId,
          title: `${base.title} · hook ${draft.label}`.slice(0, 120),
          prompt: base.prompt,
          status: "ready",
          tier: base.tier,
          model: base.model,
          plan: { ...(base.plan ?? {}), hook: draft.hook, variantOf: base.id, experimentId: experiment.id },
          costEstimate: base.costEstimate,
          // A re-hook reuses the base clips, so nothing new is charged.
          costActualUsd: 0,
          aiGenerated: base.aiGenerated,
          manifest: variantManifest,
        })
        .returning({ id: videos.id });
      if (!row) throw new ExperimentError("Could not create a variant");
      videoId = row.id;
    }
    await db.insert(hookVariants).values({
      experimentId: experiment.id,
      workspaceId: input.workspace.id,
      label: draft.label,
      pattern: draft.pattern,
      hook: draft.hook,
      videoId,
    });
  }
  await writeAudit({
    workspaceId: input.workspace.id,
    actor: input.actor,
    action: "experiment.created",
    data: { experimentId: experiment.id, baseVideoId: base.id, variants: drafts.length },
  });
  return experiment;
}

async function ownExperiment(workspaceId: string, experimentId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(hookExperiments)
    .where(and(eq(hookExperiments.id, experimentId), eq(hookExperiments.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new ExperimentError("Experiment not found");
  return row;
}

async function variantsOf(experimentId: string) {
  const db = await getDb();
  return db
    .select({
      id: hookVariants.id,
      label: hookVariants.label,
      pattern: hookVariants.pattern,
      hook: hookVariants.hook,
      videoId: hookVariants.videoId,
      publishJobId: hookVariants.publishJobId,
      videoStatus: videos.status,
      videoTitle: videos.title,
    })
    .from(hookVariants)
    .innerJoin(videos, eq(videos.id, hookVariants.videoId))
    .where(eq(hookVariants.experimentId, experimentId))
    .orderBy(asc(hookVariants.label));
}

/** Applies the base video's approval to every unapproved variant (the user confirms this explicitly). */
export async function approveVariants(input: { workspace: Workspace; experimentId: string; actor: string; confirmed: boolean }) {
  if (!input.confirmed) throw new ExperimentError("Confirm that every variant uses the base video's approval settings");
  const experiment = await ownExperiment(input.workspace.id, input.experimentId);
  if (experiment.status !== "draft") throw new ExperimentError("Variants can only be approved before launch");
  const base = await getWorkspaceVideo(input.workspace.id, experiment.baseVideoId);
  if (!base) throw new ExperimentError("Base video not found");
  const variants = await variantsOf(experiment.id);
  let approved = 0;
  for (const variant of variants) {
    if (variant.videoStatus !== "ready") continue;
    const issues = hookPolicyIssues(variant.hook);
    if (issues.length > 0) throw new ExperimentError(`Variant ${variant.label}: ${issues[0]}`);
    await approveVideo({
      workspace: input.workspace,
      actor: input.actor,
      videoId: variant.videoId,
      draft: approvalDraftFrom(base.approval, base.aiGenerated),
    });
    approved += 1;
  }
  return approved;
}

export async function launchExperiment(input: { workspaceId: string; experimentId: string; accountId: string; actor: string }) {
  const experiment = await ownExperiment(input.workspaceId, input.experimentId);
  if (experiment.status !== "draft") throw new ExperimentError("This experiment already launched");
  const variants = await variantsOf(experiment.id);
  const pending = variants.find((variant) => variant.videoStatus !== "approved" && variant.videoStatus !== "scheduled");
  if (pending) throw new ExperimentError(`Approve variant ${pending.label} before launch`);
  const [target] = await validateTargets(input.workspaceId, [{ accountId: input.accountId, mode: "trial_reel" }]).catch((error: unknown) => {
    throw new ExperimentError(
      error instanceof Error && /does not support/.test(error.message)
        ? "Hook tests run as Instagram Trial Reels. Choose a connected Instagram account."
        : error instanceof Error
          ? error.message
          : "Choose a connected Instagram account",
    );
  });
  const db = await getDb();
  for (const variant of variants) {
    const [jobId] = await enqueuePublishJobs({
      workspaceId: input.workspaceId,
      videoId: variant.videoId,
      scheduleItemId: null,
      targets: [target!],
    });
    if (jobId) await db.update(hookVariants).set({ publishJobId: jobId }).where(eq(hookVariants.id, variant.id));
  }
  await db
    .update(hookExperiments)
    .set({ status: "running", accountId: input.accountId, launchedAt: new Date() })
    .where(eq(hookExperiments.id, experiment.id));
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "experiment.launched",
    data: { experimentId: experiment.id, accountId: input.accountId, variants: variants.length, mode: "trial_reel" },
  });
}

export async function variantStats(experimentId: string): Promise<VariantStats[]> {
  const variants = await variantsOf(experimentId);
  const jobIds = variants.map((variant) => variant.publishJobId).filter((id): id is string => Boolean(id));
  const db = await getDb();
  const jobs = jobIds.length
    ? await db.select({ id: publishAttempts.id, status: publishAttempts.status }).from(publishAttempts).where(inArray(publishAttempts.id, jobIds))
    : [];
  const snapshots = jobIds.length
    ? await db
        .select()
        .from(postAnalyticsSnapshots)
        .where(inArray(postAnalyticsSnapshots.publishAttemptId, jobIds))
        .orderBy(desc(postAnalyticsSnapshots.capturedAt))
    : [];
  return variants.map((variant) => {
    const snapshot = snapshots.find((row) => row.publishAttemptId === variant.publishJobId);
    const latest = snapshot
      ? {
          views: snapshot.views ?? 0,
          likes: snapshot.likes ?? 0,
          comments: snapshot.comments ?? 0,
          shares: snapshot.shares ?? 0,
          saves: snapshot.saves ?? 0,
        }
      : null;
    return {
      variantId: variant.id,
      label: variant.label,
      hook: variant.hook,
      pattern: variant.pattern,
      videoId: variant.videoId,
      jobStatus: jobs.find((job) => job.id === variant.publishJobId)?.status ?? null,
      views: latest?.views ?? 0,
      engagementRate: latest ? engagementRate(latest) : 0,
      measured: Boolean(latest),
    };
  });
}

export async function decideExperiment(input: { workspaceId: string; experimentId: string; actor: string }) {
  const experiment = await ownExperiment(input.workspaceId, input.experimentId);
  if (experiment.status !== "running") throw new ExperimentError("Only a running experiment can be decided");
  const stats = await variantStats(experiment.id);
  const decision = pickWinner(stats, { metric: experiment.metric === "engagement" ? "engagement" : "views", minViews: experiment.minViews });
  if (decision.kind === "insufficient") throw new ExperimentError(decision.reason);
  const { winner, runnerUp, liftPct, confidence } = decision;
  const db = await getDb();
  await db
    .update(hookExperiments)
    .set({
      status: "decided",
      winnerVariantId: winner.variantId,
      decidedAt: new Date(),
      decision: {
        winner: winner.label,
        runnerUp: runnerUp?.label ?? null,
        liftPct,
        confidence,
        ranking: decision.ranking.map((row) => ({ label: row.label, views: row.views, engagementRate: row.engagementRate })),
      },
    })
    .where(eq(hookExperiments.id, experiment.id));
  const metricLabel = experiment.metric === "engagement" ? "engagement" : "views";
  const tile = await addTile({
    workspaceId: input.workspaceId,
    kind: "hook_result",
    title: winner.hook,
    body:
      `Won a ${stats.length}-way hook test on Instagram Trial Reels: ${winner.views} views, ${winner.engagementRate}% engagement, ` +
      `${liftPct}% more ${metricLabel} than variant ${runnerUp?.label ?? "-"}.` +
      (confidence === "low" ? ` Low confidence: the lift is under ${MIN_LIFT_PCT}%. Re-test before relying on it.` : ""),
    source: "experiment",
    evidence: {
      pattern: winner.pattern,
      views: winner.views,
      engagementRate: winner.engagementRate,
      liftPct,
      confidence,
      variants: stats.length,
      channel: "instagram_trial_reels",
    },
    score: confidence === "clear" ? liftPct : Math.min(liftPct, MIN_LIFT_PCT - 1),
    experimentId: experiment.id,
    actor: input.actor,
  });
  await writeAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "experiment.decided",
    data: { experimentId: experiment.id, winner: winner.label, liftPct, confidence, tileId: tile.id },
  });
  return { decision, tile };
}

export async function cancelExperiment(input: { workspaceId: string; experimentId: string; actor: string }) {
  const experiment = await ownExperiment(input.workspaceId, input.experimentId);
  if (experiment.status === "decided" || experiment.status === "canceled") throw new ExperimentError("This experiment is already closed");
  const db = await getDb();
  const variants = await variantsOf(experiment.id);
  const jobIds = variants.map((variant) => variant.publishJobId).filter((id): id is string => Boolean(id));
  if (jobIds.length) {
    await db
      .update(publishAttempts)
      .set({ status: "canceled", completedAt: new Date() })
      .where(and(inArray(publishAttempts.id, jobIds), eq(publishAttempts.status, "pending")));
  }
  await db.update(hookExperiments).set({ status: "canceled" }).where(eq(hookExperiments.id, experiment.id));
  await writeAudit({ workspaceId: input.workspaceId, actor: input.actor, action: "experiment.canceled", data: { experimentId: experiment.id } });
}

export async function listExperiments(workspaceId: string) {
  const db = await getDb();
  return db
    .select({
      id: hookExperiments.id,
      status: hookExperiments.status,
      metric: hookExperiments.metric,
      createdAt: hookExperiments.createdAt,
      baseTitle: videos.title,
      decision: hookExperiments.decision,
    })
    .from(hookExperiments)
    .innerJoin(videos, eq(videos.id, hookExperiments.baseVideoId))
    .where(eq(hookExperiments.workspaceId, workspaceId))
    .orderBy(desc(hookExperiments.createdAt));
}

export async function getExperiment(workspaceId: string, experimentId: string) {
  const experiment = await ownExperiment(workspaceId, experimentId);
  const base = await getWorkspaceVideo(workspaceId, experiment.baseVideoId);
  const stats = await variantStats(experiment.id);
  return { experiment, baseTitle: base?.title ?? "", stats };
}

export async function workspaceById(workspaceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return row ?? null;
}

export const EXPERIMENT_STATUS_LABEL: Record<HookExperiment["status"], string> = {
  draft: "Draft — approve variants, then launch",
  running: "Running on Trial Reels",
  decided: "Winner picked",
  canceled: "Canceled",
};
