import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/guards";
import { AccountError, completeOAuth } from "@/lib/publish/accounts";
import { isPlatform } from "@/lib/publish/config";
import { OAuthStateError } from "@/lib/publish/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const back = (query: string) => NextResponse.redirect(new URL(`/app/accounts?${query}`, request.url), 303);
  if (!isPlatform(platform)) return back(`error=${encodeURIComponent("Unknown platform")}`);
  const { user, workspace } = await requireWorkspace();
  const url = new URL(request.url);
  const denied = url.searchParams.get("error");
  if (denied) return back(`error=${encodeURIComponent(`Authorization was not granted (${denied.slice(0, 80)})`)}`);
  const jar = await cookies();
  const verifier = jar.get(`tp_oauth_${platform}`)?.value ?? "";
  jar.delete(`tp_oauth_${platform}`);
  try {
    await completeOAuth(platform, {
      code: url.searchParams.get("code") ?? "",
      state: url.searchParams.get("state") ?? "",
      verifier,
      userId: user.id,
      workspaceId: workspace.id,
    });
  } catch (error) {
    const message =
      error instanceof AccountError || error instanceof OAuthStateError ? error.message : "Could not finish connecting the account";
    return back(`error=${encodeURIComponent(message)}`);
  }
  return back("connected=1");
}
