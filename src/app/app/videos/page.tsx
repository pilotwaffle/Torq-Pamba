import Link from "next/link";
import { PageHeader, StatusBadge, cardClass, statusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { listVideos } from "@/lib/videos";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const { workspace } = await requireWorkspace();
  const rows = await listVideos(workspace.id);

  return (
    <main className="max-w-3xl">
      <PageHeader title="Videos" description="Review a clip, approve it, then put it on the schedule." />
      {rows.length === 0 ? (
        <p className="text-sm">
          No videos yet.{" "}
          <Link href="/app/chat" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Plan one in chat
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((video) => (
            <li key={video.id} className={`${cardClass} flex items-center justify-between gap-3 px-4 py-3`}>
              <Link href={`/app/videos/${video.id}`} className="min-w-0 truncate text-sm font-medium hover:text-emerald-800">
                {video.title || "Untitled"}
              </Link>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge status={video.status}>{statusLabel(video.status)}</StatusBadge>
                {video.tier ? <span className="text-xs text-zinc-500">{video.tier}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
