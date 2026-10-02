import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { creditCharges, workspaces } from "@/db/schema";
import { signupAccount } from "@/lib/auth/account";
import {
  captureCredits,
  CreditCeilingError,
  grantChargedCredits,
  holdCredits,
  releaseCredits,
  reserveCredits,
} from "./charges";
import { getCreditBalance, postEntry } from "./ledger";

/** `api_keys.max_credits` counts ledger credits the grant started, under the workspace lock. */

const email = (label: string) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;

async function workspaceWith(label: string, credits: number) {
  const { workspace } = await signupAccount({ email: email(label), password: "correct-horse-battery", workspaceName: `${label} Co` });
  const current = await getCreditBalance(workspace.id);
  if (current !== credits) await postEntry({ workspaceId: workspace.id, kind: "adjustment", delta: credits - current, description: "test balance" });
  return workspace;
}

async function balanceOf(workspaceId: string) {
  const db = await getDb();
  const [row] = await db.select({ balance: workspaces.creditBalance }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row?.balance ?? 0;
}

describe("API credit ceiling on the ledger", () => {
  it("refuses a reservation over the grant's ceiling and leaves the balance alone", async () => {
    const workspace = await workspaceWith("ceiling", 5_000);
    const grant = { grantId: randomUUID(), maxCredits: 800 };
    const first = await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 500, description: "a", apiGrant: grant });
    expect(await grantChargedCredits(grant.grantId)).toBe(500);
    const over = reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 301, description: "b", apiGrant: grant });
    await expect(over).rejects.toBeInstanceOf(CreditCeilingError);
    await expect(over).rejects.toThrow(/301 credits, over the 300 credits left/);
    // holdCredits reports a short balance as a result, but a ceiling still throws (the API maps it to 402).
    await expect(holdCredits({ workspaceId: workspace.id, kind: "clip", credits: 301, description: "c", apiGrant: grant })).rejects.toBeInstanceOf(
      CreditCeilingError,
    );
    expect(await balanceOf(workspace.id)).toBe(4_500);
    await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 300, description: "d", apiGrant: grant });
    expect(await grantChargedCredits(grant.grantId)).toBe(800);
    const db = await getDb();
    const [charge] = await db.select().from(creditCharges).where(eq(creditCharges.id, first.chargeId));
    expect(charge?.apiGrantId).toBe(grant.grantId);
  });

  it("counts captured credits, never released ones, and only for that grant", async () => {
    const workspace = await workspaceWith("ceiling-settle", 5_000);
    const grant = { grantId: randomUUID(), maxCredits: 1_000 };
    const captured = await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 600, description: "a", apiGrant: grant });
    await captureCredits(captured.chargeId, { credits: 400 });
    const failed = await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 500, description: "b", apiGrant: grant });
    expect(await grantChargedCredits(grant.grantId)).toBe(900);
    await releaseCredits(failed.chargeId);
    expect(await grantChargedCredits(grant.grantId)).toBe(400);
    // Another key in the same workspace and app-started charges do not count.
    await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 700, description: "other", apiGrant: { grantId: randomUUID(), maxCredits: 700 } });
    await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 100, description: "app" });
    expect(await grantChargedCredits(grant.grantId)).toBe(400);
    // A charge from last month does not count against this month's ceiling.
    const db = await getDb();
    await db.update(creditCharges).set({ createdAt: new Date(Date.UTC(2000, 0, 15)) }).where(eq(creditCharges.id, captured.chargeId));
    expect(await grantChargedCredits(grant.grantId)).toBe(0);
  });

  it("lets parallel reservations on one grant spend the ceiling only once", async () => {
    const workspace = await workspaceWith("ceiling-race", 50_000);
    const grant = { grantId: randomUUID(), maxCredits: 2_500 };
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 1_000, description: `race ${index}`, apiGrant: grant }),
      ),
    );
    const refused = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    for (const result of refused) expect(result.reason).toBeInstanceOf(CreditCeilingError);
    expect(await grantChargedCredits(grant.grantId)).toBe(2_000);
    expect(await balanceOf(workspace.id)).toBe(48_000);
  });

  it("puts no ceiling on a grant without max_credits", async () => {
    const workspace = await workspaceWith("ceiling-none", 3_000);
    const grant = { grantId: randomUUID(), maxCredits: null };
    await reserveCredits({ workspaceId: workspace.id, kind: "clip", credits: 3_000, description: "all", apiGrant: grant });
    expect(await grantChargedCredits(grant.grantId)).toBe(3_000);
  });
});
