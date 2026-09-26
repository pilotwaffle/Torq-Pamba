import { PageHeader, cardClass, primaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { BillingError, billingBanner, PLANS } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; simulated?: string }>;
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
  const current = PLANS.find((plan) => plan.id === workspace.plan) ?? PLANS[0];

  return (
    <main className="max-w-5xl">
      <PageHeader title="Billing" description="Placeholder test-mode prices. These are not live charges." />
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm" role="status">
        {banner}
      </p>
      {params.simulated === "1" ? (
        <p className="mt-4 text-sm" role="status">
          Simulated upgrade applied.
        </p>
      ) : null}
      {params.error ? (
        <p className="mt-4 text-sm text-rose-700" role="alert">
          {params.error}
        </p>
      ) : null}
      <p className="mt-6 text-sm">
        Current plan: <span className="font-medium">{current.name}</span>
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === workspace.plan;
          return (
            <section
              key={plan.id}
              className={`${cardClass} flex flex-col p-5 ${isCurrent ? "ring-2 ring-emerald-600" : ""}`}
            >
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <p className="mt-3 text-3xl font-semibold tracking-tight">
                ${plan.monthlyUsd}
                {plan.paid ? <span className="text-sm font-normal text-zinc-500">/mo</span> : null}
              </p>
              <p className="mt-2 text-sm text-zinc-700">{plan.blurb}</p>
              <p className="mt-2 text-xs text-zinc-500">Placeholder test-mode price</p>
              <div className="mt-5">
                {isCurrent ? (
                  <p className="text-sm font-medium text-emerald-800">Current plan</p>
                ) : plan.paid ? (
                  <form method="post" action="/api/billing/checkout">
                    <input type="hidden" name="plan" value={plan.id} />
                    <button type="submit" disabled={blocked} className={primaryButton}>
                      Upgrade
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
    </main>
  );
}
