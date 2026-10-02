import type { Locator, Page } from "@playwright/test";

export function workspaceNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Workspace" });
}

export function workspaceLink(page: Page, name: string): Locator {
  return workspaceNav(page).getByRole("link", { name, exact: true });
}
