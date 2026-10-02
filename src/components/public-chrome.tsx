import type React from "react";
import Link from "next/link";

const link = "text-zinc-800 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";

export function PublicHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-zinc-950">
          <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" className="shrink-0">
            <rect x="0.75" y="0.75" width="20.5" height="14.5" rx="1.5" fill="none" stroke="currentColor" />
            <path d="M7 0.75v14.5M15 0.75v14.5" stroke="currentColor" />
          </svg>
          Torq-Pamba
        </Link>
        <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link href="/tools" className={link}>
            Free tools
          </Link>
          <Link href="/done-with-you" className={link}>
            Done with you
          </Link>
          <Link href="/terms" className={link}>
            Terms
          </Link>
          <Link href="/privacy" className={link}>
            Privacy
          </Link>
          <Link href="/login" className={link}>
            Log in
          </Link>
          <Link href="/signup" className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-2 px-5 py-6 text-sm">
        <Link href="/terms" className={link}>
          Terms of Service
        </Link>
        <Link href="/privacy" className={link}>
          Privacy Policy
        </Link>
        <Link href="/docs/api" className={link}>
          API and MCP
        </Link>
      </div>
    </footer>
  );
}

export function PublicPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-3xl"} flex-1 px-5 py-10`}>{children}</main>
      <PublicFooter />
    </div>
  );
}
