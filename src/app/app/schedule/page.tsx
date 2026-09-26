import Link from "next/link";
import { PageHeader, StatusBadge, cardClass, secondaryButton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth/guards";
import { cancelAction, rescheduleAction } from "@/lib/schedule-actions";
import { formatWhen, listSchedule, SCHEDULE_BANNER, scheduleStatusLabel } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const field = "rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm shadow-sm";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const { workspace } = await requireWorkspace();
  const items = await listSchedule(workspace.id);

  return (
    <main className="max-w-5xl">
      <PageHeader
        title="Schedule"
        description="Approved clips wait here until you publish them yourself."
      />
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
        {SCHEDULE_BANNER}
      </p>
      {params.error ? (
        <p className="mt-4 text-sm text-rose-700" role="alert">
          {params.error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-6 text-sm">
          Nothing is queued yet. Approve a video, then pick a slot on its page.{" "}
          <Link href="/app/videos" className="font-medium text-emerald-800 underline-offset-2 hover:underline">
            Videos
          </Link>
        </p>
      ) : (
        <div className={`${cardClass} mt-6 overflow-x-auto`}>
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th scope="col" className="px-4 py-3 font-medium">
                  Video
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Slot
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const title = item.title || "Untitled";
                return (
                  <tr key={item.id} className="border-b border-zinc-100 align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <Link href={`/app/videos/${item.videoId}`} className="font-medium text-emerald-800 underline-offset-2 hover:underline">
                        {title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatWhen(item.scheduledAt, workspace.timezone)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status}>{scheduleStatusLabel(item.status)}</StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={rescheduleAction} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="itemId" value={item.id} />
                          <input
                            type="datetime-local"
                            name="slot"
                            aria-label={`New slot for ${title}`}
                            className={field}
                          />
                          <button type="submit" className={secondaryButton}>
                            Reschedule
                          </button>
                        </form>
                        <form action={cancelAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <button type="submit" className={secondaryButton}>
                            Cancel
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
