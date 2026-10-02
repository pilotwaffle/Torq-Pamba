import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as webhook } from "@/app/api/billing/webhook/route";
import { POST as cronTick } from "@/app/api/cron/tick/route";
import { getDb } from "@/db";
import { scheduleItems, videos, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import { handleWebhook, WebhookUnauthorizedError } from "@/lib/billing";
import { allowsInsecureLocalEndpoints } from "@/lib/local-mode";
import { cronAuthorized, scheduleVideo } from "@/lib/schedule";

function email(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function tickRequest(authorization?: string) {
  return new Request("http://localhost/api/cron/tick", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
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

function webhookRequest(body: string) {
  return new Request("http://localhost/api/billing/webhook", { method: "POST", body });
}

/** No secrets, no local flag: what a misconfigured deploy looks like. */
function unconfigured() {
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowsInsecureLocalEndpoints", () => {
  it("needs the explicit flag and is never on in production", () => {
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "development" })).toBe(false);
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "test" })).toBe(false);
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "development", ALLOW_INSECURE_LOCAL_ENDPOINTS: "1" })).toBe(true);
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "test", ALLOW_INSECURE_LOCAL_ENDPOINTS: "1" })).toBe(true);
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "production", ALLOW_INSECURE_LOCAL_ENDPOINTS: "1" })).toBe(false);
    expect(allowsInsecureLocalEndpoints({ NODE_ENV: "development", ALLOW_INSECURE_LOCAL_ENDPOINTS: "true" })).toBe(false);
  });
});

describe("POST /api/cron/tick without CRON_SECRET", () => {
  it("rejects every caller and leaves due items alone", async () => {
    unconfigured();
    const { workspace, user } = await signupAccount({
      email: email("cron-open"),
      password: "correct-horse-battery",
      workspaceName: "Cron Open Co",
    });
    const db = await getDb();
    const [video] = await db
      .insert(videos)
      .values({ workspaceId: workspace.id, title: "Due", status: "approved", aiGenerated: true })
      .returning();
    const item = await scheduleVideo(video!.id, new Date(Date.now() - 5_000), user.id);

    expect(cronAuthorized(null)).toBe(false);
    expect(cronAuthorized("Bearer anything")).toBe(false);
    for (const authorization of [undefined, "Bearer anything", "Bearer "]) {
      const response = await cronTick(tickRequest(authorization));
      expect(response.status).toBe(401);
    }
    const [still] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, item.id));
    expect(still?.status).toBe("scheduled");
  });

  it("stays closed in production even with the local flag", async () => {
    unconfigured();
    vi.stubEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect((await cronTick(tickRequest())).status).toBe(401);
  });

  it("opens only in explicit local mode", async () => {
    unconfigured();
    vi.stubEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await cronTick(tickRequest())).status).toBe(200);
  });
});

describe("POST /api/billing/webhook without STRIPE_WEBHOOK_SECRET", () => {
  it("returns 401 for an unsigned event and does not change the plan", async () => {
    unconfigured();
    const { workspace } = await signupAccount({
      email: email("hook-open"),
      password: "correct-horse-battery",
      workspaceName: "Hook Open Co",
    });
    await expect(handleWebhook(checkoutEvent(workspace.id), null)).rejects.toBeInstanceOf(WebhookUnauthorizedError);

    const response = await webhook(webhookRequest(checkoutEvent(workspace.id)));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: string }).error).toMatch(/STRIPE_WEBHOOK_SECRET/);
    const db = await getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row?.plan).toBe("free");
  });

  it("stays closed in production even with the local flag", async () => {
    unconfigured();
    vi.stubEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", "1");
    vi.stubEnv("NODE_ENV", "production");
    const response = await webhook(webhookRequest(checkoutEvent("00000000-0000-4000-8000-000000000000")));
    expect(response.status).toBe(401);
  });

  it("accepts an unsigned test event only in explicit local mode", async () => {
    unconfigured();
    vi.stubEnv("ALLOW_INSECURE_LOCAL_ENDPOINTS", "1");
    vi.stubEnv("NODE_ENV", "development");
    const { workspace } = await signupAccount({
      email: email("hook-local"),
      password: "correct-horse-battery",
      workspaceName: "Hook Local Co",
    });
    const response = await webhook(webhookRequest(checkoutEvent(workspace.id)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, applied: true });
    const db = await getDb();
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspace.id));
    expect(row?.plan).toBe("studio");
  });
});
