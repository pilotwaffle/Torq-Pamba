import Link from "next/link";
import { getCreditBalance } from "@/lib/credits/ledger";
import { formatCredits } from "@/lib/credits/pricing";

/** Sidebar meter: the workspace's credit balance, linking to Billing. */
export async function CreditBalanceWidget({ workspaceId }: { workspaceId: string }) {
  const balance = await getCreditBalance(workspaceId);
  return (
    <Link
      href="/app/billing"
      aria-label={`Credit balance: ${formatCredits(balance)}`}
      className="mt-2 ml-1.5 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-zinc-100 tabular-nums hover:bg-white/20"
    >
      {formatCredits(balance)}
    </Link>
  );
}
