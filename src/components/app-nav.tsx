"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app", label: "Dashboard", exact: true, icon: "dashboard" },
  { href: "/app/onboarding", label: "Onboarding", icon: "onboarding" },
  { href: "/app/brief", label: "Brand brief", icon: "brief" },
  { href: "/app/avatars", label: "Avatars", icon: "avatars" },
  { href: "/app/chat", label: "Chat", icon: "chat" },
  { href: "/app/videos", label: "Videos", icon: "videos" },
  { href: "/app/schedule", label: "Schedule", icon: "schedule" },
  { href: "/app/accounts", label: "Accounts", icon: "accounts" },
  { href: "/app/analytics", label: "Analytics", icon: "analytics" },
  { href: "/app/billing", label: "Billing", icon: "billing" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-row flex-wrap gap-1 px-2 pb-3 md:flex-col">
      {ITEMS.map((item) => {
        const active =
          "exact" in item && item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 ${
              active ? "bg-emerald-400/15 font-medium text-white" : "text-zinc-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NavIcon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: "shrink-0",
  };
  if (name === "dashboard") {
    return (
      <svg {...common}>
        <path d="M4 10.5 12 4l8 6.5V20H4z" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (name === "onboarding") {
    return (
      <svg {...common}>
        <path d="M5 4h9l5 5v11H5z" />
        <path d="M14 4v5h5" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    );
  }
  if (name === "brief") {
    return (
      <svg {...common}>
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M15 3v4h4" />
        <path d="M10 12h6M10 16h6" />
      </svg>
    );
  }
  if (name === "avatars") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 19c1.4-3 3.6-4.5 7-4.5S17.6 16 19 19" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M5 6h14v9H8l-3 3z" />
      </svg>
    );
  }
  if (name === "videos") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-2v8l-5-2z" />
      </svg>
    );
  }
  if (name === "schedule") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </svg>
    );
  }
  if (name === "accounts") {
    return (
      <svg {...common}>
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3.5 18c.8-2.4 2.4-3.5 4.5-3.5s3.7 1.1 4.5 3.5M11.5 18c.8-2.4 2.4-3.5 4.5-3.5s3.7 1.1 4.5 3.5" />
      </svg>
    );
  }
  if (name === "analytics") {
    return (
      <svg {...common}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  }
  if (name === "billing") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
  );
}
