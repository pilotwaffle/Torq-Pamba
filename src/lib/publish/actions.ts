"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { refreshMetrics } from "@/lib/analytics";
import { AccountError, beginOAuth, connectMockAccount, disconnectAccount } from "./accounts";
import { isPlatform, isPublishLive } from "./config";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function requireManager() {
  const context = await requireWorkspace();
  if (context.role !== "owner" && context.role !== "admin") {
    redirect(`/app/accounts?error=${encodeURIComponent("Only an owner or admin can change connected accounts.")}`);
  }
  return context;
}

export async function connectAccountAction(formData: FormData) {
  const { user, workspace } = await requireManager();
  const platform = text(formData, "platform");
  if (!isPlatform(platform)) redirect(`/app/accounts?error=${encodeURIComponent("Unknown platform")}`);
  if (isPublishLive(platform)) {
    let url = "";
    try {
      const started = beginOAuth(platform, workspace.id);
      const jar = await cookies();
      jar.set(`tp_oauth_${platform}`, started.verifier, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 600,
        path: "/api/oauth",
      });
      url = started.url;
    } catch (error) {
      const message = error instanceof AccountError ? error.message : "Could not start OAuth";
      redirect(`/app/accounts?error=${encodeURIComponent(message)}`);
    }
    redirect(url);
  }
  await connectMockAccount({ workspaceId: workspace.id, platform, userId: user.id });
  redirect("/app/accounts?connected=1");
}

export async function disconnectAccountAction(formData: FormData) {
  const { user, workspace } = await requireManager();
  try {
    await disconnectAccount(workspace.id, text(formData, "accountId"), user.id);
  } catch (error) {
    const message = error instanceof AccountError ? error.message : "Could not disconnect";
    redirect(`/app/accounts?error=${encodeURIComponent(message)}`);
  }
  redirect("/app/accounts");
}

export async function refreshAnalyticsAction() {
  const { workspace } = await requireWorkspace();
  let query = "";
  try {
    const result = await refreshMetrics(workspace.id);
    query = `refreshed=${result.snapshots}`;
  } catch (error) {
    query = `error=${encodeURIComponent(error instanceof Error ? error.message.slice(0, 200) : "Refresh failed")}`;
  }
  redirect(`/app/analytics?${query}`);
}
