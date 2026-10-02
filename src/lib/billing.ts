import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "@/db";
import { workspaces, type Workspace } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  attachTopUpSession,
  completeTopUp,
  createTopUp,
  failTopUp,
  grantPlanCredits,
  setWorkspacePlan,
} from "@/lib/credits/account";
import { CreditsError } from "@/lib/credits/ledger";
import { simulatedBillingAllowed, stripeSecretKey } from "@/lib/credits/mode";
import {
  findTopUpPack,
  isPaidPlanId,
  PLANS as CREDIT_PLANS,
  toPlanId,
  type PaidPlanId,
  type PlanId,
  type TopUpPack,
} from "@/lib/credits/plans";
import { formatCredits } from "@/lib/credits/pricing";
import { allowsInsecureLocalEndpoints } from "@/lib/local-mode";

export class BillingError extends Error {
  readonly status: number = 400;

  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

export class WebhookUnauthorizedError extends BillingError {
  override readonly status = 401;
}

/** Credit plans as the public pages show them. Test-mode prices. */
export const PLANS = CREDIT_PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  monthlyUsd: plan.monthlyPriceCents / 100,
  monthlyCredits: plan.monthlyCredits,
  blurb: plan.monthlyCredits > 0 ? `${formatCredits(plan.monthlyCredits)} a month. ${plan.blurb}` : plan.blurb,
  placeholder: true,
  paid: plan.monthlyPriceCents > 0,
}));

export const STRIPE_TEST_BANNER = "Stripe test mode";
export const SIMULATED_BILLING_BANNER =
  "No Stripe key — simulated test-mode billing. Checkout grants credits without payment.";

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

/** Accepts hobby/pro and the legacy creator/studio names. */
export function parsePaidPlan(value: unknown): PaidPlanId | null {
  const planId = toPlanId(value);
  return isPaidPlanId(planId) ? planId : null;
}

function cleanOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

export function subscriptionCheckoutParams(input: {
  workspaceId: string;
  plan: PaidPlanId;
  priceId: string;
  origin: string;
  customerId?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const origin = cleanOrigin(input.origin);
  const metadata = { workspaceId: input.workspaceId, plan: input.plan, kind: "subscription" };
  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${origin}/app/billing?checkout=success`,
    cancel_url: `${origin}/app/billing?checkout=canceled`,
    client_reference_id: input.workspaceId,
    metadata,
    // Copied to each invoice as parent.subscription_details.metadata, which is how invoice.paid finds the workspace.
    subscription_data: { metadata },
    ...(input.customerId ? { customer: input.customerId } : {}),
  };
}

export function topUpCheckoutParams(input: {
  workspaceId: string;
  topUpId: string;
  pack: TopUpPack;
  origin: string;
  customerId?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const origin = cleanOrigin(input.origin);
  const metadata = {
    workspaceId: input.workspaceId,
    kind: "top_up",
    topUpId: input.topUpId,
    credits: String(input.pack.credits),
  };
  return {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: input.pack.amountCents,
          product_data: { name: `${formatCredits(input.pack.credits)} top-up` },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/app/billing?top-up=success`,
    cancel_url: `${origin}/app/billing?top-up=canceled`,
    client_reference_id: input.workspaceId,
    metadata,
    payment_intent_data: { metadata },
    ...(input.customerId ? { customer: input.customerId } : { customer_creation: "always" as const }),
  };
}

const PRICE_ENV: Record<PaidPlanId, string> = {
  hobby: "STRIPE_PRICE_HOBBY",
  pro: "STRIPE_PRICE_PRO",
};

function configuredPriceId(plan: PaidPlanId): string {
  return process.env[PRICE_ENV[plan]]?.trim() ?? "";
}

function priceIdFor(plan: PaidPlanId): string {
  const priceId = configuredPriceId(plan);
  if (!priceId) throw new BillingError(`${PRICE_ENV[plan]} is not set`);
  return priceId;
}

export function planForPrice(priceId: string | null | undefined): PaidPlanId | null {
  if (!priceId) return null;
  if (priceId === configuredPriceId("hobby")) return "hobby";
  if (priceId === configuredPriceId("pro")) return "pro";
  return null;
}

/** A test-mode Stripe client, or null when billing is simulated. */
function stripeClient(): Stripe | null {
  assertTestMode();
  const key = stripeSecretKey();
  if (key) return new Stripe(key);
  if (!simulatedBillingAllowed()) {
    throw new BillingError("Stripe is not configured. Set a test-mode STRIPE_SECRET_KEY.");
  }
  return null;
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Subscribes to a paid plan through Stripe Checkout. With no Stripe key this is
 * the mock checkout: it switches the plan and grants this month's credits once.
 */
export async function createCheckout(
  workspace: Workspace,
  plan: PlanId,
  origin = "http://localhost:3000",
  userId: string | null = null,
): Promise<{ url: string }> {
  const stripe = stripeClient();
  if (!stripe) {
    if (!(await setWorkspacePlan(workspace.id, plan))) throw new BillingError("Workspace not found");
    const grant = isPaidPlanId(plan)
      ? await grantPlanCredits({
          workspaceId: workspace.id,
          planId: plan,
          idempotencyKey: `simulated:plan:${workspace.id}:${plan}:${monthKey()}`,
          createdBy: userId,
        })
      : { applied: false, credits: 0 };
    await writeAudit({
      workspaceId: workspace.id,
      actor: "billing",
      action: "billing.simulated_upgrade",
      data: { plan, simulated: true, creditsGranted: grant.applied ? grant.credits : 0 },
    });
    return { url: "/app/billing?simulated=1" };
  }

  if (!isPaidPlanId(plan)) throw new BillingError("Cancel a paid plan from Manage subscription");
  if (workspace.stripeSubscriptionId) {
    throw new BillingError("This workspace already has a subscription. Change it from Manage subscription.");
  }
  const params = subscriptionCheckoutParams({
    workspaceId: workspace.id,
    plan,
    priceId: priceIdFor(plan),
    origin,
    customerId: workspace.stripeCustomerId,
  });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(params);
  } catch {
    throw new BillingError("Stripe checkout could not be started");
  }
  if (!session.url) throw new BillingError("Stripe did not return a checkout URL");
  return { url: session.url };
}

/** Buys a one-off credit pack. With no Stripe key the mock checkout marks it paid and grants it at once. */
export async function createTopUpCheckout(
  workspace: Workspace,
  packId: string,
  origin = "http://localhost:3000",
  userId: string | null = null,
): Promise<{ url: string }> {
  const pack = findTopUpPack(packId);
  if (!pack) throw new BillingError("Unknown top-up pack");
  const stripe = stripeClient();
  const topUp = await createTopUp({ workspaceId: workspace.id, pack, createdBy: userId });

  if (!stripe) {
    await completeTopUp({ topUpId: topUp.id, workspaceId: workspace.id, amountCents: pack.amountCents });
    await writeAudit({
      workspaceId: workspace.id,
      actor: "billing",
      action: "billing.simulated_top_up",
      data: { topUpId: topUp.id, credits: pack.credits, simulated: true },
    });
    return { url: "/app/billing?simulated=top-up" };
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      topUpCheckoutParams({
        workspaceId: workspace.id,
        topUpId: topUp.id,
        pack,
        origin,
        customerId: workspace.stripeCustomerId,
      }),
      { idempotencyKey: `top-up-${topUp.id}` },
    );
  } catch {
    await failTopUp(topUp.id);
    throw new BillingError("Stripe checkout could not be started");
  }
  if (!session.url) {
    await failTopUp(topUp.id);
    throw new BillingError("Stripe did not return a checkout URL");
  }
  await attachTopUpSession(topUp.id, session.id);
  return { url: session.url };
}

/** Stripe's hosted portal for changing or canceling a subscription. */
export async function createPortalSession(workspace: Workspace, origin = "http://localhost:3000"): Promise<{ url: string }> {
  const stripe = stripeClient();
  if (!stripe) throw new BillingError("Manage subscription needs a Stripe test key");
  if (!workspace.stripeCustomerId) throw new BillingError("This workspace has no Stripe customer yet");
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: `${cleanOrigin(origin)}/app/billing`,
    });
    return { url: session.url };
  } catch {
    throw new BillingError("The Stripe billing portal could not be opened");
  }
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return value.id;
  return null;
}

async function workspaceIdBy(column: "stripeCustomerId" | "stripeSubscriptionId", value: string | null): Promise<string | null> {
  if (!value) return null;
  const db = await getDb();
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces[column], value))
    .limit(1);
  return row?.id ?? null;
}

async function applyCheckoutSession(session: Stripe.Checkout.Session): Promise<boolean> {
  const workspaceId = session.metadata?.workspaceId || session.client_reference_id;
  if (!workspaceId) throw new BillingError("Checkout session is missing a workspace");
  const stripeCustomerId = idOf(session.customer);

  if (session.metadata?.kind === "top_up") {
    // Delayed payment methods finish later through checkout.session.async_payment_succeeded.
    if (session.payment_status !== "paid") return false;
    const topUpId = session.metadata.topUpId;
    if (!topUpId) throw new BillingError("Top-up checkout is missing its top-up id");
    const result = await completeTopUp({
      topUpId,
      workspaceId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: idOf(session.payment_intent),
      amountCents: session.amount_total,
      currency: session.currency,
    });
    if (stripeCustomerId) {
      const db = await getDb();
      await db.update(workspaces).set({ stripeCustomerId }).where(eq(workspaces.id, workspaceId));
    }
    if (result.applied) {
      await writeAudit({
        workspaceId,
        actor: "stripe",
        action: "billing.top_up_paid",
        data: { topUpId, credits: result.credits, sessionId: session.id },
      });
    }
    return result.applied;
  }

  // Subscriptions: this links the customer and subscription. Credits arrive with invoice.paid.
  const plan = parsePaidPlan(session.metadata?.plan);
  if (!plan) return false;
  const subscriptionId = idOf(session.subscription);
  const updated = await setWorkspacePlan(workspaceId, plan, {
    ...(stripeCustomerId ? { stripeCustomerId } : {}),
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
  });
  if (!updated) throw new BillingError("Workspace not found");
  await writeAudit({
    workspaceId,
    actor: "stripe",
    action: "billing.checkout_completed",
    data: { plan, sessionId: session.id },
  });
  return true;
}

/** First invoice and each renewal grant the plan's monthly credits. Mid-cycle plan changes do not. */
const GRANTING_INVOICE_REASONS = new Set(["subscription_create", "subscription_cycle"]);

/** Monthly credits arrive with each paid subscription invoice, once per invoice id. */
async function applyInvoicePaid(invoice: Stripe.Invoice): Promise<boolean> {
  if (!invoice.id || !GRANTING_INVOICE_REASONS.has(invoice.billing_reason ?? "")) return false;
  const details = invoice.parent?.subscription_details ?? null;
  const subscriptionId = idOf(details?.subscription);
  const stripeCustomerId = idOf(invoice.customer);
  const workspaceId =
    details?.metadata?.workspaceId ||
    (await workspaceIdBy("stripeSubscriptionId", subscriptionId)) ||
    (await workspaceIdBy("stripeCustomerId", stripeCustomerId));
  if (!workspaceId) throw new BillingError("Invoice does not match a workspace");

  const lines = invoice.lines?.data ?? [];
  const plan =
    lines.map((line) => planForPrice(idOf(line.pricing?.price_details?.price))).find(Boolean) ??
    parsePaidPlan(details?.metadata?.plan);
  if (!plan) throw new BillingError("Invoice does not match a plan");
  const periodEnd = lines.reduce((latest, line) => Math.max(latest, line.period?.end ?? 0), 0);

  const updated = await setWorkspacePlan(workspaceId, plan, {
    ...(stripeCustomerId ? { stripeCustomerId } : {}),
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    ...(periodEnd ? { planPeriodEndsAt: new Date(periodEnd * 1000) } : {}),
  });
  if (!updated) throw new BillingError("Workspace not found");
  const grant = await grantPlanCredits({ workspaceId, planId: plan, idempotencyKey: `stripe:invoice:${invoice.id}` });
  if (grant.applied) {
    await writeAudit({
      workspaceId,
      actor: "stripe",
      action: "billing.plan_credits_granted",
      data: { plan, credits: grant.credits, invoiceId: invoice.id },
    });
  }
  return grant.applied;
}

const ENDED_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

async function applySubscription(subscription: Stripe.Subscription, deleted: boolean): Promise<boolean> {
  const workspaceId =
    subscription.metadata?.workspaceId || (await workspaceIdBy("stripeSubscriptionId", subscription.id));
  if (!workspaceId) return false;
  const db = await getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return false;
  // An event for an older, replaced subscription must not touch the current one.
  if (workspace.stripeSubscriptionId && workspace.stripeSubscriptionId !== subscription.id) return false;

  if (deleted || ENDED_STATUSES.has(subscription.status)) {
    // Credits already granted stay; only future monthly grants stop.
    await setWorkspacePlan(workspaceId, "free", { stripeSubscriptionId: null, planPeriodEndsAt: null });
    await writeAudit({
      workspaceId,
      actor: "stripe",
      action: "billing.subscription_ended",
      data: { subscriptionId: subscription.id, status: subscription.status },
    });
    return true;
  }

  const item = subscription.items?.data?.[0];
  const plan = planForPrice(item?.price?.id) ?? parsePaidPlan(subscription.metadata?.plan);
  if (!plan) return false;
  await setWorkspacePlan(workspaceId, plan, {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: idOf(subscription.customer),
    ...(item?.current_period_end ? { planPeriodEndsAt: new Date(item.current_period_end * 1000) } : {}),
  });
  await writeAudit({
    workspaceId,
    actor: "stripe",
    action: "billing.subscription_updated",
    data: { plan, subscriptionId: subscription.id, status: subscription.status },
  });
  return true;
}

function parseUnsignedEvent(payload: string): Stripe.Event {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new BillingError("Webhook payload is not JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new BillingError("Webhook payload is not a Stripe event");
  const event = parsed as Stripe.Event;
  if (event.object !== "event" || typeof event.type !== "string" || !event.data) {
    throw new BillingError("Webhook payload is not a Stripe event");
  }
  return event;
}

/**
 * Verifies and applies one Stripe event. Every grant is keyed by a Stripe id
 * (invoice, top-up), so redelivered or concurrent copies of an event apply once.
 */
export async function handleWebhook(payload: string, signature: string | null): Promise<{ applied: boolean }> {
  assertTestMode();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  let event: Stripe.Event;
  if (!secret && !allowsInsecureLocalEndpoints()) {
    throw new WebhookUnauthorizedError("STRIPE_WEBHOOK_SECRET is not set; refusing unsigned webhooks");
  }
  if (secret) {
    if (!signature) throw new BillingError("Missing Stripe signature");
    try {
      event = Stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      throw new BillingError("Webhook signature verification failed");
    }
  } else {
    event = parseUnsignedEvent(payload);
  }
  if (event.livemode) throw new BillingError("Refusing a live-mode event. Torq-Pamba runs Stripe in test mode only.");

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return { applied: await applyCheckoutSession(event.data.object) };
      case "invoice.paid":
        return { applied: await applyInvoicePaid(event.data.object) };
      case "customer.subscription.updated":
        return { applied: await applySubscription(event.data.object, false) };
      case "customer.subscription.deleted":
        return { applied: await applySubscription(event.data.object, true) };
      default:
        return { applied: false };
    }
  } catch (error) {
    if (error instanceof CreditsError) throw new BillingError(error.message);
    throw error;
  }
}
