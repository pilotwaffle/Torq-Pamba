import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_URL = "http://localhost:3100/demo-site";
export const VIDEO_PROMPT =
  "Make a 30s video about our oat-milk cold brew for busy commuters";

const PASSWORD = "correct-horse";

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function workspaceLink(page: Page, name: string): Locator {
  return page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name, exact: true });
}

async function hold(page: Page, pace: boolean): Promise<void> {
  if (pace) await page.waitForTimeout(750);
}

async function shot(page: Page, pace: boolean, name: string, focus?: Locator): Promise<void> {
  if (!pace) return;
  if (focus) await focus.scrollIntoViewIfNeeded();
  await page.waitForTimeout(750);
  await page.screenshot({ path: `docs/images/${name}`, fullPage: true });
}

export async function signUp(page: Page, email: string, workspaceName = "Northwind Studio"): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/** Full mock journey from the public landing page through the schedule queue. */
export async function runMockJourney(page: Page, options: { pace?: boolean; email?: string } = {}): Promise<void> {
  const pace = options.pace ?? false;
  const email = options.email ?? uniqueEmail("journey");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Terms", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  await shot(page, pace, "01-landing.png");

  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await hold(page, pace);
  await signUp(page, email);
  await hold(page, pace);

  await workspaceLink(page, "Onboarding").click();
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await page.getByLabel("Website URL").fill(DEMO_URL);
  await hold(page, pace);
  await page.getByRole("button", { name: "Analyze website" }).click();

  await expect(page.getByLabel("Company name")).toHaveValue("Northwind Cold Brew");
  await expect(page.getByRole("columnheader", { name: "Source text" })).toBeVisible();
  await expect(page.getByText("Northwind Cold Brew").first()).toBeVisible();
  await expect(page.getByText("Made for busy commuters and remote workers").first()).toBeVisible();
  await shot(page, pace, "02-onboarding-extract.png", page.getByRole("table", { name: "Review the extraction" }));

  await page.getByRole("button", { name: "Save brand brief" }).click();
  await expect(page.getByRole("heading", { name: "Brand", exact: true })).toBeVisible();
  await expect(page.getByLabel("Company name")).toHaveValue("Northwind Cold Brew");
  await expect(page.getByLabel("Niche")).not.toHaveValue("");
  await shot(page, pace, "03-brand-brief.png", page.getByRole("heading", { name: "Brand", exact: true }));

  await page.getByRole("button", { name: "Confirm brief" }).click();
  await expect(page.getByRole("heading", { name: "Media", exact: true })).toBeVisible();
  const rights = page.getByRole("checkbox", { name: "I have the rights to use this" });
  await expect(rights.first()).toBeVisible();
  await rights.first().check();
  await hold(page, pace);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Avatar", exact: true })).toBeVisible();
  const matched = page.getByRole("region", { name: "Matched to your niche" });
  await expect(matched.getByRole("button", { name: "Use this avatar" }).first()).toBeVisible();
  await shot(page, pace, "04-avatars.png", matched);
  await matched.getByRole("button", { name: "Use this avatar" }).first().click();
  await expect(page.getByRole("heading", { name: "Your avatars" })).toBeVisible();
  await hold(page, pace);

  await workspaceLink(page, "Chat").click();
  await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
  await page.getByLabel("Message").fill(VIDEO_PROMPT);
  await hold(page, pace);
  await page.getByRole("button", { name: "Send" }).click();

  const total = page.getByRole("row", { name: "Total" });
  await expect(page.getByRole("table", { name: "Cost preview" })).toBeVisible();
  await expect(total).toContainText("$3.32");
  await page.getByLabel("Quality tier").selectOption("budget");
  await expect(total).toContainText("$1.59");
  await hold(page, pace);
  await page.getByLabel("Quality tier").selectOption("standard");
  await expect(total).toContainText("$3.32");
  await shot(page, pace, "05-chat-cost-preview.png", page.getByRole("table", { name: "Cost preview" }));

  await page.getByRole("button", { name: "Generate (est. $3.32)" }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await hold(page, pace);
  await page.getByRole("link", { name: "Review & approve" }).click();

  await expect(page.getByText("Mock provider — placeholder frames")).toBeVisible();
  const aiLabel = page.getByRole("checkbox", { name: "AI-generated content label" });
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(aiLabel).toBeChecked();
  await expect(approve).toBeDisabled();
  await shot(page, pace, "06-video-preview.png", page.getByText("Mock provider — placeholder frames"));

  await page.getByLabel("Creator nickname").fill("Northwind");
  await page.getByLabel("Who can view this video").selectOption({ label: "Only me" });
  await page.getByRole("checkbox", { name: "I agree to TikTok's Music Usage Confirmation" }).check();
  await page.getByRole("checkbox", { name: "I consent to schedule this video" }).check();
  await expect(aiLabel).toBeChecked();
  await expect(approve).toBeEnabled();
  await shot(page, pace, "07-approval-gate.png", approve);
  await approve.click();

  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
  await page.getByRole("button", { name: "Next good slot" }).click();
  await expect(page.getByRole("status")).toContainText("Scheduled");
  await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible();
  await hold(page, pace);

  await page.goto("/app/schedule");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await expect(page.getByText(/official TikTok, Instagram and Facebook APIs only/)).toBeVisible();
  const queued = page.getByRole("row").filter({ hasText: "oat-milk cold brew" });
  await expect(queued).toContainText("Scheduled");
  await shot(page, pace, "08-schedule-queue.png", page.getByText(/official TikTok, Instagram and Facebook APIs only/));

  if (!pace) return;

  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByText(/Placeholder test-mode prices/)).toBeVisible();
  await shot(page, pace, "09-billing.png", page.getByRole("heading", { name: "Billing", exact: true }));

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await shot(page, pace, "10-terms.png", page.getByRole("heading", { name: "Terms of Service" }));
  await hold(page, pace);
}

/** Chat → generate → approve, from a signed-in dashboard. Returns on the approved video page. */
export async function makeApprovedVideo(
  page: Page,
  options: { prompt?: string; privacy?: "Public" | "Friends" | "Only me" } = {},
): Promise<void> {
  await page.goto("/app/chat");
  await page.getByLabel("Message").fill(options.prompt ?? VIDEO_PROMPT);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("table", { name: "Cost preview" })).toBeVisible();
  await page.getByRole("button", { name: /Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await page.getByRole("link", { name: "Review & approve" }).click();
  await page.getByLabel("Creator nickname").fill("Northwind");
  await page.getByLabel("Who can view this video").selectOption({ label: options.privacy ?? "Public" });
  await page.getByRole("checkbox", { name: "I agree to TikTok's Music Usage Confirmation" }).check();
  await page.getByRole("checkbox", { name: "I consent to schedule this video" }).check();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
}
