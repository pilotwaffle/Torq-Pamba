import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Workspace } from "@/db/schema";
import { isNavItemActive, NAV_ITEMS, sortedNavItems, type NavItem } from "./nav.config";
import { SIDEBAR_WIDGETS, sortedSidebarWidgets } from "./sidebar.config";

describe("app shell config", () => {
  it("has unique hrefs and orders, each backed by a page", () => {
    expect(new Set(NAV_ITEMS.map((item) => item.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.order)).size).toBe(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      expect(item.href).toMatch(/^\/app(\/[a-z0-9-]+)*$/);
      expect(existsSync(path.join(process.cwd(), "src/app", item.href, "page.tsx")), item.href).toBe(true);
    }
  });

  it("keeps the shipped order", () => {
    expect(sortedNavItems().map((item) => item.label)).toEqual([
      "Dashboard",
      "Onboarding",
      "Brand brief",
      "Avatars",
      "Research",
      "Chat",
      "Videos",
      "Schedule",
      "Billing",
      "Settings",
    ]);
  });

  it("slots a new entry by order, wherever it sits in the array", () => {
    const research: NavItem = { href: "/app/research", label: "Research", order: 450, icon: null };
    const labels = sortedNavItems([...NAV_ITEMS, research]).map((item) => item.label);
    expect(labels.indexOf("Research")).toBe(labels.indexOf("Avatars") + 1);
  });

  it("matches exact and nested paths", () => {
    expect(isNavItemActive({ href: "/app", exact: true }, "/app")).toBe(true);
    expect(isNavItemActive({ href: "/app", exact: true }, "/app/videos")).toBe(false);
    expect(isNavItemActive({ href: "/app/videos" }, "/app/videos/abc")).toBe(true);
    expect(isNavItemActive({ href: "/app/videos" }, "/app/videos-old")).toBe(false);
  });

  it("renders sidebar widgets in order with unique ids", () => {
    expect(new Set(SIDEBAR_WIDGETS.map((widget) => widget.id)).size).toBe(SIDEBAR_WIDGETS.length);
    const widgets = sortedSidebarWidgets([
      ...SIDEBAR_WIDGETS,
      { id: "credits", order: 50, render: () => "1,600 credits" },
    ]);
    expect(widgets.map((widget) => widget.id)).toEqual(["credits", "plan"]);
    expect(widgets[0]?.render({ workspace: {} as Workspace })).toBe("1,600 credits");
    expect(SIDEBAR_WIDGETS.find((widget) => widget.id === "plan")?.render({ workspace: { plan: "creator" } as Workspace })).toBeTruthy();
  });
});
