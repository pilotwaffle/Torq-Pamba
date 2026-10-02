"use server";

import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/guards";
import { createAuthorizationCode, OAuthError, PENDING_COOKIE, redirectWith, validateAuthorizeRequest } from "./authserver";
import { createApiKey, CredentialError, revokeGrant, type Scope } from "./credentials";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function capFrom(formData: FormData): number | null {
  const raw = text(formData, "spendCapUsd").trim();
  return raw ? Number(raw) : null;
}

async function requireManager(path: string) {
  const context = await requireWorkspace();
  if (context.role !== "owner" && context.role !== "admin") {
    redirect(`${path}?error=${encodeURIComponent("Only an owner or admin can manage API access.")}`);
  }
  return context;
}

export async function createApiKeyAction(
  _previous: { key?: string; error?: string } | undefined,
  formData: FormData,
): Promise<{ key?: string; prefix?: string; error?: string }> {
  const { user, workspace } = await requireManager("/app/settings/api");
  try {
    const scope: Scope = text(formData, "scope") === "write" ? "write" : "read";
    const created = await createApiKey({ workspaceId: workspace.id, name: text(formData, "name"), scope, spendCapUsd: capFrom(formData), actor: user.id });
    return { key: created.key, prefix: created.credential.prefix };
  } catch (error) {
    return { error: error instanceof CredentialError ? error.message : "Could not create the key" };
  }
}

export async function revokeApiKeyAction(formData: FormData) {
  const { user, workspace } = await requireManager("/app/settings/api");
  try {
    await revokeGrant(workspace.id, text(formData, "credentialId"), user.id);
  } catch (error) {
    redirect(`/app/settings/api?error=${encodeURIComponent(error instanceof CredentialError ? error.message : "Could not revoke")}`);
  }
  redirect("/app/settings/api?revoked=1");
}

async function pendingRequest() {
  const jar = await cookies();
  const raw = jar.get(PENDING_COOKIE)?.value ?? "";
  const head = await headers();
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || `${head.get("x-forwarded-proto") ?? "http"}://${head.get("host") ?? "localhost"}`;
  return { raw, base, jar };
}

export async function approveOAuthAction(formData: FormData) {
  const { user, workspace, role } = await requireWorkspace();
  const { raw, base, jar } = await pendingRequest();
  let target = "";
  try {
    const request = await validateAuthorizeRequest(new URLSearchParams(raw), base);
    const wantsWrite = request.scope === "write" && text(formData, "grantWrite") === "on";
    if (wantsWrite && role !== "owner" && role !== "admin") throw new OAuthError("access_denied", "Only an owner or admin can grant write access");
    const scope: Scope = wantsWrite ? "write" : "read";
    const code = await createAuthorizationCode({
      request,
      workspaceId: workspace.id,
      userId: user.id,
      scope,
      spendCapUsd: scope === "write" ? capFrom(formData) : null,
    });
    target = redirectWith(request.redirectUri, { code, state: request.state });
  } catch (error) {
    const message = error instanceof OAuthError || error instanceof CredentialError ? error.message : "Could not authorize";
    redirect(`/oauth/consent?error=${encodeURIComponent(message)}`);
  }
  jar.delete(PENDING_COOKIE);
  redirect(target);
}

export async function denyOAuthAction() {
  await requireWorkspace();
  const { raw, base, jar } = await pendingRequest();
  let target = "/app";
  try {
    const request = await validateAuthorizeRequest(new URLSearchParams(raw), base);
    target = redirectWith(request.redirectUri, { error: "access_denied", state: request.state });
  } catch {
    target = "/app";
  }
  jar.delete(PENDING_COOKIE);
  redirect(target);
}
