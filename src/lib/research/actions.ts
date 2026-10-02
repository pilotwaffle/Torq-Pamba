"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { safeNext } from "@/lib/auth/redirects";
import { ProviderUnavailableError } from "@/lib/providers/types";
import { addAccount, archiveAccount, syncAccount } from "./accounts";
import { makeVideoFromIdea } from "./handoff";
import { generateIdeas, setIdeaStatus, type IdeaStatus } from "./ideas";
import { refreshDiscover, workspaceNiche } from "./posts";
import { refreshTrends } from "./trends";
import { PLATFORMS, ResearchError, type SocialPlatform } from "./types";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function platformField(formData: FormData): SocialPlatform | null {
  const value = field(formData, "platform");
  return PLATFORMS.includes(value as SocialPlatform) ? (value as SocialPlatform) : null;
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ResearchError) return error.message;
  if (error instanceof ProviderUnavailableError) return `The research source is unavailable (${error.message.slice(0, 120)})`;
  return fallback;
}

function back(path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path);
}

export async function addAccountAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  let accountId: string;
  try {
    const account = await addAccount({
      workspaceId: workspace.id,
      userId: user.id,
      input: field(formData, "account"),
      platform: platformField(formData),
      kind: field(formData, "kind") === "competitor" ? "competitor" : "inspiration",
      notes: field(formData, "notes"),
    });
    accountId = account.id;
  } catch (error) {
    back("/app/research/accounts", { error: userMessage(error, "Could not add that account") });
  }
  redirect(`/app/research/accounts/${accountId}`);
}

export async function syncAccountAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  const id = field(formData, "accountId");
  try {
    await syncAccount(workspace.id, id);
  } catch (error) {
    back("/app/research/accounts", { error: userMessage(error, "Could not refresh that account") });
  }
  redirect(`/app/research/accounts/${encodeURIComponent(id)}`);
}

export async function archiveAccountAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  await archiveAccount(workspace.id, user.id, field(formData, "accountId"));
  redirect("/app/research/accounts");
}

export async function refreshDiscoverAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  const niche = field(formData, "niche").trim().slice(0, 120) || workspaceNiche(workspace.brief);
  const platform = platformField(formData);
  const params: Record<string, string> = { niche };
  if (platform) params.platform = platform;
  try {
    await refreshDiscover({ workspaceId: workspace.id, niche, platform });
  } catch (error) {
    back("/app/research/discover", { ...params, error: userMessage(error, "Could not refresh Discover") });
  }
  back("/app/research/discover", params);
}

export async function refreshTrendsAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  const niche = field(formData, "niche").trim().slice(0, 120) || workspaceNiche(workspace.brief);
  const platform = platformField(formData);
  try {
    await refreshTrends({ workspaceId: workspace.id, niche, platform });
  } catch (error) {
    back("/app/research/trends", { niche, error: userMessage(error, "Could not refresh trends") });
  }
  back("/app/research/trends", { niche });
}

export async function generateIdeasAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  const count = Number(field(formData, "count") || 5);
  try {
    await generateIdeas({
      workspace,
      userId: user.id,
      count: Number.isFinite(count) ? count : 5,
      viralPostId: field(formData, "viralPostId") || null,
      trendId: field(formData, "trendId") || null,
    });
  } catch (error) {
    back("/app/research", { error: userMessage(error, "Could not generate ideas") });
  }
  redirect("/app/research");
}

const STATUSES = new Set<IdeaStatus>(["new", "saved", "dismissed"]);

export async function setIdeaStatusAction(formData: FormData) {
  const { workspace } = await requireWorkspace();
  const status = field(formData, "status") as IdeaStatus;
  if (STATUSES.has(status)) await setIdeaStatus(workspace.id, field(formData, "ideaId"), status);
  redirect(safeNext(field(formData, "returnTo"), "/app/research"));
}

export async function makeVideoAction(formData: FormData) {
  const { user, workspace } = await requireWorkspace();
  try {
    await makeVideoFromIdea({ workspace, userId: user.id, ideaId: field(formData, "ideaId") });
  } catch (error) {
    back("/app/research", { error: userMessage(error, "Could not plan that video") });
  }
  redirect("/app/chat");
}
