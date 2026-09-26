import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/public-chrome";
import { cardClass, fieldClass, primaryButton } from "@/components/ui";
import { loginAction } from "@/lib/auth/actions";
import { authHref, safeNext } from "@/lib/auth/redirects";
import { readSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNext(params.next);
  const session = await readSession();
  if (session) redirect(nextPath);

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className={`${cardClass} mx-4 mt-12 max-w-md px-6 py-8 sm:mx-auto`}>
        <h1 className="text-2xl font-semibold">Log in</h1>
        {params.error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {params.error}
          </p>
        ) : null}
        <form action={loginAction} className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={nextPath} />
          <div className="flex flex-col gap-1">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={fieldClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={fieldClass}
            />
          </div>
          <button type="submit" className={primaryButton}>
            Log in
          </button>
        </form>
        <p className="mt-4 text-sm">
          <Link href={authHref("/signup", nextPath)} className="underline">
            Create account
          </Link>
        </p>
      </main>
    </div>
  );
}
