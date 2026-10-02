import type { ReactNode } from "react";
import type { Workspace } from "@/db/schema";
import { CreditBalanceWidget } from "@/components/credits/balance-widget";
import { planLabel } from "@/components/ui";

export type SidebarWidgetProps = { workspace: Workspace };

export type SidebarWidget = {
  id: string;
  /** Sort key under the workspace name. Gaps are deliberate. */
  order: number;
  /** Rendered on the server for every /app page; keep it cheap or make it an async server component. */
  render: (props: SidebarWidgetProps) => ReactNode;
};

/** Widgets under the workspace name in the sidebar. A feature adds one entry. */
export const SIDEBAR_WIDGETS: readonly SidebarWidget[] = [
  {
    id: "plan",
    order: 100,
    render: ({ workspace }) => (
      <span className="mt-2 inline-flex rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium tracking-wide text-emerald-200 uppercase">
        {planLabel(workspace.plan)}
      </span>
    ),
  },
  { id: "credit-balance", order: 200, render: ({ workspace }) => <CreditBalanceWidget workspaceId={workspace.id} /> },
];

export function sortedSidebarWidgets(widgets: readonly SidebarWidget[] = SIDEBAR_WIDGETS): SidebarWidget[] {
  return [...widgets].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
