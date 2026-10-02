import { scheduleAction } from "@/lib/schedule-actions";
import { StatusBadge, cardClass, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { PLATFORM_LABEL, PLATFORM_MODES, type Platform } from "@/lib/publish/config";

export { StatusBadge };

export type ScheduleAccount = { id: string; platform: Platform; handle: string; mode: string };

export function SchedulePanel({
  videoId,
  mode,
  whenLabel,
  accounts = [],
}: {
  videoId: string;
  mode: "open" | "scheduled" | "due" | "publishing";
  whenLabel: string;
  accounts?: ScheduleAccount[];
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
      ) : mode === "publishing" ? (
        <div className="mt-3 flex flex-col items-start gap-2 text-sm">
          <p role="status">Sent to publisher ({whenLabel})</p>
        </div>
      ) : (
        <form action={scheduleAction} className="mt-3 flex max-w-md flex-col items-start gap-3">
          <input type="hidden" name="videoId" value={videoId} />
          {accounts.length > 0 ? (
            <fieldset className="flex w-full flex-col gap-2">
              <legend className="text-sm font-medium">Post to (official APIs)</legend>
              {accounts.map((account) => {
                const label = `${PLATFORM_LABEL[account.platform]} ${account.handle}`;
                return (
                  <div key={account.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="target" value={account.id} />
                      Post to {label}
                    </label>
                    <select name={`mode-${account.id}`} aria-label={`${label} format`} className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm">
                      {PLATFORM_MODES[account.platform].map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </fieldset>
          ) : (
            <p className="text-sm text-zinc-600">No connected accounts: when the slot arrives this clip is marked “Ready to publish manually”.</p>
          )}
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
            {accounts.length > 0 ? (
              <button type="submit" name="mode" value="now" className={secondaryButton}>
                Post now
              </button>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
