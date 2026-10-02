import Link from "next/link";
import { cardClass, fieldClass, primaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/research/accounts";
import { addAccountAction } from "@/lib/research/actions";
import { formatCount } from "@/lib/research/metrics";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/research/types";
import { ResearchHeader } from "../_components/research-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accounts · Research" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const accounts = await listAccounts(workspace.id);

  return (
    <main className="max-w-5xl">
      <ResearchHeader current="accounts" error={params.error}>
        <form action={addAccountAction} aria-label="Track an account" className={`${cardClass} mb-6 grid gap-3 p-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end`}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Handle or profile URL</span>
            <input
              name="account"
              required
              maxLength={300}
              placeholder="@creator or https://www.tiktok.com/@creator"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Platform</span>
            <select name="platform" defaultValue="tiktok" className={fieldClass}>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_LABEL[platform]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Type</span>
            <select name="kind" defaultValue="inspiration" className={fieldClass}>
              <option value="inspiration">Inspiration</option>
              <option value="competitor">Competitor</option>
            </select>
          </label>
          <button type="submit" className={primaryButton}>
            Track account
          </button>
          <p className="text-xs text-zinc-500 md:col-span-4">
            A profile URL sets the platform for you. Only public posts are read; nothing is posted or followed.
          </p>
        </form>

        {accounts.length === 0 ? (
          <p className="text-sm text-zinc-600">No accounts tracked yet.</p>
        ) : (
          <ul aria-label="Tracked accounts" className="flex flex-col gap-2">
            {accounts.map((account) => (
              <li key={account.id} className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
                <div className="min-w-0">
                  <Link href={`/app/research/accounts/${account.id}`} className="text-sm font-medium hover:text-emerald-800">
                    @{account.handle}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {PLATFORM_LABEL[account.platform]} · {account.kind === "competitor" ? "Competitor" : "Inspiration"}
                    {account.followerCount != null ? ` · ${formatCount(account.followerCount)} followers` : ""}
                    {account.syncError ? ` · Last sync failed` : ""}
                  </p>
                </div>
                <Link href={`/app/research/accounts/${account.id}`} className="text-sm font-medium text-emerald-800 hover:underline">
                  Recent posts
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ResearchHeader>
    </main>
  );
}
