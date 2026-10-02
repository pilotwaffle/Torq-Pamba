import Link from "next/link";
import { ApiKeyForm } from "@/components/api-key-form";
import { PageHeader, cardClass, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { revokeApiKeyAction } from "@/lib/platform/actions";
import { listCredentials } from "@/lib/platform/credentials";

export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default async function ApiSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; revoked?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  const canManage = role === "owner" || role === "admin";
  const credentials = await listCredentials(workspace.id);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="API and MCP"
        description="Use the REST API at /api/v1 or connect an AI assistant to the MCP server at /api/mcp. Keys are shown once and stored only as a hash. Failed generations are never charged."
      />
      <p className="mb-4 text-sm">
        <Link href="/app/settings" className="text-emerald-800 underline">
          Back to settings
        </Link>{" "}
        ·{" "}
        <Link href="/docs/api" className="text-emerald-800 underline">
          API and MCP docs
        </Link>
      </p>
      {params.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {params.error}
        </p>
      ) : null}
      {params.revoked ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Access revoked.
        </p>
      ) : null}
      <section className={`${cardClass} p-4`} aria-labelledby="new-key-heading">
        <h2 id="new-key-heading" className="mb-3 text-lg font-semibold">
          Create a key
        </h2>
        {!canManage ? <p className="mb-3 text-sm">Only an owner or admin can create keys.</p> : null}
        <ApiKeyForm disabled={!canManage} />
      </section>
      <section className={`${cardClass} mt-6 overflow-x-auto`} aria-label="Keys and connected apps">
        {credentials.length === 0 ? (
          <p className="p-4 text-sm">No keys or connected apps yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="API access">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Key</th>
                <th scope="col" className="px-4 py-3 font-medium">Access</th>
                <th scope="col" className="px-4 py-3 font-medium">Spent / cap this month</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-b-0">
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.prefix}…</td>
                  <td className="px-4 py-3">{row.scope === "write" ? "Read and generate" : "Read only"}</td>
                  <td className="px-4 py-3">
                    {usd.format(row.spentUsd)} / {row.spendCapUsd === null ? "workspace budget" : usd.format(row.spendCapUsd)}
                  </td>
                  <td className="px-4 py-3">{row.revokedAt ? "Revoked" : "Active"}</td>
                  <td className="px-4 py-3">
                    {!row.revokedAt ? (
                      <form action={revokeApiKeyAction}>
                        <input type="hidden" name="credentialId" value={row.id} />
                        <button type="submit" className={secondaryButton} disabled={!canManage}>
                          Revoke {row.name}
                        </button>
                      </form>
                    ) : null}
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
