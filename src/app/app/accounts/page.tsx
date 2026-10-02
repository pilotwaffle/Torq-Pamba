import { PageHeader, cardClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/publish/accounts";
import { connectAccountAction, disconnectAccountAction } from "@/lib/publish/actions";
import { isPublishLive, PLATFORM_LABEL, PLATFORMS, tiktokAudited } from "@/lib/publish/config";

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  const accounts = await listAccounts(workspace.id);
  const canManage = role === "owner" || role === "admin";
  const audited = tiktokAudited();

  return (
    <main className="max-w-4xl">
      <PageHeader
        title="Connected accounts"
        description="Connect accounts you own through each platform's official login. Torq-Pamba stores an encrypted OAuth token, never a password, and never posts from devices."
      />
      {!audited ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          TikTok audit pending: TikTok posts go out as private (Only me), and at most 5 creators can post through this app per 24 hours. Extra posts fall back to TikTok drafts.
        </p>
      ) : null}
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {params.error}
        </p>
      ) : null}
      {params.connected ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Account connected.
        </p>
      ) : null}
      <section className={`${cardClass} p-4`} aria-labelledby="connect-heading">
        <h2 id="connect-heading" className="text-lg font-semibold">
          Connect
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PLATFORMS.map((platform) => {
            const live = isPublishLive(platform);
            return (
              <form key={platform} action={connectAccountAction}>
                <input type="hidden" name="platform" value={platform} />
                <button type="submit" className={primaryButton} disabled={!canManage}>
                  {live ? `Connect ${PLATFORM_LABEL[platform]}` : `Connect ${PLATFORM_LABEL[platform]} (mock)`}
                </button>
              </form>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-zinc-600">
          Mock connections never reach a platform. Real connections need PUBLISH_MODE=live and the platform app credentials (see REPORT.md).
        </p>
      </section>
      <section className={`${cardClass} mt-6 overflow-x-auto`} aria-label="Accounts">
        {accounts.length === 0 ? (
          <p className="p-4 text-sm">No accounts connected yet. Until you connect one, due items are marked “Ready to publish manually”.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Connected accounts">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Platform</th>
                <th scope="col" className="px-4 py-3 font-medium">Account</th>
                <th scope="col" className="px-4 py-3 font-medium">Mode</th>
                <th scope="col" className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-3">{PLATFORM_LABEL[account.platform]}</td>
                  <td className="px-4 py-3">{account.handle}</td>
                  <td className="px-4 py-3">{account.mode === "live" ? "Official OAuth" : "Mock"}</td>
                  <td className="px-4 py-3">
                    <form action={disconnectAccountAction}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <button type="submit" className={secondaryButton} disabled={!canManage}>
                        Disconnect {account.handle}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
