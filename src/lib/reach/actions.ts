"use server";

import { redirect } from "next/navigation";
import { refreshMetrics } from "@/lib/analytics";
import { requireWorkspace } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/publish/accounts";
import { processPublishQueue } from "@/lib/publish/queue";
import { CreatorBriefError, MARKETPLACES, saveCreatorBrief, type Marketplace } from "./creators";
import {
  approveVariants,
  cancelExperiment,
  createHookExperiment,
  decideExperiment,
  ExperimentError,
  launchExperiment,
} from "./experiments";
import { HandoffError, markPartnershipReady, recordSparkCode, revokeHandoff, startHandoff } from "./handoff";
import { addTile, archiveTile, KnowledgeError, seedFromBrief, togglePin } from "./knowledge";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const KNOWN = [ExperimentError, KnowledgeError, HandoffError, CreatorBriefError];

function messageOf(error: unknown, fallback: string): string {
  if (KNOWN.some((type) => error instanceof type)) return (error as Error).message;
  if (error instanceof Error && error.name === "ApprovalError") return error.message;
  if (error instanceof Error && error.name === "TokenKeyError") return "This server has no TOKEN_ENCRYPTION_KEY, so it refuses to store codes. Ask the operator to set it.";
  return fallback;
}

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

// --- Hook experiments ------------------------------------------------------

export async function createExperimentAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  let id = "";
  try {
    const experiment = await createHookExperiment({
      workspace,
      baseVideoId: text(formData, "videoId"),
      count: Number(text(formData, "count") || 3),
      metric: text(formData, "metric") === "engagement" ? "engagement" : "views",
      actor: user.id,
    });
    id = experiment.id;
  } catch (error) {
    fail("/app/reach", messageOf(error, "Could not create the hook test"));
  }
  redirect(`/app/reach/${id}`);
}

export async function approveVariantsAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const id = text(formData, "experimentId");
  try {
    await approveVariants({ workspace, experimentId: id, actor: user.id, confirmed: text(formData, "confirm") === "on" });
  } catch (error) {
    fail(`/app/reach/${id}`, messageOf(error, "Could not approve the variants"));
  }
  redirect(`/app/reach/${id}?ok=approved`);
}

export async function launchExperimentAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const id = text(formData, "experimentId");
  const accountId = text(formData, "accountId");
  try {
    await launchExperiment({ workspaceId: workspace.id, experimentId: id, accountId, actor: user.id });
    // Mock accounts post at once; live accounts are posted by the cron tick.
    const account = (await listAccounts(workspace.id)).find((row) => row.id === accountId);
    if (account?.mode === "mock") await processPublishQueue({ workspaceId: workspace.id });
  } catch (error) {
    fail(`/app/reach/${id}`, messageOf(error, "Could not launch the hook test"));
  }
  redirect(`/app/reach/${id}?ok=launched`);
}

export async function refreshExperimentAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  const id = text(formData, "experimentId");
  let snapshots = 0;
  try {
    snapshots = (await refreshMetrics(workspace.id)).snapshots;
  } catch {
    fail(`/app/reach/${id}`, "Could not refresh metrics");
  }
  redirect(`/app/reach/${id}?refreshed=${snapshots}`);
}

export async function decideExperimentAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const id = text(formData, "experimentId");
  try {
    await decideExperiment({ workspaceId: workspace.id, experimentId: id, actor: user.id });
  } catch (error) {
    fail(`/app/reach/${id}`, messageOf(error, "Could not pick a winner"));
  }
  redirect(`/app/reach/${id}?ok=decided`);
}

export async function cancelExperimentAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const id = text(formData, "experimentId");
  try {
    await cancelExperiment({ workspaceId: workspace.id, experimentId: id, actor: user.id });
  } catch (error) {
    fail(`/app/reach/${id}`, messageOf(error, "Could not cancel"));
  }
  redirect(`/app/reach/${id}`);
}

// --- Knowledge -------------------------------------------------------------

export async function addTileAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await addTile({
      workspaceId: workspace.id,
      kind: text(formData, "kind"),
      title: text(formData, "title"),
      body: text(formData, "body"),
      actor: user.id,
    });
  } catch (error) {
    fail("/app/knowledge", messageOf(error, "Could not save the tile"));
  }
  redirect("/app/knowledge?ok=added");
}

export async function archiveTileAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await archiveTile(workspace.id, text(formData, "tileId"), user.id);
  } catch (error) {
    fail("/app/knowledge", messageOf(error, "Could not archive the tile"));
  }
  redirect("/app/knowledge");
}

export async function pinTileAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  try {
    await togglePin(workspace.id, text(formData, "tileId"));
  } catch (error) {
    fail("/app/knowledge", messageOf(error, "Could not pin the tile"));
  }
  redirect("/app/knowledge");
}

export async function seedTilesAction() {
  const { user, workspace } = await requireWorkspace();
  const added = await seedFromBrief(workspace.id, workspace.brief, user.id);
  redirect(`/app/knowledge?seeded=${added}`);
}

// --- Ad hand-offs ----------------------------------------------------------

export async function startHandoffAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const kind = text(formData, "kind") === "meta_partnership" ? "meta_partnership" : "tiktok_spark";
  try {
    await startHandoff({
      workspaceId: workspace.id,
      videoId: text(formData, "videoId"),
      kind,
      creatorHandle: text(formData, "creatorHandle"),
      actor: user.id,
    });
  } catch (error) {
    fail("/app/reach", messageOf(error, "Could not start the hand-off"));
  }
  redirect("/app/reach?ok=handoff#handoffs");
}

export async function recordSparkCodeAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await recordSparkCode({ workspaceId: workspace.id, handoffId: text(formData, "handoffId"), code: text(formData, "code"), actor: user.id });
  } catch (error) {
    fail("/app/reach", messageOf(error, "Could not save the code"));
  }
  redirect("/app/reach?ok=code#handoffs");
}

export async function markPartnershipReadyAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await markPartnershipReady({
      workspaceId: workspace.id,
      handoffId: text(formData, "handoffId"),
      actor: user.id,
      confirmed: text(formData, "confirm") === "on",
    });
  } catch (error) {
    fail("/app/reach", messageOf(error, "Could not mark it ready"));
  }
  redirect("/app/reach?ok=ready#handoffs");
}

export async function revokeHandoffAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await revokeHandoff({ workspaceId: workspace.id, handoffId: text(formData, "handoffId"), actor: user.id });
  } catch (error) {
    fail("/app/reach", messageOf(error, "Could not revoke"));
  }
  redirect("/app/reach#handoffs");
}

// --- Creator briefs --------------------------------------------------------

export async function saveCreatorBriefAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const platforms = (["tiktok", "instagram", "facebook"] as const).filter((p) => formData.get(`platform-${p}`) === "on");
  const marketplaces = MARKETPLACES.filter((m) => formData.get(`market-${m}`) === "on") as Marketplace[];
  try {
    await saveCreatorBrief({
      workspaceId: workspace.id,
      brand: workspace.brief,
      videoId: text(formData, "videoId") || null,
      actor: user.id,
      form: {
        title: text(formData, "title"),
        budgetUsd: Number(text(formData, "budgetUsd")),
        videoCount: Number(text(formData, "videoCount")),
        lengthS: Number(text(formData, "lengthS")),
        platforms,
        usageRightsDays: Number(text(formData, "usageRightsDays")),
        allowSparkAds: formData.get("allowSparkAds") === "on",
        allowPartnershipAds: formData.get("allowPartnershipAds") === "on",
        dueDate: text(formData, "dueDate"),
        marketplaces,
      },
    });
  } catch (error) {
    fail("/app/creators", messageOf(error, "Could not save the brief"));
  }
  redirect("/app/creators?ok=saved");
}
