import type { Metadata } from "next";
import { PublicPage } from "@/components/public-chrome";
import { cardClass, fieldClass, primaryButton } from "@/components/ui";
import { requestServiceAction } from "@/lib/service-actions";

export const metadata: Metadata = { title: "Done-with-you video service" };

export default async function DoneWithYouPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const params = await searchParams;
  return (
    <PublicPage>
      <h1 className="display-serif text-3xl text-zinc-950">Done with you</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-700">
        Our team runs Torq-Pamba for you: brief, hooks, generation, hook tests on Trial Reels, and the weekly report. You keep ownership of your accounts and
        approve every video before it posts.
      </p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-700">
        <li>Official TikTok, Instagram and Facebook APIs only, on accounts you connect. No device farms, account warming, or bought accounts.</li>
        <li>AI disclosure stays on. Paid partnerships are labeled.</li>
        <li>Generation spend comes out of your workspace budget, with the same caps and itemized costs you see in the app.</li>
        <li>Pricing is quoted per month after a call. Nothing is billed from this form.</li>
      </ul>
      <section id="request" className={`${cardClass} mt-8 p-5`} aria-labelledby="request-heading">
        <h2 id="request-heading" className="text-lg font-semibold">
          Request a call
        </h2>
        {params.sent ? (
          <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Thanks. We&apos;ll reply by email within two business days.
          </p>
        ) : null}
        {params.error ? (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {params.error}
          </p>
        ) : null}
        <form action={requestServiceAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input name="name" className={fieldClass} aria-label="Name" autoComplete="name" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Work email</span>
            <input name="email" type="email" className={fieldClass} aria-label="Work email" autoComplete="email" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Company</span>
            <input name="company" className={fieldClass} aria-label="Company" autoComplete="organization" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Videos per month</span>
            <input name="monthlyVideos" type="number" min={1} max={1000} defaultValue={20} className={fieldClass} aria-label="Videos per month" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">What do you sell, and who to?</span>
            <textarea name="message" rows={3} className={fieldClass} aria-label="What do you sell, and who to?" maxLength={2000} />
          </label>
          <label className="hidden" aria-hidden="true">
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className={primaryButton}>
              Request a call
            </button>
          </div>
        </form>
      </section>
    </PublicPage>
  );
}
