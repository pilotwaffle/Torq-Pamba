import { Fragment, type ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { sortedSidebarWidgets } from "@/components/app-shell/sidebar.config";
import { logoutAction } from "@/lib/auth/actions";
import { requireWorkspace } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { workspace } = await requireWorkspace();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100 md:flex-row">
      <aside className="flex w-full shrink-0 flex-col bg-zinc-950 text-zinc-100 md:min-h-screen md:w-60">
        <div className="px-4 py-5">
          <div className="text-sm font-semibold tracking-wide">Torq-Pamba</div>
          <div className="mt-2 truncate text-sm text-zinc-100">{workspace.name}</div>
          {sortedSidebarWidgets().map((widget) => (
            <Fragment key={widget.id}>{widget.render({ workspace })}</Fragment>
          ))}
        </div>
        <AppNav />
        <form action={logoutAction} className="border-t border-zinc-800 p-3">
          <button
            type="submit"
            className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            Log out
          </button>
        </form>
      </aside>
      <div className="min-w-0 flex-1 bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6 md:px-8 md:py-8">{children}</div>
    </div>
  );
}
