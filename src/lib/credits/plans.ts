/**
 * Plan ids and top-up packs. Plan prices and monthly credits live in the
 * `plans` table (seeded by migration 0001); `PLANS` mirrors those rows for
 * pages that render without the database, and a test keeps them equal.
 * Stripe price ids live in env vars. Pure, safe in client components.
 */

export type PlanId = "free" | "hobby" | "pro";
export type PaidPlanId = Exclude<PlanId, "free">;
/** The `workspaces.plan` column predates credits. */
export type LegacyPlan = "free" | "creator" | "studio";

export type PlanInfo = {
  id: PlanId;
  name: string;
  monthlyPriceCents: number;
  monthlyCredits: number;
  blurb: string;
};

export const PLANS: readonly PlanInfo[] = [
  { id: "free", name: "Free", monthlyPriceCents: 0, monthlyCredits: 0, blurb: "Pay as you go with top-ups" },
  { id: "hobby", name: "Hobby", monthlyPriceCents: 1_600, monthlyCredits: 1_600, blurb: "One brand, a few videos a month" },
  { id: "pro", name: "Pro", monthlyPriceCents: 10_000, monthlyCredits: 10_000, blurb: "A team posting every week" },
];

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return value === "hobby" || value === "pro";
}

/** Accepts current ids and the legacy names (creator → hobby, studio → pro, as in migration 0001). */
export function toPlanId(value: unknown): PlanId | null {
  if (value === "free" || value === "hobby" || value === "pro") return value;
  if (value === "creator") return "hobby";
  if (value === "studio") return "pro";
  return null;
}

export function legacyPlanFor(planId: PlanId): LegacyPlan {
  if (planId === "hobby") return "creator";
  if (planId === "pro") return "studio";
  return "free";
}

export type TopUpPack = { id: string; credits: number; amountCents: number };

/** One-off packs at the Hobby rate of $0.01 a credit. */
export const TOP_UP_PACKS: readonly TopUpPack[] = [
  { id: "credits-500", credits: 500, amountCents: 500 },
  { id: "credits-2000", credits: 2_000, amountCents: 2_000 },
  { id: "credits-5000", credits: 5_000, amountCents: 5_000 },
];

export function findTopUpPack(id: unknown): TopUpPack | null {
  return TOP_UP_PACKS.find((pack) => pack.id === id) ?? null;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
