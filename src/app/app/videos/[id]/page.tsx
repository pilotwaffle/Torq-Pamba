import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/approval-panel";
import { PreviewPlayer } from "@/components/preview-player";
import { SchedulePanel } from "@/components/schedule-panel";
import { PageHeader, StatusBadge, cardClass, statusLabel } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { PRIVACY_OPTIONS } from "@/lib/approval";
import { activeItemForVideo, formatWhen } from "@/lib/schedule";
import { attemptSummaryFor, getWorkspaceVideo, manifestOf } from "@/lib/videos";

export const dynamic = "force-dynamic";

const PRIVACY_LABEL = new Map<string, string>(PRIVACY_OPTIONS.map((option) => [option.value, option.label]));

export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { workspace } = await requireWorkspace();
  const video = await getWorkspaceVideo(workspace.id, id);
  if (!video) notFound();

  const manifest = manifestOf(video.manifest);
  const attempts = await attemptSummaryFor(video.id);
  const approval = video.approval ?? {};
  const privacy = typeof approval.privacy === "string" ? approval.privacy : "";
  const queued = await activeItemForVideo(video.id);
  const whenLabel = queued ? formatWhen(queued.scheduledAt, workspace.timezone) : "";
  const queueMode =
    queued?.status === "scheduled" ? "scheduled" : queued?.status === "due_manual" ? "due" : "open";
  const showSchedule = video.status === "approved" || video.status === "scheduled";

  return (
    <main className="max-w-6xl">
      <PageHeader
        eyebrow={
          <Link href="/app/videos" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Videos
          </Link>
        }
        title={video.title || "Untitled"}
      />
      <p className="mb-6 -mt-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        {queueMode === "scheduled" ? (
          <StatusBadge status="scheduled">Scheduled</StatusBadge>
        ) : queueMode === "due" ? (
          <StatusBadge status="due_manual">Ready to publish manually</StatusBadge>
        ) : (
          <StatusBadge status={video.status}>{statusLabel(video.status)}</StatusBadge>
        )}
        {video.tier ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium">{video.tier}</span> : null}
        {video.model ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium">{video.model}</span> : null}
      </p>
      {query.error ? (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {query.error}
        </p>
      ) : null}
      {attempts ? <p className="mb-4 text-sm text-zinc-700">{attempts}</p> : null}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <div>{manifest ? <PreviewPlayer hook={manifest.hook} scenes={manifest.scenes.map((scene) => ({
              frameUrl: scene.frameUrl,
              line: scene.line,
              durationS: scene.durationS,
            }))} /> : null}</div>
        <div className="flex min-w-0 flex-col gap-6">
          {video.status === "ready" ? <ApprovalPanel videoId={video.id} aiDefault={video.aiGenerated} /> : null}
          {showSchedule ? (
            <section className={`${cardClass} p-4 text-sm`} aria-label="Approval">
              <h2 className="text-lg font-semibold">Approved</h2>
              <dl className="mt-3 grid gap-2">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Creator nickname</dt>
                  <dd>{String(approval.creatorNickname ?? "") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Who can view this video</dt>
                  <dd>{PRIVACY_LABEL.get(privacy) ?? privacy}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">AI-generated content label</dt>
                  <dd>{video.aiGenerated ? "On" : "Off"}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          {showSchedule ? <SchedulePanel videoId={video.id} mode={queueMode} whenLabel={whenLabel} /> : null}
        </div>
      </div>
    </main>
  );
}
