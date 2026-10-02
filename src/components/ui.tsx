import type { ReactNode } from "react";

export const primaryButton =
  "inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton =
  "inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";

export const fieldClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20";

export const cardClass = "rounded-xl border border-zinc-200 bg-white shadow-sm";

const STATUS_TONE: Record<string, string> = {
  ready: "bg-sky-50 text-sky-800 ring-sky-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  scheduled: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  due_manual: "bg-amber-50 text-amber-950 ring-amber-200",
  failed: "bg-rose-50 text-rose-800 ring-rose-200",
  generating: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  draft: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  planned: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  canceled: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function statusLabel(status: string): string {
  if (status === "due_manual") return "Ready to publish manually";
  if (status === "scheduled") return "Scheduled";
  if (status === "ready") return "Ready";
  if (status === "approved") return "Approved";
  if (status === "failed") return "Failed";
  if (status === "generating") return "Generating";
  if (status === "canceled") return "Canceled";
  if (status === "planned") return "Planned";
  if (status === "draft") return "Draft";
  return status;
}

function statusKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (key === "ready_to_publish_manually") return "due_manual";
  return key;
}

export function StatusBadge({ status, children }: { status?: string; children: string }) {
  const key = statusKey(status ?? children);
  const tone = STATUS_TONE[key] ?? "bg-zinc-100 text-zinc-700 ring-zinc-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description?: string;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {eyebrow ? <div className="mb-2 text-sm text-zinc-600">{eyebrow}</div> : null}
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
      {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">{description}</p> : null}
    </header>
  );
}

export function planLabel(plan: string): string {
  if (plan === "free") return "Free";
  if (plan === "creator" || plan === "hobby") return "Hobby";
  if (plan === "studio" || plan === "pro") return "Pro";
  return plan;
}
