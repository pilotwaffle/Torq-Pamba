import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import {
  PLANS,
  SIMULATED_BILLING_BANNER,
  STRIPE_TEST_BANNER,
  assertTestMode,
  billingBanner,
  checkoutSessionParams,
  createCheckout,
  handleWebhook,
} from "@/lib/billing";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

async function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

describe("billing", () => {
  it("lists placeholder test-mode prices", () => {
    expect(PLANS.map((plan) => [plan.id, plan.monthlyUsd, plan.placeholder])).toEqual([
      ["free", 0, true],
      ["creator", 29, true],
      ["studio", 99, true],
    ]);
  });

  it("refuses sk_live_ keys", async () => {
    expect(() => assertTestMode("sk_live_abc")).toThrow(/sk_live_/);
    expect(() => billingBanner("sk_live_abc")).toThrow(/sk_live_/);
    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    try {
      const { workspace } = await signupAccount({
        email: email("live"),
        password,
        workspaceName: "Live Co",
      });
      await expect(createCheckout(workspace, "creator")).rejects.toThrow(/sk_live_/);
      await expect(handleWebhook("{}", null)).rejects.toThrow(/sk_live_/);
    } finally {
      await restoreEnv("STRIPE_SECRET_KEY", previous);
    }
  });

  it("simulates an upgrade when no Stripe key is set", async () => {
    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousPrice = process.env.STRIPE_PRICE_CREATOR;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_CREATOR;
    try {
      expect(billingBanner()).toBe(SIMULATED_BILLING_BANNER);
      const { workspace } = await signupAccount({
        email: email("sim"),
        password,
        workspaceName: "Sim Co",
      });
      expect(workspace.plan).toBe("free");
      const result = await createCheckout(workspace, "studio");
      expect(result.url).toContain("?simulated=1");
      expect(result.url.startsWith("/app/billing")).toBe(true);
      expect(result.url).not.toContain("stripe.com");
      const db = await getDb();
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.plan).toBe("studio");
    } finally {
      await restoreEnv("STRIPE_SECRET_KEY", previousKey);
      await restoreEnv("STRIPE_PRICE_CREATOR", previousPrice);
    }
  });

  it("builds a subscription checkout and refuses to call Stripe without a price id", async () => {
    const params = checkoutSessionParams({
      workspaceId: "ws_1",
      plan: "creator",
      priceId: "price_creator",
      origin: "http://localhost:3000/",
      customerId: null,
    });
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_creator", quantity: 1 }]);
    expect(params.metadata).toEqual({ workspaceId: "ws_1", plan: "creator" });

    const previousKey = process.env.STRIPE_SECRET_KEY;
    const previousPrice = process.env.STRIPE_PRICE_CREATOR;
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    delete process.env.STRIPE_PRICE_CREATOR;
    try {
      expect(billingBanner()).toBe(STRIPE_TEST_BANNER);
      const { workspace } = await signupAccount({
        email: email("price"),
        password,
        workspaceName: "Price Co",
      });
      await expect(createCheckout(workspace, "creator")).rejects.toThrow(/STRIPE_PRICE_CREATOR/);
    } finally {
      await restoreEnv("STRIPE_SECRET_KEY", previousKey);
      await restoreEnv("STRIPE_PRICE_CREATOR", previousPrice);
    }
  });

  it("verifies the webhook signature when the secret is set and applies the plan", async () => {
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const previousKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const secret = "whsec_test_secret";
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    try {
      const { workspace } = await signupAccount({
        email: email("hook"),
        password,
        workspaceName: "Hook Co",
      });
      const payload = JSON.stringify({
        id: "evt_test_checkout",
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_checkout",
            object: "checkout.session",
            mode: "subscription",
            metadata: { workspaceId: workspace.id, plan: "creator" },
            client_reference_id: workspace.id,
            customer: "cus_test_123",
          },
        },
      });
      await expect(handleWebhook(payload, "t=1,v1=deadbeef")).rejects.toThrow(/signature/i);

      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
      const result = await handleWebhook(payload, signature);
      expect(result.applied).toBe(true);
      const db = await getDb();
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.plan).toBe("creator");
      expect(row?.stripeCustomerId).toBe("cus_test_123");
    } finally {
      await restoreEnv("STRIPE_WEBHOOK_SECRET", previousSecret);
      await restoreEnv("STRIPE_SECRET_KEY", previousKey);
    }
  });
});
