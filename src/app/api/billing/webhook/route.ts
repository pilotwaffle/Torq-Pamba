import { NextResponse } from "next/server";
import { BillingError, handleWebhook } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const result = await handleWebhook(payload, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, applied: result.applied });
  } catch (error) {
    const message = error instanceof BillingError ? error.message : "Invalid webhook";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
