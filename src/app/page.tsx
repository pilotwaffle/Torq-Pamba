import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-chrome";
import { PLANS } from "@/lib/billing";
import { estimateClipCost, formatUsd, type Tier } from "@/lib/pricing";

export const metadata = {
  description:
    "AI UGC videos for your brand — made by agents, approved by you, posted only through official APIs.",
};

const HERO =
  "AI UGC videos for your brand — made by agents, approved by you, posted only through official APIs";

const steps = [
  {
    title: "Onboard your site",
    body: "We fetch the public page and show each field next to the sentence it came from. No site yet? Type the brief yourself.",
  },
  {
    title: "Brand brief & avatar",
    body: "Confirm the company and niche, then choose an avatar that stays in this workspace.",
  },
  {
    title: "Chat to create",
    body: "Ask for a clip in plain language. The agent answers with a three-scene plan, hooks, and captions.",
  },
  {
    title: "See the cost first",
    body: "Script, frames, video, and voice are priced before anything is generated. Generating takes a click.",
  },
  {
    title: "Approve",
    body: "Set privacy and consents. The AI label starts on. Approve stays off until the form is complete.",
  },
  {
    title: "Schedule",
    body: "Pick a time, or take the next 9:00, 12:00, or 18:00 in the workspace timezone.",
  },
];

const compare: { feature: string; pamba: string; torq: string }[] = [
  {
    feature: "Make the clip",
    pamba: "AI UGC for a brand",
    torq: "AI UGC for a brand, from a chat plan",
  },
  {
    feature: "Cost before generate",
    pamba: "Included in the hosted product",
    torq: "Listed first. Nothing runs until you click Generate",
  },
  {
    feature: "Approval",
    pamba: "Built to carry a clip through to posting",
    torq: "Required. An unapproved video cannot be scheduled",
  },
  {
    feature: "Schedule",
    pamba: "Yes",
    torq: "A time you pick, or the next 9:00, 12:00, or 18:00",
  },
  {
    feature: "Posting",
    pamba: "Posts for you",
    torq: "Does not post. Due items are marked ready to publish manually",
  },
  {
    feature: "Accounts",
    pamba: "Connected so the product can post",
    torq: "You own your accounts",
  },
  {
    feature: "AI disclosure",
    pamba: "Follows the platform when a post goes out",
    torq: "On by default. Turning it off is an explicit, logged step",
  },
];

const clipTiers: { tier: Tier; label: string; model: string }[] = [
  { tier: "budget", label: "Budget", model: "Veo 3.1 Lite" },
  { tier: "standard", label: "Standard", model: "Gemini Omni Flash" },
  { tier: "premium", label: "Premium", model: "Veo 3.1 Standard" },
];

function HeroPhone() {
  return (
    <aside className="mx-auto w-[240px]" aria-label="Example queue">
      <div className="rounded-[2rem] border-[6px] border-zinc-900 bg-zinc-900 shadow-xl shadow-emerald-950/10">
        <div className="overflow-hidden rounded-[1.45rem] bg-zinc-50 text-zinc-950">
          <div className="flex justify-center bg-zinc-900 py-1.5">
            <span className="h-1.5 w-12 rounded-full bg-zinc-700" />
          </div>
          <div className="space-y-2.5 px-3 py-3">
            <div className="mx-auto h-28 w-[4.75rem] rounded-xl bg-gradient-to-b from-emerald-200 via-emerald-500 to-emerald-900 shadow-inner" />
            <div>
              <p className="text-[12px] font-semibold">Northwind Cold Brew</p>
              <p className="text-[11px] text-zinc-600">Oat-milk, 30 seconds</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5">
              <p className="text-[9px] font-medium tracking-wide text-zinc-400 uppercase">Who can view this video</p>
              <p className="text-[11px]">Only me</p>
            </div>
            <p className="flex items-center gap-1.5 text-[11px]">
              <span className="grid h-3.5 w-3.5 place-items-center rounded bg-emerald-700 text-[9px] text-white">✓</span>
              AI-generated content label
            </p>
            <p className="rounded-md bg-emerald-700 py-1.5 text-center text-[11px] font-medium text-white">Approve</p>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px]">
              <p className="display-serif text-sm text-emerald-950">Example queue</p>
              <p className="mt-1 font-medium">Sunday, 9:00 AM</p>
              <p className="font-medium text-emerald-800">Scheduled</p>
              <p className="mt-1 text-emerald-900/80">Not posted. Due items wait for you.</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-950">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5">
        <section className="grid items-center gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16 lg:py-20">
          <div>
            <div className="mb-5 h-1 w-12 rounded-full bg-emerald-600" />
            <h1 className="display-serif max-w-xl text-4xl leading-[1.15] text-pretty sm:text-5xl">{HERO}</h1>
            <p className="mt-5 max-w-md text-lg leading-7 text-zinc-700">
              You approve every clip. Torq-Pamba schedules it and does not post it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800">
                Get started
              </Link>
              <Link href="/login" className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-zinc-50">
                Log in
              </Link>
            </div>
          </div>
          <HeroPhone />
        </section>

        <section className="border-t border-zinc-200 py-14" aria-labelledby="how-heading">
          <h2 id="how-heading" className="display-serif text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="border-t border-zinc-300 pt-4">
                <h3 className="font-semibold">
                  <span className="display-serif mr-2 text-emerald-700">{index + 1}</span>
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-700">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-zinc-200 py-14" aria-labelledby="compare-heading">
          <h2 id="compare-heading" className="display-serif text-3xl">
            Pamba and Torq-Pamba
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-700">
            Pamba publishes finished videos. Torq-Pamba makes the video, waits for your approval, and
            schedules it. Official posting is a later phase, after app review.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Feature
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Pamba
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Torq-Pamba
                  </th>
                </tr>
              </thead>
              <tbody>
                {compare.map((row) => (
                  <tr key={row.feature} className="border-b border-zinc-200 align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {row.feature}
                    </th>
                    <td className="py-3 pr-4 text-zinc-700">{row.pamba}</td>
                    <td className="py-3">{row.torq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-t border-zinc-200 py-14" aria-labelledby="cost-heading">
          <h2 id="cost-heading" className="display-serif text-3xl">
            Cost per 30 seconds
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-700">
            Our list-price COGS for one clip, without a separate voice pass. Optional voice-over adds a
            few cents. These are model costs, not the subscription.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Tier
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    30 seconds
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Default model
                  </th>
                </tr>
              </thead>
              <tbody>
                {clipTiers.map((row) => (
                  <tr key={row.tier} className="border-b border-zinc-200">
                    <th scope="row" className="py-3 pr-4 text-left font-medium">
                      {row.label}
                    </th>
                    <td className="py-3 pr-4">{formatUsd(estimateClipCost({ tier: row.tier, durationS: 30 }).total)}</td>
                    <td className="py-3 text-zinc-700">{row.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-t border-zinc-200 py-14" aria-labelledby="compliance-heading">
          <h2 id="compliance-heading" className="display-serif text-3xl">
            Compliance
          </h2>
          <ul className="mt-6 max-w-2xl list-disc space-y-2 pl-5 text-sm leading-6">
            <li>AI disclosure is on by default. Turning it off takes an explicit confirmation and is logged.</li>
            <li>You own your accounts.</li>
            <li>No device farms, warming, account trading or metadata stripping.</li>
            <li>
              Torq-Pamba never posts from devices. Phase 2, after app review, uses only the official
              TikTok, Instagram, and Facebook APIs.
            </li>
          </ul>
        </section>

        <section className="border-t border-zinc-200 py-14" aria-labelledby="pricing-heading">
          <h2 id="pricing-heading" className="display-serif text-3xl">
            Pricing
          </h2>
          <p className="mt-3 text-sm text-zinc-700">Placeholder test-mode prices.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`rounded-xl border bg-white p-5 shadow-sm ${plan.id === "creator" ? "border-emerald-300 ring-1 ring-emerald-200" : "border-zinc-200"}`}
              >
                <h3 className="font-semibold">{plan.name}</h3>
                <p className="display-serif mt-2 text-3xl">
                  ${plan.monthlyUsd}
                  {plan.paid ? <span className="text-base text-zinc-600">/mo</span> : null}
                </p>
                <p className="mt-2 text-sm text-zinc-700">{plan.blurb}</p>
              </div>
            ))}
          </div>
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-800"
          >
            Get started
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
