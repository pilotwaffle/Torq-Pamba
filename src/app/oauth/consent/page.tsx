import { cookies, headers } from "next/headers";
import { PublicFooter, PublicHeader } from "@/components/public-chrome";
import { cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { approveOAuthAction, denyOAuthAction } from "@/lib/platform/actions";
import { OAuthError, PENDING_COOKIE, validateAuthorizeRequest } from "@/lib/platform/authserver";

export const dynamic = "force-dynamic";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { workspace, role } = await requireWorkspace();
  const raw = (await cookies()).get(PENDING_COOKIE)?.value ?? "";
  const head = await headers();
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || `${head.get("x-forwarded-proto") ?? "http"}://${head.get("host") ?? "localhost"}`;
  let request: Awaited<ReturnType<typeof validateAuthorizeRequest>> | null = null;
  let problem = "";
  try {
    request = await validateAuthorizeRequest(new URLSearchParams(raw), base);
  } catch (error) {
    problem = error instanceof OAuthError ? error.message : "This authorization request is no longer valid.";
  }
  const canWrite = role === "owner" || role === "admin";

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-lg px-4 py-12">
        <section className={`${cardClass} p-6`} aria-labelledby="consent-heading">
          <h1 id="consent-heading" className="text-xl font-semibold">
            {request ? `Allow ${request.clientName} to use ${workspace.name}?` : "Authorization request expired"}
          </h1>
          {params.error ? (
            <p role="alert" className="mt-3 text-sm text-rose-700">
              {params.error}
            </p>
          ) : null}
          {!request ? (
            <p className="mt-3 text-sm">{problem || "Start again from your app."}</p>
          ) : (
            <>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                <li>Read videos, schedule, analytics and Knowledge in this workspace.</li>
                {request.scope === "write" ? <li>Generate videos, spending this workspace&apos;s budget (only on success).</li> : null}
                <li>It cannot approve, schedule, or publish videos, or see your password.</li>
                <li>
                  It will be sent back to <span className="font-mono text-xs">{new URL(request.redirectUri).host}</span>.
                </li>
              </ul>
              <form action={approveOAuthAction} className="mt-5 space-y-3">
                {request.scope === "write" ? (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="grantWrite" defaultChecked={canWrite} disabled={!canWrite} />
                      Allow generating videos{!canWrite ? " (owner or admin only)" : ""}
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium">Monthly credit ceiling for this app (credits, $0.01 each)</span>
                      <input name="maxCredits" type="number" min="0" step="1" defaultValue="1000" className={fieldClass} aria-label="Monthly credit ceiling for this app" />
                    </label>
                  </>
                ) : null}
                <div className="flex gap-2">
                  <button type="submit" className={primaryButton}>
                    Allow
                  </button>
                </div>
              </form>
              <form action={denyOAuthAction} className="mt-2">
                <button type="submit" className={secondaryButton}>
                  Deny
                </button>
              </form>
            </>
          )}
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
