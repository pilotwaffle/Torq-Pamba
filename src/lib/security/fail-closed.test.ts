import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { POST as webhookRoute } from "@/app/api/billing/webhook/route";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { WebhookUnauthorizedError, handleWebhook } from "@/lib/billing";

const password = "correct-horse-battery";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function checkoutEvent(workspaceId: string) {
  return JSON.stringify({
    id: "evt_unsigned",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_unsigned",
        object: "checkout.session",
        metadata: { workspaceId, plan: "studio" },
        client_reference_id: workspaceId,
      },
    },
  });
}

describe("Stripe webhook fails closed", () => {
  // On the v2 base the fail-closed status is the foundation's 401 (src/lib/local-mode.ts), not phase 2's 503.
  it("refuses an unsigned upgrade with 401 when STRIPE_WEBHOOK_SECRET is unset, and leaves the plan alone", async () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    const previousLocal = process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.ALLOW_INSECURE_LOCAL_ENDPOINTS;
    try {
      const { workspace } = await signupAccount({ email: email("unsigned"), password, workspaceName: "Unsigned Co" });
      const payload = checkoutEvent(workspace.id);
      await expect(handleWebhook(payload, null)).rejects.toBeInstanceOf(WebhookUnauthorizedError);
      const response = await webhookRoute(
        new Request("http://localhost/api/billing/webhook", { method: "POST", body: payload }),
      );
      expect(response.status).toBe(401);
      const db = await getDb();
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.plan).toBe("free");
    } finally {
      restoreEnv("STRIPE_WEBHOOK_SECRET", previous);
      restoreEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", previousLocal);
    }
  });

  it("rejects a missing or forged signature with 400 when the secret is set", async () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fail_closed";
    try {
      const { workspace } = await signupAccount({ email: email("forged"), password, workspaceName: "Forged Co" });
      const payload = checkoutEvent(workspace.id);
      const missing = await webhookRoute(
        new Request("http://localhost/api/billing/webhook", { method: "POST", body: payload }),
      );
      expect(missing.status).toBe(400);
      const forgedSig = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
      const forged = await webhookRoute(
        new Request("http://localhost/api/billing/webhook", {
          method: "POST",
          body: payload,
          headers: { "stripe-signature": forgedSig },
        }),
      );
      expect(forged.status).toBe(400);
      const db = await getDb();
      const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
      expect(row?.plan).toBe("free");
    } finally {
      restoreEnv("STRIPE_WEBHOOK_SECRET", previous);
    }
  });
});
