import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth/session";
import { OAuthError, PENDING_COOKIE, publicBase, redirectWith, validateAuthorizeRequest } from "@/lib/platform/authserver";

export const dynamic = "force-dynamic";

/**
 * Validates the authorization request, parks it in a short-lived httpOnly
 * cookie, and sends the user to the consent page (through login when needed).
 * Errors about the client or redirect URI are shown here and never redirected.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = publicBase(request);
  try {
    await validateAuthorizeRequest(url.searchParams, base);
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error;
    if (error.error === "invalid_client" || /redirect_uri/.test(error.message)) {
      return new Response(`Authorization request rejected: ${error.message}`, { status: 400, headers: { "content-type": "text/plain" } });
    }
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    return NextResponse.redirect(
      redirectWith(redirectUri, { error: error.error, error_description: error.message, state: url.searchParams.get("state") ?? "" }),
    );
  }
  const session = await readSession();
  const target = new URL(session ? "/oauth/consent" : "/login?next=/oauth/consent", base);
  const response = NextResponse.redirect(target);
  response.cookies.set(PENDING_COOKIE, url.searchParams.toString(), {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return response;
}
