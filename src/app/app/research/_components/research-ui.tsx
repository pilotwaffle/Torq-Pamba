import Link from "next/link";
import type { ReactNode } from "react";
import type { ViralPost } from "@/db/schema";
import { cardClass, PageHeader, secondaryButton } from "@/components/ui";
import { generateIdeasAction } from "@/lib/research/actions";
import { engagementRate, formatCount } from "@/lib/research/metrics";
import { postData } from "@/lib/research/posts";
import { researchSource } from "@/lib/research/source";
import { PLATFORM_LABEL } from "@/lib/research/types";

const TABS = [
  { key: "ideas", href: "/app/research", label: "Ideas" },
  { key: "discover", href: "/app/research/discover", label: "Discover" },
  { key: "trends", href: "/app/research/trends", label: "Trends" },
  { key: "accounts", href: "/app/research/accounts", label: "Accounts" },
] as const;

export type ResearchTab = (typeof TABS)[number]["key"];

export function ResearchHeader({ current, error, children }: { current: ResearchTab; error?: string; children?: ReactNode }) {
  const source = researchSource();
  return (
    <>
      <PageHeader
        title="Research"
        description="Track inspiration accounts, find short videos that outperformed, spot trends, and turn them into video ideas for your brand."
      />
      <nav aria-label="Research sections" className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab.key === current ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-600 hover:text-zinc-950"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {source.sample ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm leading-6 text-amber-950">
          Sample data: no research source is connected, so posts, accounts, and trends are realistic fixtures. Set{" "}
          <code>RESEARCH_SOURCE</code> and its key to use the YouTube Data API, ScrapeCreators, or Apify.
        </p>
      ) : (
        <p className="mb-4 text-xs text-zinc-500">Source: {source.label}. Public data only.</p>
      )}
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error.slice(0, 300)}
        </p>
      ) : null}
      {children}
    </>
  );
}

const PLATFORM_TONE: Record<string, string> = {
  tiktok: "from-zinc-900 to-rose-700",
  instagram: "from-fuchsia-700 to-amber-500",
  youtube: "from-red-700 to-zinc-900",
  facebook: "from-sky-700 to-indigo-800",
};

export function PostCard({ post, ideaButton = true }: { post: ViralPost; ideaButton?: boolean }) {
  const data = postData(post);
  const notes = data.notes ?? [];
  const seconds = post.durationMs ? Math.round(post.durationMs / 1000) : null;
  const title = post.hook ?? post.caption ?? "Untitled post";
  return (
    <article aria-label={title} className={`${cardClass} flex flex-col overflow-hidden`}>
      <div className={`flex h-24 items-end justify-between bg-gradient-to-br p-3 text-white ${PLATFORM_TONE[post.platform] ?? "from-zinc-700 to-zinc-900"}`}>
        <span className="text-xs font-semibold tracking-wide uppercase">{PLATFORM_LABEL[post.platform]}</span>
        <span className="flex items-center gap-2 text-xs">
          {post.outlierScore ? (
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold">{post.outlierScore}× baseline</span>
          ) : null}
          {seconds ? <span>{seconds}s</span> : null}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-xs text-zinc-500">
            {post.authorHandle ? `@${post.authorHandle}` : "Unknown author"}
            {data.niche ? ` · ${data.niche}` : ""}
            {post.postedAt ? ` · ${post.postedAt.toISOString().slice(0, 10)}` : ""}
          </p>
          <h3 className="mt-1 text-sm leading-5 font-medium text-zinc-950">{title}</h3>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Metric label="Views" value={formatCount(post.views)} />
          <Metric label="Likes" value={formatCount(post.likes)} />
          <Metric label="Comments" value={formatCount(post.comments)} />
          <Metric label="Shares" value={formatCount(post.shares)} />
          <Metric label="Saves" value={formatCount(post.saves)} />
          <Metric label="Engagement" value={`${data.engagementPct ?? engagementRate(post)}%`} />
        </dl>
        {notes.length ? (
          <section aria-label="Why it worked">
            <h4 className="text-xs font-semibold text-zinc-700">Why it worked</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-zinc-700">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {ideaButton ? (
            <form action={generateIdeasAction}>
              <input type="hidden" name="viralPostId" value={post.id} />
              <input type="hidden" name="count" value="2" />
              <button type="submit" className={`${secondaryButton} px-3 py-1.5 text-xs`}>
                Ideas from this post
              </button>
            </form>
          ) : null}
          {data.sample ? (
            <span className="text-xs text-zinc-500">Sample post</span>
          ) : (
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-800 hover:underline">
              Open post
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2 py-1.5">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-900">{value}</dd>
    </div>
  );
}
