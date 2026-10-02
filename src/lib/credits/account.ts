import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { creditTopUps, plans, workspaces } from "@/db/schema";
import {
  appendEntry,
  CreditsError,
  getCreditBalance,
  inLedgerTransaction,
  listLedger,
  type LedgerEntry,
  type Tx,
} from "./ledger";
import { legacyPlanFor, toPlanId, type PlanId, type TopUpPack } from "./plans";
import { formatCredits } from "./pricing";

export type PlanRow = typeof plans.$inferSelect;
export type TopUp = typeof creditTopUps.$inferSelect;

export async function listPlans(): Promise<PlanRow[]> {
  const db = await getDb();
  return db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
}

export async function getPlan(planId: PlanId): Promise<PlanRow> {
  const db = await getDb();
  const [row] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!row) throw new CreditsError(`Unknown plan ${planId}`);
  return row;
}

export type PlanChange = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planPeriodEndsAt?: Date | null;
};

/** Writes `plan_id` and keeps the legacy `plan` column in step (hobby ↔ creator, pro ↔ studio). */
export async function setWorkspacePlan(workspaceId: string, planId: PlanId, change: PlanChange = {}): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .update(workspaces)
    .set({
      planId,
      plan: legacyPlanFor(planId),
      billingInterval: planId === "free" ? null : "month",
      updatedAt: new Date(),
      ...(change.stripeCustomerId !== undefined ? { stripeCustomerId: change.stripeCustomerId } : {}),
      ...(change.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: change.stripeSubscriptionId } : {}),
      ...(change.planPeriodEndsAt !== undefined ? { planPeriodEndsAt: change.planPeriodEndsAt } : {}),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id });
  return Boolean(row);
}

/** The plan's monthly credits, once per `idempotencyKey` (one per paid invoice). */
export async function grantPlanCredits(input: {
  workspaceId: string;
  planId: PlanId;
  idempotencyKey: string;
  createdBy?: string | null;
}): Promise<{ applied: boolean; credits: number }> {
  const plan = await getPlan(input.planId);
  if (plan.monthlyCredits <= 0) return { applied: false, credits: 0 };
  const result = await inLedgerTransaction(input.workspaceId, (tx) =>
    appendEntry(tx, {
      workspaceId: input.workspaceId,
      kind: "plan_grant",
      delta: plan.monthlyCredits,
      description: `${plan.name} monthly credits`,
      idempotencyKey: input.idempotencyKey,
      planId: plan.id,
      createdBy: input.createdBy,
    }),
  );
  return { applied: result.applied, credits: plan.monthlyCredits };
}

export async function createTopUp(input: {
  workspaceId: string;
  pack: TopUpPack;
  createdBy?: string | null;
}): Promise<TopUp> {
  const db = await getDb();
  const [row] = await db
    .insert(creditTopUps)
    .values({
      workspaceId: input.workspaceId,
      credits: input.pack.credits,
      amountCents: input.pack.amountCents,
      currency: "usd",
      status: "pending",
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new CreditsError("Could not start the top-up");
  return row;
}

export async function attachTopUpSession(topUpId: string, sessionId: string): Promise<void> {
  const db = await getDb();
  await db.update(creditTopUps).set({ stripeCheckoutSessionId: sessionId }).where(eq(creditTopUps.id, topUpId));
}

/** Marks a pending top-up failed. A paid one is left alone. */
export async function failTopUp(topUpId: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const topUp = await lockTopUp(tx, topUpId);
    if (topUp.status === "pending") {
      await tx.update(creditTopUps).set({ status: "failed" }).where(eq(creditTopUps.id, topUpId));
    }
  });
}

async function lockTopUp(tx: Tx, topUpId: string): Promise<TopUp> {
  const [row] = await tx.select().from(creditTopUps).where(eq(creditTopUps.id, topUpId)).for("update");
  if (!row) throw new CreditsError("Top-up not found");
  return row;
}

/**
 * Marks a top-up paid and grants its credits in one transaction. A second
 * delivery of the same payment changes nothing. The paid amount and currency
 * must match what the pack was sold for.
 */
export async function completeTopUp(input: {
  topUpId: string;
  workspaceId: string;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
}): Promise<{ applied: boolean; credits: number }> {
  let credits = 0;
  const result = await inLedgerTransaction(input.workspaceId, async (tx) => {
    const topUp = await lockTopUp(tx, input.topUpId);
    credits = topUp.credits;
    if (topUp.workspaceId !== input.workspaceId) throw new CreditsError("Top-up belongs to another workspace");
    if (topUp.status === "paid") return { applied: false, balance: await balanceIn(tx, topUp.workspaceId) };
    if (topUp.status === "refunded") throw new CreditsError("Top-up was refunded");
    if (input.amountCents != null && input.amountCents !== topUp.amountCents) {
      throw new CreditsError("Paid amount does not match the top-up");
    }
    if (input.currency && input.currency.toLowerCase() !== topUp.currency) {
      throw new CreditsError("Paid currency does not match the top-up");
    }
    await tx
      .update(creditTopUps)
      .set({
        status: "paid",
        paidAt: new Date(),
        ...(input.stripeCheckoutSessionId ? { stripeCheckoutSessionId: input.stripeCheckoutSessionId } : {}),
        ...(input.stripePaymentIntentId ? { stripePaymentIntentId: input.stripePaymentIntentId } : {}),
      })
      .where(eq(creditTopUps.id, topUp.id));
    return appendEntry(tx, {
      workspaceId: topUp.workspaceId,
      kind: "top_up",
      delta: topUp.credits,
      description: `Top-up: ${formatCredits(topUp.credits)}`,
      idempotencyKey: `topup:${topUp.id}`,
      topUpId: topUp.id,
      createdBy: topUp.createdBy,
    });
  });
  return { applied: result.applied, credits };
}

async function balanceIn(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx.select({ balance: workspaces.creditBalance }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row?.balance ?? 0;
}

export type CreditSummary = {
  balance: number;
  plan: PlanRow;
  plans: PlanRow[];
  ledger: LedgerEntry[];
  hasSubscription: boolean;
  hasStripeCustomer: boolean;
  planPeriodEndsAt: Date | null;
};

export async function getCreditSummary(workspaceId: string): Promise<CreditSummary> {
  const balance = await getCreditBalance(workspaceId);
  const db = await getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw new CreditsError("Workspace not found");
  const allPlans = await listPlans();
  const planId = toPlanId(workspace.planId) ?? "free";
  const plan = allPlans.find((row) => row.id === planId) ?? (await getPlan(planId));
  return {
    balance,
    plan,
    plans: allPlans,
    ledger: await listLedger(workspaceId),
    hasSubscription: Boolean(workspace.stripeSubscriptionId),
    hasStripeCustomer: Boolean(workspace.stripeCustomerId),
    planPeriodEndsAt: workspace.planPeriodEndsAt,
  };
}
