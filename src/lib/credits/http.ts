import { NextResponse } from "next/server";

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes("application/json");
}

/** Reads one string field from a JSON body or a form post. */
export async function readField(request: Request, name: string): Promise<string> {
  try {
    if (isJson(request)) {
      const body = (await request.json()) as Record<string, unknown>;
      return typeof body[name] === "string" ? body[name] : "";
    }
    const form = await request.formData();
    return String(form.get(name) ?? "");
  } catch {
    return "";
  }
}

/** JSON callers get `{ url }`; form posts are redirected to it. */
export function redirectTo(request: Request, url: string): NextResponse {
  if (isJson(request)) return NextResponse.json({ url });
  return NextResponse.redirect(new URL(url, request.url), 303);
}

export function billingError(request: Request, message: string, status = 400): NextResponse {
  if (isJson(request)) return NextResponse.json({ error: message }, { status });
  return NextResponse.redirect(new URL(`/app/billing?error=${encodeURIComponent(message)}`, request.url), 303);
}
