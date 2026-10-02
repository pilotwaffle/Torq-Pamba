import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "@/db";
import { workspaces, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

/** Thrown when the webhook endpoint is called but STRIPE_WEBHOOK_SECRET is unset. */
export class WebhookNotConfiguredError extends BillingError {
  constructor() {
    super("STRIPE_WEBHOOK_SECRET is not set. Unsigned webhooks are refused.");
    this.name = "WebhookNotConfiguredError";
  }
}

export type PaidPlan = "creator" | "studio";

export const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    monthlyUsd: 0,
    blurb: "1 preview clip",
    placeholder: true,
    paid: false,
  },
  {
    id: "creator" as const,
    name: "Creator",
    monthlyUsd: 29,
    blurb: "One brand, with room to iterate",
    placeholder: true,
    paid: true,
  },
  {
    id: "studio" as const,
    name: "Studio",
    monthlyUsd: 99,
    blurb: "A team sharing one workspace",
    placeholder: true,
    paid: true,
  },
];

export const STRIPE_TEST_BANNER = "Stripe test mode";
export const SIMULATED_BILLING_BANNER = "No Stripe key — simulated test-mode billing";

export function assertTestMode(secretKey = process.env.STRIPE_SECRET_KEY): void {
  if (secretKey?.trim().startsWith("sk_live_")) {
    throw new BillingError("Refusing sk_live_ keys. Torq-Pamba runs Stripe in test mode only.");
  }
}

export function billingBanner(secretKey = process.env.STRIPE_SECRET_KEY): string {
  const key = secretKey?.trim() ?? "";
  assertTestMode(key);
  return key ? STRIPE_TEST_BANNER : SIMULATED_BILLING_BANNER;
}

export function isPaidPlan(value: string): value is PaidPlan {
  return value === "creator" || value === "studio";
}

export function checkoutSessionParams(input: {
  workspaceId: string;
  plan: PaidPlan;
  priceId: string;
  origin: string;
  customerId?: string | null;
}) {
  const origin = input.origin.replace(/\/$/, "");
  return {
    mode: "subscription" as const,
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${origin}/app/billing?checkout=success`,
    cancel_url: `${origin}/app/billing?checkout=canceled`,
    client_reference_id: input.workspaceId,
    metadata: { workspaceId: input.workspaceId, plan: input.plan },
    ...(input.customerId ? { customer: input.customerId } : {}),
  };
}

function priceIdFor(plan: PaidPlan): string {
  const raw = plan === "creator" ? process.env.STRIPE_PRICE_CREATOR : process.env.STRIPE_PRICE_STUDIO;
  const priceId = raw?.trim() ?? "";
  if (!priceId) {
    throw new BillingError(plan === "creator" ? "STRIPE_PRICE_CREATOR is not set" : "STRIPE_PRICE_STUDIO is not set");
  }
  return priceId;
}

export async function createCheckout(
  workspace: Workspace,
  plan: PaidPlan,
  origin = "http://localhost:3000",
): Promise<{ url: string }> {
  assertTestMode();
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key) {
    const db = await getDb();
    const [row] = await db
      .update(workspaces)
      .set({ plan, updatedAt: new Date() })
      .where(eq(workspaces.id, workspace.id))
      .returning({ id: workspaces.id });
    if (!row) throw new BillingError("Workspace not found");
    await writeAudit({
      workspaceId: workspace.id,
      actor: "billing",
      action: "billing.simulated_upgrade",
      data: { plan, simulated: true },
    });
    return { url: "/app/billing?simulated=1" };
  }

  const params = checkoutSessionParams({
    workspaceId: workspace.id,
    plan,
    priceId: priceIdFor(plan),
    origin,
    customerId: workspace.stripeCustomerId,
  });
  const stripe = new Stripe(key);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(params);
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError("Stripe checkout could not be started");
  }
  if (!session.url) throw new BillingError("Stripe did not return a checkout URL");
  return { url: session.url };
}

function customerIdOf(session: Stripe.Checkout.Session): string | null {
  const customer = session.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer) return customer.id;
  return null;
}

async function applyCheckoutSession(session: Stripe.Checkout.Session): Promise<boolean> {
  const plan = session.metadata?.plan;
  if (plan !== "creator" && plan !== "studio") return false;
  const workspaceId = session.metadata?.workspaceId || session.client_reference_id;
  if (!workspaceId) throw new BillingError("Checkout session is missing a workspace");

  const db = await getDb();
  const stripeCustomerId = customerIdOf(session);
  const [row] = await db
    .update(workspaces)
    .set({
      plan,
      updatedAt: new Date(),
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id });
  if (!row) throw new BillingError("Workspace not found");

  await writeAudit({
    workspaceId,
    actor: "stripe",
    action: "billing.checkout_completed",
    data: { plan, sessionId: session.id },
  });
  return true;
}

export async function handleWebhook(payload: string, signature: string | null): Promise<{ applied: boolean }> {
  assertTestMode();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  // Fail closed: without a signing secret no event is trusted, signed or not.
  if (!secret) throw new WebhookNotConfiguredError();
  if (!signature) throw new BillingError("Missing Stripe signature");
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError("Webhook signature verification failed");
  }

  if (event.type !== "checkout.session.completed") return { applied: false };
  const applied = await applyCheckoutSession(event.data.object);
  return { applied };
}
