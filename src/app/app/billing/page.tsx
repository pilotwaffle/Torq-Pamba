import { PageHeader, cardClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, billingBanner } from "@/lib/billing";
import { getCreditSummary } from "@/lib/credits/account";
import { simulatedBillingAllowed, stripeSecretKey } from "@/lib/credits/mode";
import { formatCents, TOP_UP_PACKS } from "@/lib/credits/plans";
import { formatCredits, quoteClipCredits } from "@/lib/credits/pricing";
import { TIERS } from "@/lib/models";
import { formatWhen } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const FLASH: Record<string, string> = {
  "simulated:1": "Simulated checkout: the plan changed and this month's credits were added. No card was charged.",
  "simulated:top-up": "Simulated top-up: the credits were added. No card was charged.",
  "checkout:success": "Subscription started. Your monthly credits arrive as soon as Stripe confirms the first invoice.",
  "checkout:canceled": "Checkout canceled. Nothing changed.",
  "top-up:success": "Payment received. The credits arrive as soon as Stripe confirms it.",
  "top-up:canceled": "Top-up canceled. Nothing changed.",
};

const TIER_NAMES = { budget: "Budget", standard: "Standard", premium: "Premium" } as const;

function signed(delta: number): string {
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US")}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; simulated?: string; checkout?: string; "top-up"?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  let banner = "";
  let blocked = false;
  try {
    banner = billingBanner();
  } catch (error) {
    blocked = true;
    banner = error instanceof BillingError ? error.message : "Billing is unavailable";
  }
  const hasKey = !blocked && Boolean(stripeSecretKey());
  const simulated = !blocked && simulatedBillingAllowed();
  const summary = await getCreditSummary(workspace.id);
  const manageable = hasKey && summary.hasStripeCustomer;
  const flash = (["simulated", "checkout", "top-up"] as const)
    .map((key) => (params[key] ? FLASH[`${key}:${params[key]}`] : undefined))
    .find(Boolean);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Billing"
        description="Placeholder test-mode prices. Credits pay for every generation. These are not live charges."
      />
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm" role="status">
        {banner}
      </p>
      {flash ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950" role="status">
          {flash}
        </p>
      ) : null}
      {params.error ? (
        <p className="mt-4 text-sm text-rose-700" role="alert">
          {params.error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-[2fr_3fr]">
        <section aria-labelledby="balance-heading" className={`${cardClass} p-5`}>
          <h2 id="balance-heading" className="text-sm font-medium text-zinc-600">
            Credit balance
          </h2>
          <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums" data-testid="credit-balance">
            {formatCredits(summary.balance)}
          </p>
          <p className="mt-3 text-sm">
            Current plan: <span className="font-medium">{summary.plan.name}</span>
            {summary.plan.monthlyCredits > 0 ? ` · ${formatCredits(summary.plan.monthlyCredits)} a month` : null}
          </p>
          {summary.planPeriodEndsAt ? (
            <p className="mt-1 text-xs text-zinc-500">Renews {formatWhen(summary.planPeriodEndsAt, workspace.timezone)}</p>
          ) : null}
          {manageable ? (
            <form method="post" action="/api/billing/portal" className="mt-4">
              <button type="submit" className={secondaryButton}>
                Manage subscription
              </button>
            </form>
          ) : null}
        </section>
        <section aria-labelledby="costs-heading" className={`${cardClass} p-5`}>
          <h2 id="costs-heading" className="text-sm font-medium text-zinc-600">
            What a 30-second video costs
          </h2>
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Credits per 30-second video by quality tier</caption>
            <tbody>
              {TIERS.map((tier) => (
                <tr key={tier} className="border-b border-zinc-100 last:border-0">
                  <th scope="row" className="py-1.5 text-left font-medium">
                    {TIER_NAMES[tier]}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCredits(quoteClipCredits({ tier, durationS: 30 }).total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-zinc-500">
            Priced from each model&apos;s list price. Credits are reserved when you generate and returned if the
            generation fails. A cheaper fallback model costs less, never more.
          </p>
        </section>
      </div>

      <section id="plans" aria-labelledby="plans-heading" className="mt-8 scroll-mt-6">
        <h2 id="plans-heading" className="text-lg font-semibold">
          Plans
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {summary.plans.map((plan) => {
            const isCurrent = plan.id === summary.plan.id;
            const paid = plan.monthlyPriceCents > 0;
            return (
              <section
                key={plan.id}
                aria-label={`${plan.name} plan`}
                className={`${cardClass} flex flex-col p-5 ${isCurrent ? "ring-2 ring-emerald-600" : ""}`}
              >
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  {formatCents(plan.monthlyPriceCents)}
                  {paid ? <span className="text-sm font-normal text-zinc-500">/mo</span> : null}
                </p>
                <p className="mt-2 text-sm text-zinc-700">
                  {plan.monthlyCredits > 0 ? `${formatCredits(plan.monthlyCredits)} every month` : "Pay as you go with top-ups"}
                </p>
                <div className="mt-auto pt-5">
                  {isCurrent ? (
                    <p className="text-sm font-medium text-emerald-800">Current plan</p>
                  ) : manageable && summary.hasSubscription ? (
                    <form method="post" action="/api/billing/portal">
                      <button type="submit" className={secondaryButton}>
                        Change in Stripe
                      </button>
                    </form>
                  ) : paid || simulated ? (
                    <form method="post" action="/api/billing/checkout">
                      <input type="hidden" name="plan" value={plan.id} />
                      <button type="submit" disabled={blocked} className={primaryButton}>
                        {paid ? `Subscribe to ${plan.name}` : `Switch to ${plan.name}`}
                      </button>
                    </form>
                  ) : (
                    <p className="text-sm text-zinc-600">Included with every workspace</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section id="top-ups" aria-labelledby="top-ups-heading" className="mt-8 scroll-mt-6">
        <h2 id="top-ups-heading" className="text-lg font-semibold">
          Top up credits
        </h2>
        <p className="mt-1 text-sm text-zinc-600">One-off packs on any plan, at $0.01 a credit.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {TOP_UP_PACKS.map((pack) => (
            <form key={pack.id} method="post" action="/api/billing/top-up" className={`${cardClass} flex flex-col p-5`}>
              <input type="hidden" name="pack" value={pack.id} />
              <p className="text-lg font-semibold">{formatCredits(pack.credits)}</p>
              <p className="mt-1 text-sm text-zinc-600">{formatCents(pack.amountCents)} once</p>
              <button type="submit" disabled={blocked} className={`${primaryButton} mt-4 w-fit`}>
                Buy {formatCredits(pack.credits)}
              </button>
            </form>
          ))}
        </div>
      </section>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-lg font-semibold">
          Credit history
        </h2>
        {summary.ledger.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No credit activity yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="sr-only">Credit history</caption>
              <thead className="bg-zinc-50 text-left text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Credits
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.ledger.map((entry) => (
                  <tr key={entry.id} className="border-t border-zinc-100">
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                      {formatWhen(entry.createdAt, workspace.timezone)}
                    </td>
                    <td className="px-3 py-2">{entry.description}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${entry.delta > 0 ? "text-emerald-800" : "text-zinc-900"}`}>
                      {signed(entry.delta)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{entry.balanceAfter.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
