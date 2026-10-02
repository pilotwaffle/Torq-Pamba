import { desc, eq, sql } from "drizzle-orm";
import { getDb, type AppDb } from "@/db";
import { creditLedger, plans, workspaces } from "@/db/schema";
import type { creditEntryKind } from "@/db/schema/enums";
import { SIMULATED_STARTER_CREDITS, simulatedBillingAllowed } from "./mode";
import { formatCredits } from "./pricing";

export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];
export type LedgerKind = (typeof creditEntryKind.enumValues)[number];
export type LedgerEntry = typeof creditLedger.$inferSelect;

export class CreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditsError";
  }
}

export class InsufficientCreditsError extends CreditsError {
  readonly required: number;
  readonly balance: number;

  constructor(required: number, balance: number) {
    super(
      `This costs ${formatCredits(required)} and you have ${formatCredits(balance)}. Top up credits or upgrade your plan on the Billing page.`,
    );
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.balance = balance;
  }
}

export type EntryInput = {
  workspaceId: string;
  kind: LedgerKind;
  /** Positive for grants and refunds, negative for charges. Never 0. */
  delta: number;
  description: string;
  /** Unique across the ledger. A repeat with the same key changes nothing. */
  idempotencyKey?: string;
  planId?: string | null;
  topUpId?: string | null;
  chargeId?: string | null;
  createdBy?: string | null;
};

export type EntryResult = { applied: boolean; balance: number };

/** Row-locks the workspace so balance changes for one workspace apply one at a time. */
export async function lockBalance(tx: Tx, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ balance: workspaces.creditBalance })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
  if (!row) throw new CreditsError("Workspace not found");
  return row.balance;
}

/**
 * Appends one ledger row and moves the cached balance in the caller's
 * transaction. A debit that would go below zero throws InsufficientCreditsError.
 */
export async function appendEntry(tx: Tx, input: EntryInput): Promise<EntryResult> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new CreditsError("A ledger entry needs a non-zero whole number of credits");
  }
  const balance = await lockBalance(tx, input.workspaceId);
  if (input.idempotencyKey) {
    const [existing] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) return { applied: false, balance };
  }
  if (input.delta < 0 && balance + input.delta < 0) {
    throw new InsufficientCreditsError(-input.delta, balance);
  }
  const [updated] = await tx
    .update(workspaces)
    .set({ creditBalance: sql`${workspaces.creditBalance} + ${input.delta}` })
    .where(eq(workspaces.id, input.workspaceId))
    .returning({ balance: workspaces.creditBalance });
  if (!updated) throw new CreditsError("Workspace not found");
  await tx.insert(creditLedger).values({
    workspaceId: input.workspaceId,
    kind: input.kind,
    delta: input.delta,
    balanceAfter: updated.balance,
    description: input.description,
    idempotencyKey: input.idempotencyKey ?? null,
    planId: input.planId ?? null,
    topUpId: input.topUpId ?? null,
    chargeId: input.chargeId ?? null,
    createdBy: input.createdBy ?? null,
    // Taken after the row lock, so ledger order matches the order the balance moved.
    createdAt: sql`clock_timestamp()`,
  });
  return { applied: true, balance: updated.balance };
}

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (typeof record.message === "string" && /duplicate key|unique constraint/i.test(record.message)) return true;
    current = record.cause;
  }
  return false;
}

/**
 * Runs `work` in a transaction. If a concurrent writer committed the same
 * idempotency key first, the unique index rejects ours and this reports
 * "already applied" instead of failing.
 */
export async function inLedgerTransaction(
  workspaceId: string,
  work: (tx: Tx) => Promise<EntryResult>,
): Promise<EntryResult> {
  const db = await getDb();
  try {
    return await db.transaction(work);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { applied: false, balance: await readBalance(workspaceId) };
  }
}

export async function postEntry(input: EntryInput): Promise<EntryResult> {
  return inLedgerTransaction(input.workspaceId, (tx) => appendEntry(tx, input));
}

async function readBalance(workspaceId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ balance: workspaces.creditBalance })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Grants the workspace's one-time signup credits: the plan's `signup_credits`,
 * or `SIMULATED_STARTER_CREDITS` while billing is simulated. Safe to call on
 * every read; the idempotency key makes repeats no-ops.
 */
export async function ensureSignupGrant(workspaceId: string): Promise<void> {
  const db = await getDb();
  const key = `signup:${workspaceId}`;
  const [existing] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, key))
    .limit(1);
  if (existing) return;
  const [row] = await db
    .select({ signupCredits: plans.signupCredits, planId: plans.id })
    .from(workspaces)
    .innerJoin(plans, eq(workspaces.planId, plans.id))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) return;
  const simulated = simulatedBillingAllowed();
  const credits = simulated ? Math.max(row.signupCredits, SIMULATED_STARTER_CREDITS) : row.signupCredits;
  if (credits <= 0) return;
  await postEntry({
    workspaceId,
    kind: "signup_grant",
    delta: credits,
    description: simulated ? "Starter credits (simulated billing)" : "Signup credits",
    idempotencyKey: key,
    planId: row.planId,
  });
}

export async function getCreditBalance(workspaceId: string): Promise<number> {
  await ensureSignupGrant(workspaceId);
  return readBalance(workspaceId);
}

export async function listLedger(workspaceId: string, limit = 50): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}
