import { scheduleAction } from "@/lib/schedule-actions";
import { StatusBadge, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";

export { StatusBadge };

export function SchedulePanel({
  videoId,
  mode,
  whenLabel,
}: {
  videoId: string;
  mode: "open" | "scheduled" | "due";
  whenLabel: string;
}) {
  return (
    <section className={`${cardClass} p-4`} aria-labelledby="schedule-heading">
      <h2 id="schedule-heading" className="text-lg font-semibold">
        Schedule
      </h2>
      {mode === "scheduled" ? (
        <div className="mt-3 flex flex-col items-start gap-2">
          <p role="status">Scheduled for {whenLabel}</p>
          <StatusBadge status="scheduled">Scheduled</StatusBadge>
        </div>
      ) : mode === "due" ? (
        <div className="mt-3 flex flex-col items-start gap-2 text-sm">
          <StatusBadge status="due_manual">Ready to publish manually</StatusBadge>
          <p>Slot was {whenLabel}.</p>
        </div>
      ) : (
        <form action={scheduleAction} className="mt-3 flex max-w-md flex-col items-start gap-3">
          <input type="hidden" name="videoId" value={videoId} />
          <div className="flex w-full flex-col gap-1">
            <label htmlFor="publish-slot" className="text-sm font-medium">
              Publish slot
            </label>
            <input id="publish-slot" name="slot" type="datetime-local" className={fieldClass} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" name="mode" value="slot" className={primaryButton}>
              Schedule
            </button>
            <button type="submit" name="mode" value="next" className={secondaryButton}>
              Next good slot
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
