import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { creditCharges, videos } from "@/db/schema";
import type { chargeKind } from "@/db/schema/enums";
import { formatCredits } from "./pricing";
import { appendEntry, CreditsError, ensureSignupGrant, InsufficientCreditsError, lockBalance, type Tx } from "./ledger";

export type ChargeKind = (typeof chargeKind.enumValues)[number];
export type CreditCharge = typeof creditCharges.$inferSelect;

export type ReserveInput = {
  workspaceId: string;
  kind: ChargeKind;
  credits: number;
  description: string;
  model?: string | null;
  units?: number;
  costUsd?: number;
  videoId?: string | null;
  createdBy?: string | null;
  /**
   * The API key or OAuth grant spending these credits, with its monthly
   * `max_credits` ceiling (null = workspace balance only). Checked under the
   * workspace row lock, so parallel API calls cannot overspend the ceiling.
   */
  apiGrant?: { grantId: string; maxCredits: number | null } | null;
};

/** A reservation would take an API key or OAuth grant over its monthly credit ceiling. */
export class CreditCeilingError extends CreditsError {
  readonly required: number;
  readonly left: number;

  constructor(required: number, left: number) {
    super(
      `This costs ${formatCredits(required)}, over the ${formatCredits(left)} left on this credential's monthly credit ceiling.`,
    );
    this.name = "CreditCeilingError";
    this.required = required;
    this.left = left;
  }
}

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Ledger credits an API key or OAuth grant has spent this calendar month (UTC):
 * reserved plus captured charges. Released charges (failed jobs) cost nothing
 * and are not counted. This is what `api_keys.max_credits` caps.
 */
export async function grantChargedCredits(grantId: string, now = new Date(), tx?: Tx): Promise<number> {
  const db = tx ?? (await getDb());
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${creditCharges.credits}), 0)` })
    .from(creditCharges)
    .where(
      and(
        eq(creditCharges.apiGrantId, grantId),
        inArray(creditCharges.status, ["reserved", "captured"]),
        gte(creditCharges.createdAt, monthStartUtc(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Ledger credits charged for one video: reserved plus captured, never released. */
export async function videoChargedCredits(videoId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${creditCharges.credits}), 0)` })
    .from(creditCharges)
    .where(and(eq(creditCharges.videoId, videoId), inArray(creditCharges.status, ["reserved", "captured"])));
  return Number(row?.total ?? 0);
}

/**
 * Takes the quoted credits off the balance before a job starts, so parallel
 * jobs cannot spend the same credits twice. Throws InsufficientCreditsError.
 */
export async function reserveCredits(input: ReserveInput): Promise<{ chargeId: string; balance: number }> {
  if (!Number.isInteger(input.credits) || input.credits < 0) throw new CreditsError("Credits must be a whole number");
  await ensureSignupGrant(input.workspaceId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const balance = await lockBalance(tx, input.workspaceId);
    const ceiling = input.apiGrant?.maxCredits ?? null;
    if (input.apiGrant && ceiling !== null) {
      const left = Math.max(0, ceiling - (await grantChargedCredits(input.apiGrant.grantId, new Date(), tx)));
      if (input.credits > left) throw new CreditCeilingError(input.credits, left);
    }
    if (balance < input.credits) throw new InsufficientCreditsError(input.credits, balance);
    const [charge] = await tx
      .insert(creditCharges)
      .values({
        workspaceId: input.workspaceId,
        kind: input.kind,
        status: "reserved",
        model: input.model ?? null,
        units: input.units ?? 0,
        credits: input.credits,
        costUsd: input.costUsd ?? 0,
        videoId: input.videoId ?? null,
        apiGrantId: input.apiGrant?.grantId ?? null,
      })
      .returning({ id: creditCharges.id });
    if (!charge) throw new CreditsError("Could not reserve credits");
    if (input.credits === 0) return { chargeId: charge.id, balance };
    const entry = await appendEntry(tx, {
      workspaceId: input.workspaceId,
      kind: "generation_charge",
      delta: -input.credits,
      description: input.description,
      idempotencyKey: `charge:${charge.id}:reserve`,
      chargeId: charge.id,
      createdBy: input.createdBy,
    });
    return { chargeId: charge.id, balance: entry.balance };
  });
}

async function lockCharge(tx: Tx, chargeId: string): Promise<CreditCharge> {
  const [charge] = await tx.select().from(creditCharges).where(eq(creditCharges.id, chargeId)).for("update");
  if (!charge) throw new CreditsError("Charge not found");
  return charge;
}

/** Points a reservation at the video it pays for, once the video row exists. */
export async function attachChargeVideo(chargeId: string, videoId: string): Promise<void> {
  const db = await getDb();
  await db.update(creditCharges).set({ videoId }).where(eq(creditCharges.id, chargeId));
}

/**
 * Settles a reservation at what the job actually cost, capped at what was
 * reserved: the user never pays more than the price shown. The unused part
 * goes back to the balance. Repeat calls change nothing.
 */
export async function captureCredits(
  chargeId: string,
  input: { credits: number; costUsd?: number },
): Promise<{ captured: number; refunded: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const charge = await lockCharge(tx, chargeId);
    if (charge.status !== "reserved") {
      return { captured: charge.status === "captured" ? charge.credits : 0, refunded: 0 };
    }
    const captured = Math.min(charge.credits, Math.max(0, Math.ceil(input.credits)));
    const refunded = charge.credits - captured;
    await tx
      .update(creditCharges)
      .set({
        status: "captured",
        credits: captured,
        settledAt: new Date(),
        ...(input.costUsd != null ? { costUsd: input.costUsd } : {}),
      })
      .where(eq(creditCharges.id, chargeId));
    if (refunded > 0) {
      await appendEntry(tx, {
        workspaceId: charge.workspaceId,
        kind: "refund",
        delta: refunded,
        description: "Unused reservation returned (a cheaper model finished the job)",
        idempotencyKey: `charge:${chargeId}:unused`,
        chargeId,
      });
    }
    if (charge.videoId && captured > 0) {
      await tx
        .update(videos)
        .set({ creditsCharged: sql`${videos.creditsCharged} + ${captured}` })
        .where(eq(videos.id, charge.videoId));
    }
    return { captured, refunded };
  });
}

/** Returns every reserved credit after a failed job. Failures cost nothing. Repeat calls change nothing. */
export async function releaseCredits(chargeId: string, reason = "Refund: generation failed"): Promise<{ refunded: number }> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const charge = await lockCharge(tx, chargeId);
    if (charge.status !== "reserved") return { refunded: 0 };
    await tx
      .update(creditCharges)
      .set({ status: "released", settledAt: new Date() })
      .where(eq(creditCharges.id, chargeId));
    if (charge.credits > 0) {
      await appendEntry(tx, {
        workspaceId: charge.workspaceId,
        kind: "refund",
        delta: charge.credits,
        description: reason,
        idempotencyKey: `charge:${chargeId}:release`,
        chargeId,
      });
    }
    return { refunded: charge.credits };
  });
}

/**
 * `reserveCredits` for call sites that report "not enough credits" as a result
 * instead of an exception. A CreditCeilingError still throws, so the API can
 * answer 402 spend_cap_exceeded.
 */
export async function holdCredits(
  input: ReserveInput,
): Promise<{ ok: true; chargeId: string } | { ok: false; error: string; required: number; balance: number }> {
  try {
    const { chargeId } = await reserveCredits(input);
    return { ok: true, chargeId };
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return { ok: false, error: error.message, required: error.required, balance: error.balance };
    }
    throw error;
  }
}
