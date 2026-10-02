import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse";

export function uniqueEmail(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "user";
  return `${slug}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

/** Fills the signup form on the current page and waits for the dashboard. */
export async function signUp(page: Page, email: string, workspaceName = "Northwind Studio"): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** Opens /signup and creates a fresh account, so a spec never shares a workspace with another. */
export async function signUpFresh(page: Page, label: string, workspaceName?: string): Promise<string> {
  const email = uniqueEmail(label);
  await page.goto("/signup");
  await signUp(page, email, workspaceName);
  return email;
}
