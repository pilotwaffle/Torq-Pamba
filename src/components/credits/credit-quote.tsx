"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { creditBalanceAction } from "@/lib/credits/actions";
import { formatCredits, quoteClipCredits } from "@/lib/credits/pricing";
import type { Tier } from "@/lib/pricing";

/** The credit price of a planned clip, the current balance, and a top-up prompt when the balance is short. */
export function CreditQuote({ tier, durationS }: { tier: Tier; durationS: number }) {
  const quote = quoteClipCredits({ tier, durationS });
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    creditBalanceAction()
      .then((result) => {
        if (live) setBalance(result.balance);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const short = balance != null && balance < quote.total;
  return (
    <section aria-label="Credit price" className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">Price in credits</span>
        <span className="text-base font-semibold text-emerald-950 tabular-nums" aria-live="polite">
          {formatCredits(quote.total)}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        {balance == null ? "Checking your balance…" : `You have ${formatCredits(balance)}.`} Credits are reserved when
        you generate and returned if it fails.
      </p>
      {short ? (
        <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
          Not enough credits for this video.{" "}
          <Link href="/app/billing#top-ups" className="font-medium underline underline-offset-2">
            Top up credits
          </Link>{" "}
          or{" "}
          <Link href="/app/billing#plans" className="font-medium underline underline-offset-2">
            upgrade your plan
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
