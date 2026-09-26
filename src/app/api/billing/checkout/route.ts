import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, createCheckout, isPaidPlan } from "@/lib/billing";

export const dynamic = "force-dynamic";

async function readPlan(request: Request): Promise<string> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json()) as { plan?: unknown };
    return typeof body.plan === "string" ? body.plan : "";
  }
  const form = await request.formData();
  return String(form.get("plan") ?? "");
}

export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  const plan = await readPlan(request);
  const fail = (message: string, status = 400) => {
    const wantsJson = (request.headers.get("accept") ?? "").includes("application/json") &&
      (request.headers.get("content-type") ?? "").includes("application/json");
    if (wantsJson) return NextResponse.json({ error: message }, { status });
    return NextResponse.redirect(new URL(`/app/billing?error=${encodeURIComponent(message)}`, request.url), 303);
  };

  if (!isPaidPlan(plan)) return fail("Unknown plan");

  try {
    const result = await createCheckout(workspace, plan, new URL(request.url).origin);
    const wantsJson =
      (request.headers.get("content-type") ?? "").includes("application/json");
    if (wantsJson) return NextResponse.json({ url: result.url });
    return NextResponse.redirect(new URL(result.url, request.url), 303);
  } catch (error) {
    if (error instanceof BillingError) return fail(error.message);
    throw error;
  }
}
