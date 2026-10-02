"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, sortedNavItems } from "@/components/app-shell/nav.config";

const ITEMS = sortedNavItems();

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-row flex-wrap gap-1 px-2 pb-3 md:flex-col">
      {ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 ${
              active ? "bg-emerald-400/15 font-medium text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
