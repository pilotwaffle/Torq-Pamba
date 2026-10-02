import type { ReactNode } from "react";

export type NavItem = {
  /** Must have a page at `src/app${href}/page.tsx`. */
  href: string;
  label: string;
  /** Sort key. Gaps are deliberate: pick an unused number between neighbours instead of renumbering. */
  order: number;
  icon: ReactNode;
  /** Highlight only on the exact path, not on sub-paths. */
  exact?: boolean;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** Workspace sidebar. A feature adds its page with one entry; order comes from `order`, not position. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/app",
    label: "Dashboard",
    order: 100,
    exact: true,
    icon: (
      <Icon>
        <path d="M4 10.5 12 4l8 6.5V20H4z" />
        <path d="M10 20v-6h4v6" />
      </Icon>
    ),
  },
  {
    href: "/app/onboarding",
    label: "Onboarding",
    order: 200,
    icon: (
      <Icon>
        <path d="M5 4h9l5 5v11H5z" />
        <path d="M14 4v5h5" />
        <path d="M8 13h8M8 17h5" />
      </Icon>
    ),
  },
  {
    href: "/app/brief",
    label: "Brand brief",
    order: 300,
    icon: (
      <Icon>
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M15 3v4h4" />
        <path d="M10 12h6M10 16h6" />
      </Icon>
    ),
  },
  {
    href: "/app/avatars",
    label: "Avatars",
    order: 400,
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 19c1.4-3 3.6-4.5 7-4.5S17.6 16 19 19" />
      </Icon>
    ),
  },
  {
    href: "/app/chat",
    label: "Chat",
    order: 500,
    icon: (
      <Icon>
        <path d="M5 6h14v9H8l-3 3z" />
      </Icon>
    ),
  },
  {
    href: "/app/videos",
    label: "Videos",
    order: 600,
    icon: (
      <Icon>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-2v8l-5-2z" />
      </Icon>
    ),
  },
  {
    href: "/app/schedule",
    label: "Schedule",
    order: 700,
    icon: (
      <Icon>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </Icon>
    ),
  },
  {
    href: "/app/accounts",
    label: "Accounts",
    order: 750,
    icon: (
      <Icon>
        <circle cx="8" cy="9" r="2.5" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M3.5 18c.8-2.4 2.4-3.5 4.5-3.5s3.7 1.1 4.5 3.5M11.5 18c.8-2.4 2.4-3.5 4.5-3.5s3.7 1.1 4.5 3.5" />
      </Icon>
    ),
  },
  {
    href: "/app/analytics",
    label: "Analytics",
    order: 800,
    icon: (
      <Icon>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </Icon>
    ),
  },
  {
    href: "/app/billing",
    label: "Billing",
    order: 900,
    icon: (
      <Icon>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </Icon>
    ),
  },
  {
    href: "/app/settings",
    label: "Settings",
    order: 1000,
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      </Icon>
    ),
  },
];

export function sortedNavItems(items: readonly NavItem[] = NAV_ITEMS): NavItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.href.localeCompare(b.href));
}

export function isNavItemActive(item: Pick<NavItem, "href" | "exact">, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
