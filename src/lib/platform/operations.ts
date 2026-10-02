import { z } from "zod";
import { buildPlan, planCost } from "@/lib/agent/plan";
import { workspaceAnalytics } from "@/lib/analytics";
import { listWorkspaceAvatars } from "@/lib/avatars/store";
import { remainingBudgetUsd } from "@/lib/budget";
import { estimateClipCost, roundCents, type Tier } from "@/lib/pricing";
import { listPublishJobs } from "@/lib/publish/queue";
import { listTiles, provenHooks } from "@/lib/reach/knowledge";
import { workspaceById } from "@/lib/reach/experiments";
import { BudgetExceededError, generateVideo, parseManifest } from "@/lib/router";
import { listSchedule } from "@/lib/schedule";
import { getWorkspaceVideo, listVideos } from "@/lib/videos";
import { grantSpendUsd, type Principal } from "./credentials";

/**
 * Operations shared by the REST API (/api/v1) and the MCP server (/api/mcp).
 * Both surfaces authenticate first, then call these with the principal, so
 * scope, spending cap, workspace budget and "never charge a failure" are
 * enforced in one place.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type OperationResult = { data: unknown; costUsd: number; status?: number };

const TIERS = ["budget", "standard", "premium"] as const;

export const createVideoInput = z.object({
  prompt: z.string().trim().min(3, "prompt must be at least 3 characters").max(2000),
  durationS: z.number().int().min(6).max(60).default(30),
  tier: z.enum(TIERS).default("standard"),
  hookIndex: z.number().int().min(0).max(2).default(0),
});

export const estimateInput = z.object({
  durationS: z.number().int().min(6).max(60).default(30),
  tier: z.enum(TIERS).default("standard"),
});

export const getVideoInput = z.object({ id: z.string().uuid("id must be a video id") });
export const listInput = z.object({ limit: z.number().int().min(1).max(100).default(20) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new ApiError(400, "invalid_request", result.error.issues[0]?.message ?? "Invalid request");
  return result.data;
}

async function workspaceOf(principal: Principal) {
  const workspace = await workspaceById(principal.workspaceId);
  if (!workspace) throw new ApiError(401, "unauthorized", "Workspace no longer exists");
  return workspace;
}

export async function getWorkspaceInfo(principal: Principal): Promise<OperationResult> {
  const workspace = await workspaceOf(principal);
  const budget = await remainingBudgetUsd(workspace);
  const spent = await grantSpendUsd(principal.grantId);
  return {
    costUsd: 0,
    data: {
      id: workspace.id,
      name: workspace.name,
      plan: workspace.plan,
      budget: { capUsd: Number(workspace.budgetCapUsd), spentUsd: budget.spentUsd, remainingUsd: budget.remainingUsd },
      credential: {
        kind: principal.kind === "key" ? "api_key" : "oauth",
        scope: principal.scope,
        spendCapUsd: principal.spendCapUsd,
        spentThisMonthUsd: spent,
      },
    },
  };
}

export async function listVideosOp(principal: Principal, input: unknown): Promise<OperationResult> {
  const { limit } = parse(listInput, input);
  const rows = await listVideos(principal.workspaceId);
  return {
    costUsd: 0,
    data: rows.slice(0, limit).map((row) => ({ id: row.id, title: row.title, status: row.status, tier: row.tier, createdAt: row.createdAt })),
  };
}

export async function getVideoOp(principal: Principal, input: unknown): Promise<OperationResult> {
  const { id } = parse(getVideoInput, input);
  const video = await getWorkspaceVideo(principal.workspaceId, id);
  if (!video) throw new ApiError(404, "not_found", "Video not found");
  const manifest = parseManifest(video.manifest);
  const jobs = await listPublishJobs(principal.workspaceId, video.id);
  return {
    costUsd: 0,
    data: {
      id: video.id,
      title: video.title,
      status: video.status,
      tier: video.tier,
      costUsd: Number(video.costActualUsd ?? 0),
      aiGenerated: video.aiGenerated,
      hook: manifest?.hook ?? null,
      durationS: manifest?.totalDurationS ?? null,
      captions: manifest?.captions ?? [],
      hasRenderedMp4: Boolean(video.mediaKey),
      publishJobs: jobs.map((job) => ({ platform: job.platform, mode: job.mode, status: job.status, privacy: job.privacy })),
    },
  };
}

export async function estimateOp(principal: Principal, input: unknown): Promise<OperationResult> {
  const { durationS, tier } = parse(estimateInput, input);
  const estimate = estimateClipCost({ tier, durationS });
  const workspace = await workspaceOf(principal);
  const budget = await remainingBudgetUsd(workspace);
  return { costUsd: 0, data: { tier, durationS, estimateUsd: estimate, remainingBudgetUsd: budget.remainingUsd } };
}

/**
 * Plans and generates one video. 403 for read-only credentials, 402 when the
 * estimate is over the credential's spending cap or the workspace budget, 422
 * when every model fails (nothing is charged). Success returns 201.
 */
export async function createVideoOp(principal: Principal, input: unknown): Promise<OperationResult> {
  if (principal.scope !== "write") throw new ApiError(403, "insufficient_scope", "This credential is read-only. Create a write key to generate videos.");
  const body = parse(createVideoInput, input);
  const workspace = await workspaceOf(principal);
  const avatars = await listWorkspaceAvatars(workspace.id);
  const avatar = avatars.find((item) => item.isDefault) ?? avatars[0] ?? null;
  const proven = await provenHooks(workspace.id);
  const plan = buildPlan({
    topic: body.prompt,
    count: 1,
    durationS: body.durationS,
    sourcePrompt: body.prompt,
    brief: workspace.brief,
    avatar: avatar ? { id: avatar.id, name: avatar.name, look: avatar.look } : null,
    tier: body.tier as Tier,
    provenHooks: proven.hooks,
  });
  const estimate = planCost(plan, body.tier as Tier);
  if (principal.spendCapUsd !== null) {
    const spent = await grantSpendUsd(principal.grantId);
    const left = roundCents(Math.max(0, principal.spendCapUsd - spent));
    if (Math.round(estimate.total * 100) > Math.round(left * 100)) {
      throw new ApiError(
        402,
        "spend_cap_exceeded",
        `Estimated $${estimate.total.toFixed(2)} is over the $${left.toFixed(2)} left on this credential's monthly spending cap.`,
      );
    }
  }
  let result: Awaited<ReturnType<typeof generateVideo>>;
  try {
    result = await generateVideo({
      workspaceId: workspace.id,
      tier: body.tier as Tier,
      title: plan.title,
      prompt: plan.sourcePrompt,
      avatarId: plan.avatarId,
      hook: plan.hooks[body.hookIndex] ?? plan.hooks[0],
      voiceLines: plan.scenes.map((scene) => scene.line),
      scenes: plan.scenes,
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) throw new ApiError(402, "budget_exceeded", error.message);
    throw error;
  }
  if (!result.ok) throw new ApiError(422, "generation_failed", result.error);
  const video = await getWorkspaceVideo(workspace.id, result.videoId);
  const costUsd = Number(video?.costActualUsd ?? 0);
  return {
    status: 201,
    costUsd,
    data: {
      id: result.videoId,
      title: video?.title ?? plan.title,
      status: video?.status ?? "ready",
      costUsd,
      estimateUsd: estimate.total,
      next: "Approve the video in the studio before it can be scheduled or published.",
    },
  };
}

export async function listScheduleOp(principal: Principal): Promise<OperationResult> {
  const rows = await listSchedule(principal.workspaceId);
  return { costUsd: 0, data: rows };
}

export async function analyticsOp(principal: Principal): Promise<OperationResult> {
  return { costUsd: 0, data: await workspaceAnalytics(principal.workspaceId) };
}

export async function knowledgeOp(principal: Principal): Promise<OperationResult> {
  const tiles = await listTiles(principal.workspaceId);
  return {
    costUsd: 0,
    data: tiles.map((tile) => ({ kind: tile.kind, title: tile.title, body: tile.body, source: tile.source, score: tile.score, pinned: tile.pinned })),
  };
}
