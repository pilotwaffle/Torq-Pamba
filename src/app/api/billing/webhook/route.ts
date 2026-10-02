import { NextResponse } from "next/server";
import { BillingError, handleWebhook } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  try {
    const result = await handleWebhook(payload, request.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, applied: result.applied });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
