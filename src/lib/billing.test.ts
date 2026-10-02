import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { creditLedger, creditTopUps, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import {
  PLANS,
  SIMULATED_BILLING_BANNER,
  STRIPE_TEST_BANNER,
  assertTestMode,
  billingBanner,
  createCheckout,
  createTopUpCheckout,
  handleWebhook,
  subscriptionCheckoutParams,
  topUpCheckoutParams,
} from "@/lib/billing";
import { createTopUp } from "@/lib/credits/account";
import { getCreditBalance } from "@/lib/credits/ledger";
import { SIMULATED_STARTER_CREDITS } from "@/lib/credits/mode";
import { findTopUpPack } from "@/lib/credits/plans";

const password = "correct-horse-battery";
const secret = "whsec_test_secret";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function freshWorkspace(label: string) {
  const { workspace } = await signupAccount({ email: email(label), password, workspaceName: `${label} Co` });
  return workspace;
}

async function workspaceRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row!;
}

async function ledgerOf(workspaceId: string) {
  const db = await getDb();
  return db.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspaceId));
}

let eventCounter = 0;

function event(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  eventCounter += 1;
  return JSON.stringify({ id: `evt_test_${eventCounter}`, object: "event", livemode: false, type, data: { object }, ...extra });
}

function signed(payload: string) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

/** A paid subscription invoice in the shape of API version 2026-08-26.dahlia (parent.subscription_details). */
function invoice(input: {
  id: string;
  workspaceId?: string;
  plan?: string;
  priceId?: string;
  reason?: string;
  subscription?: string;
  customer?: string;
}) {
  return {
    id: input.id,
    object: "invoice",
    billing_reason: input.reason ?? "subscription_create",
    customer: input.customer ?? "cus_test_1",
    status: "paid",
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: input.subscription ?? "sub_test_1",
        metadata: input.workspaceId ? { workspaceId: input.workspaceId, plan: input.plan ?? "hobby" } : {},
      },
    },
    lines: {
      object: "list",
      data: [
        {
          id: "il_1",
          object: "line_item",
          period: { start: 1_790_000_000, end: 1_792_592_000 },
          pricing: { type: "price_details", price_details: { price: input.priceId ?? "price_hobby_test", product: "prod_1" } },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRICE_HOBBY", "price_hobby_test");
  vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("plans and test mode", () => {
  it("lists the credit plans at Pamba's prices", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyUsd, plan.monthlyCredits, plan.paid])).toEqual([
      ["free", 0, 0, false],
      ["hobby", 16, 1600, true],
      ["pro", 100, 10000, true],
    ]);
  });

  it("refuses sk_live_ keys everywhere", async () => {
    expect(() => assertTestMode("sk_live_abc")).toThrow(/sk_live_/);
    expect(() => billingBanner("sk_live_abc")).toThrow(/sk_live_/);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    const workspace = await freshWorkspace("live");
    await expect(createCheckout(workspace, "hobby")).rejects.toThrow(/sk_live_/);
    await expect(createTopUpCheckout(workspace, "credits-500")).rejects.toThrow(/sk_live_/);
    await expect(handleWebhook("{}", null)).rejects.toThrow(/sk_live_/);
  });

  it("refuses live-mode events even when signed", async () => {
    const workspace = await freshWorkspace("livemode");
    const payload = event("invoice.paid", invoice({ id: "in_live", workspaceId: workspace.id }), { livemode: true });
    await expect(handleWebhook(payload, signed(payload))).rejects.toThrow(/live-mode/);
    expect((await workspaceRow(workspace.id)).planId).toBe("free");
  });
});

describe("mock checkout (no Stripe key)", () => {
  it("switches the plan and grants the month's credits once", async () => {
    expect(billingBanner()).toBe(SIMULATED_BILLING_BANNER);
    const workspace = await freshWorkspace("sim");
    expect(await getCreditBalance(workspace.id)).toBe(SIMULATED_STARTER_CREDITS);
    const result = await createCheckout(workspace, "hobby");
    expect(result.url).toBe("/app/billing?simulated=1");
    await createCheckout(workspace, "hobby");
    const row = await workspaceRow(workspace.id);
    expect(row.planId).toBe("hobby");
    expect(row.plan).toBe("creator");
    expect(row.creditBalance).toBe(SIMULATED_STARTER_CREDITS + 1600);

    await createCheckout(workspace, "pro");
    expect((await workspaceRow(workspace.id)).creditBalance).toBe(SIMULATED_STARTER_CREDITS + 1600 + 10000);
    await createCheckout(workspace, "free");
    expect((await workspaceRow(workspace.id)).planId).toBe("free");
  });

  it("sells a top-up pack and records it as paid", async () => {
    const workspace = await freshWorkspace("sim-top-up");
    await getCreditBalance(workspace.id);
    expect((await createTopUpCheckout(workspace, "credits-2000")).url).toBe("/app/billing?simulated=top-up");
    expect(await getCreditBalance(workspace.id)).toBe(SIMULATED_STARTER_CREDITS + 2000);
    const db = await getDb();
    const [topUp] = await db.select().from(creditTopUps).where(eq(creditTopUps.workspaceId, workspace.id));
    expect(topUp).toMatchObject({ status: "paid", credits: 2000, amountCents: 2000 });
    await expect(createTopUpCheckout(workspace, "credits-1")).rejects.toThrow(/Unknown top-up pack/);
  });

  it("is never offered in a production build with live providers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PROVIDER_MODE", "live");
    const workspace = await freshWorkspace("prod-live");
    await expect(createCheckout(workspace, "hobby")).rejects.toThrow(/STRIPE_SECRET_KEY/);
    await expect(createTopUpCheckout(workspace, "credits-500")).rejects.toThrow(/STRIPE_SECRET_KEY/);
    expect(await getCreditBalance(workspace.id)).toBe(0);
  });
});

describe("Stripe checkout params", () => {
  it("builds a subscription checkout whose metadata reaches every invoice", () => {
    const params = subscriptionCheckoutParams({
      workspaceId: "ws_1",
      plan: "hobby",
      priceId: "price_hobby",
      origin: "http://localhost:3000/",
      customerId: null,
    });
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_hobby", quantity: 1 }]);
    expect(params.metadata).toEqual({ workspaceId: "ws_1", plan: "hobby", kind: "subscription" });
    expect(params.subscription_data?.metadata).toEqual(params.metadata);
    expect(params.success_url).toBe("http://localhost:3000/app/billing?checkout=success");
  });

  it("builds a one-off payment for a top-up at the pack price", () => {
    const pack = findTopUpPack("credits-500")!;
    const params = topUpCheckoutParams({ workspaceId: "ws_1", topUpId: "tu_1", pack, origin: "http://x", customerId: "cus_1" });
    expect(params.mode).toBe("payment");
    expect(params.line_items?.[0]?.price_data).toMatchObject({ currency: "usd", unit_amount: 500 });
    expect(params.metadata).toMatchObject({ kind: "top_up", topUpId: "tu_1", workspaceId: "ws_1" });
    expect(params.customer).toBe("cus_1");
  });

  it("refuses to call Stripe without a price id", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_placeholder");
    vi.stubEnv("STRIPE_PRICE_HOBBY", "");
    expect(billingBanner()).toBe(STRIPE_TEST_BANNER);
    const workspace = await freshWorkspace("price");
    await expect(createCheckout(workspace, "hobby")).rejects.toThrow(/STRIPE_PRICE_HOBBY/);
  });
});

describe("webhook", () => {
  it("rejects a bad signature and a missing one", async () => {
    const workspace = await freshWorkspace("sig");
    const payload = event("invoice.paid", invoice({ id: "in_sig", workspaceId: workspace.id }));
    await expect(handleWebhook(payload, "t=1,v1=deadbeef")).rejects.toThrow(/signature/i);
    await expect(handleWebhook(payload, null)).rejects.toThrow(/signature/i);
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    await expect(handleWebhook(payload, forged)).rejects.toThrow(/signature/i);
    expect(await ledgerOf(workspace.id)).toHaveLength(0);
  });

  it("links the subscription on checkout and grants credits on invoice.paid", async () => {
    const workspace = await freshWorkspace("sub");
    const checkout = event("checkout.session.completed", {
      id: "cs_test_sub",
      object: "checkout.session",
      mode: "subscription",
      metadata: { workspaceId: workspace.id, plan: "hobby", kind: "subscription" },
      client_reference_id: workspace.id,
      customer: "cus_sub",
      subscription: "sub_sub",
    });
    expect(await handleWebhook(checkout, signed(checkout))).toEqual({ applied: true });
    let row = await workspaceRow(workspace.id);
    expect(row).toMatchObject({ planId: "hobby", plan: "creator", stripeCustomerId: "cus_sub", stripeSubscriptionId: "sub_sub" });
    expect(row.creditBalance).toBe(0);

    const paid = event("invoice.paid", invoice({ id: "in_sub_1", subscription: "sub_sub", customer: "cus_sub" }));
    expect(await handleWebhook(paid, signed(paid))).toEqual({ applied: true });
    row = await workspaceRow(workspace.id);
    expect(row.creditBalance).toBe(1600);
    expect(row.planPeriodEndsAt?.getTime()).toBe(1_792_592_000 * 1000);
  });

  it("grants once per invoice however often or concurrently Stripe delivers it", async () => {
    const workspace = await freshWorkspace("idem-hook");
    const object = invoice({ id: `in_idem_${workspace.id}`, workspaceId: workspace.id, plan: "pro", priceId: "price_pro_test" });
    const deliveries = [0, 1, 2, 3, 4].map(() => event("invoice.paid", object));
    const results = await Promise.all(deliveries.map((payload) => handleWebhook(payload, signed(payload))));
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    const again = deliveries[0]!;
    expect(await handleWebhook(again, signed(again))).toEqual({ applied: false });
    const grants = (await ledgerOf(workspace.id)).filter((entry) => entry.kind === "plan_grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ delta: 10000, idempotencyKey: `stripe:invoice:${object.id}` });
    expect((await workspaceRow(workspace.id)).creditBalance).toBe(10000);

    const renewal = event("invoice.paid", { ...object, id: `in_idem_next_${workspace.id}`, billing_reason: "subscription_cycle" });
    expect(await handleWebhook(renewal, signed(renewal))).toEqual({ applied: true });
    expect((await workspaceRow(workspace.id)).creditBalance).toBe(20000);
  });

  it("does not grant for proration invoices or invoices it cannot place", async () => {
    const workspace = await freshWorkspace("proration");
    const update = event("invoice.paid", invoice({ id: "in_update", workspaceId: workspace.id, reason: "subscription_update" }));
    expect(await handleWebhook(update, signed(update))).toEqual({ applied: false });
    const stray = event("invoice.paid", invoice({ id: "in_stray", subscription: "sub_nobody", customer: "cus_nobody" }));
    await expect(handleWebhook(stray, signed(stray))).rejects.toThrow(/workspace/);
    expect(await ledgerOf(workspace.id)).toHaveLength(0);
  });

  it("completes a paid top-up once and checks the amount", async () => {
    const workspace = await freshWorkspace("hook-top-up");
    const pack = findTopUpPack("credits-500")!;
    const topUp = await createTopUp({ workspaceId: workspace.id, pack });
    const session = (overrides: Record<string, unknown>) => ({
      id: `cs_top_${topUp.id}`,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      amount_total: 500,
      currency: "usd",
      customer: "cus_top",
      payment_intent: "pi_top",
      client_reference_id: workspace.id,
      metadata: { workspaceId: workspace.id, kind: "top_up", topUpId: topUp.id, credits: "500" },
      ...overrides,
    });

    const unpaid = event("checkout.session.completed", session({ payment_status: "unpaid" }));
    expect(await handleWebhook(unpaid, signed(unpaid))).toEqual({ applied: false });
    const wrongAmount = event("checkout.session.async_payment_succeeded", session({ amount_total: 1 }));
    await expect(handleWebhook(wrongAmount, signed(wrongAmount))).rejects.toThrow(/amount/);

    const paid = event("checkout.session.async_payment_succeeded", session({}));
    const results = await Promise.all([0, 1, 2].map(() => handleWebhook(paid, signed(paid))));
    expect(results.filter((result) => result.applied)).toHaveLength(1);
    const db = await getDb();
    const [row] = await db.select().from(creditTopUps).where(eq(creditTopUps.id, topUp.id));
    expect(row).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_top" });
    const ws = await workspaceRow(workspace.id);
    expect(ws.creditBalance).toBe(500);
    expect(ws.stripeCustomerId).toBe("cus_top");

    const other = await freshWorkspace("hook-top-up-other");
    const stolen = event(
      "checkout.session.completed",
      session({ metadata: { workspaceId: other.id, kind: "top_up", topUpId: topUp.id }, client_reference_id: other.id }),
    );
    await expect(handleWebhook(stolen, signed(stolen))).rejects.toThrow(/another workspace/);
  });

  it("moves to Free when the subscription ends and ignores a replaced subscription", async () => {
    const workspace = await freshWorkspace("cancel");
    const paid = event("invoice.paid", invoice({ id: `in_c_${workspace.id}`, workspaceId: workspace.id, subscription: "sub_cancel" }));
    await handleWebhook(paid, signed(paid));
    expect((await workspaceRow(workspace.id)).stripeSubscriptionId).toBe("sub_cancel");

    const subscription = (id: string, status: string) => ({
      id,
      object: "subscription",
      status,
      customer: "cus_test_1",
      metadata: { workspaceId: workspace.id, plan: "hobby" },
      items: { object: "list", data: [{ id: "si_1", price: { id: "price_pro_test" }, current_period_end: 1_800_000_000 }] },
    });
    const stale = event("customer.subscription.deleted", subscription("sub_old", "canceled"));
    expect(await handleWebhook(stale, signed(stale))).toEqual({ applied: false });

    const upgraded = event("customer.subscription.updated", subscription("sub_cancel", "active"));
    expect(await handleWebhook(upgraded, signed(upgraded))).toEqual({ applied: true });
    expect((await workspaceRow(workspace.id)).planId).toBe("pro");

    const ended = event("customer.subscription.deleted", subscription("sub_cancel", "canceled"));
    expect(await handleWebhook(ended, signed(ended))).toEqual({ applied: true });
    const row = await workspaceRow(workspace.id);
    expect(row).toMatchObject({ planId: "free", plan: "free", stripeSubscriptionId: null });
    // Credits already granted are kept.
    expect(row.creditBalance).toBe(1600);
  });

  it("ignores event types it does not handle", async () => {
    const payload = event("customer.created", { id: "cus_x", object: "customer" });
    expect(await handleWebhook(payload, signed(payload))).toEqual({ applied: false });
  });
});
