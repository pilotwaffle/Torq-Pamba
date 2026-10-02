import Link from "next/link";
import { fieldClass, primaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { refreshDiscoverAction } from "@/lib/research/actions";
import { discoverNiches, listDiscover, workspaceNiche } from "@/lib/research/posts";
import { PLATFORM_LABEL, PLATFORMS, type SocialPlatform } from "@/lib/research/types";
import { PostCard, ResearchHeader } from "../_components/research-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discover · Research" };

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ niche?: string; platform?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const briefNiche = workspaceNiche(workspace.brief);
  const niche = params.niche === "all" ? "" : (params.niche?.trim().slice(0, 120) ?? briefNiche);
  const platform = PLATFORMS.includes(params.platform as SocialPlatform) ? (params.platform as SocialPlatform) : null;
  const [posts, niches] = await Promise.all([
    listDiscover({ workspaceId: workspace.id, niche: niche || null, platform }),
    discoverNiches(workspace.id, briefNiche),
  ]);
  const selected = niches.find((item) => item.toLowerCase() === niche.toLowerCase()) ?? niche;
  const options = selected && !niches.includes(selected) ? [selected, ...niches] : niches;

  return (
    <main className="max-w-6xl">
      <ResearchHeader current="discover" error={params.error}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter Discover">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Niche</span>
              <select name="niche" defaultValue={selected || "all"} className={`${fieldClass} w-56`}>
                <option value="all">All niches</option>
                {options.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Platform</span>
              <select name="platform" defaultValue={platform ?? ""} className={`${fieldClass} w-40`}>
                <option value="">All platforms</option>
                {PLATFORMS.map((item) => (
                  <option key={item} value={item}>
                    {PLATFORM_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-zinc-50">
              Filter
            </button>
          </form>
          <form action={refreshDiscoverAction}>
            <input type="hidden" name="niche" value={niche || briefNiche} />
            {platform ? <input type="hidden" name="platform" value={platform} /> : null}
            <button type="submit" className={primaryButton}>
              Find viral posts
            </button>
          </form>
        </div>

        {posts.length === 0 ? (
          <p className="text-sm text-zinc-600">
            Nothing here yet for {niche || "any niche"}. Click Find viral posts to pull high-performing short videos, or{" "}
            <Link href="/app/research/accounts" className="font-medium text-emerald-800 hover:underline">
              track an account
            </Link>
            .
          </p>
        ) : (
          <div aria-label="Discover feed" role="feed" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </ResearchHeader>
    </main>
  );
}
