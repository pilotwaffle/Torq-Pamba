import { expect, type Page } from "@playwright/test";
import { workspaceLink } from "./nav";
import { hold, shot, type Pace } from "./pace";

export const DEMO_URL = `http://localhost:${process.env.PORT ?? 3100}/demo-site`;
export const VIDEO_PROMPT = "Make a 30s video about our oat-milk cold brew for busy commuters";

/**
 * Reusable journey steps. Each starts from a signed-in page and ends on a known
 * screen, so a feature spec can run the steps it needs as setup.
 */

/** Dashboard → onboarding (demo site) → confirmed brief → media rights → first avatar. */
export async function completeOnboarding(page: Page, options: Pace = {}): Promise<void> {
  await workspaceLink(page, "Onboarding").click();
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();
  await page.getByLabel("Website URL").fill(DEMO_URL);
  await hold(page, options);
  await page.getByRole("button", { name: "Analyze website" }).click();

  await expect(page.getByLabel("Company name")).toHaveValue("Northwind Cold Brew");
  await expect(page.getByRole("columnheader", { name: "Source text" })).toBeVisible();
  await expect(page.getByText("Northwind Cold Brew").first()).toBeVisible();
  await expect(page.getByText("Made for busy commuters and remote workers").first()).toBeVisible();
  await shot(page, options, "02-onboarding-extract.png", page.getByRole("table", { name: "Review the extraction" }));

  await page.getByRole("button", { name: "Save brand brief" }).click();
  await expect(page.getByRole("heading", { name: "Brand", exact: true })).toBeVisible();
  await expect(page.getByLabel("Company name")).toHaveValue("Northwind Cold Brew");
  await expect(page.getByLabel("Niche")).not.toHaveValue("");
  await shot(page, options, "03-brand-brief.png", page.getByRole("heading", { name: "Brand", exact: true }));

  await page.getByRole("button", { name: "Confirm brief" }).click();
  await expect(page.getByRole("heading", { name: "Media", exact: true })).toBeVisible();
  const rights = page.getByRole("checkbox", { name: "I have the rights to use this" });
  await expect(rights.first()).toBeVisible();
  await rights.first().check();
  await hold(page, options);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Avatar", exact: true })).toBeVisible();
  const matched = page.getByRole("region", { name: "Matched to your niche" });
  await expect(matched.getByRole("button", { name: "Use this avatar" }).first()).toBeVisible();
  await shot(page, options, "04-avatars.png", matched);
  await matched.getByRole("button", { name: "Use this avatar" }).first().click();
  await expect(page.getByRole("heading", { name: "Your avatars" })).toBeVisible();
  await hold(page, options);
}

/** Chat → send a prompt → cost preview visible. */
export async function planVideo(page: Page, prompt = VIDEO_PROMPT, options: Pace = {}): Promise<void> {
  await workspaceLink(page, "Chat").click();
  await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
  await page.getByLabel("Message").fill(prompt);
  await hold(page, options);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("table", { name: "Cost preview" })).toBeVisible();
}

/** Checks the cost preview totals per tier and leaves the tier on standard. */
export async function checkTierPrices(page: Page, options: Pace = {}): Promise<void> {
  const total = page.getByRole("row", { name: "Total" });
  await expect(total).toContainText("$3.32");
  await page.getByLabel("Quality tier").selectOption("budget");
  await expect(total).toContainText("$1.59");
  await hold(page, options);
  await page.getByLabel("Quality tier").selectOption("standard");
  await expect(total).toContainText("$3.32");
  await expect(page.getByRole("button", { name: "Generate (est. $3.32)" })).toBeVisible();
  await shot(page, options, "05-chat-cost-preview.png", page.getByRole("table", { name: "Cost preview" }));
}

/** Generate from the latest plan → video ready → review page. */
export async function generateAndReview(page: Page, options: Pace = {}): Promise<void> {
  await page.getByRole("button", { name: /^Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await hold(page, options);
  await page.getByRole("link", { name: "Review & approve" }).click();
  await expect(page.getByText("Mock provider — placeholder frames")).toBeVisible();
}

/** On the review page: fill the approval gate (AI label stays on), approve, queue the next good slot. */
export async function approveAndSchedule(page: Page, options: Pace = {}): Promise<void> {
  const aiLabel = page.getByRole("checkbox", { name: "AI-generated content label" });
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(aiLabel).toBeChecked();
  await expect(approve).toBeDisabled();
  await shot(page, options, "06-video-preview.png", page.getByText("Mock provider — placeholder frames"));

  await page.getByLabel("Creator nickname").fill("Northwind");
  await page.getByLabel("Who can view this video").selectOption({ label: "Only me" });
  await page.getByRole("checkbox", { name: "I agree to TikTok's Music Usage Confirmation" }).check();
  await page.getByRole("checkbox", { name: "I consent to schedule this video" }).check();
  await expect(aiLabel).toBeChecked();
  await expect(approve).toBeEnabled();
  await shot(page, options, "07-approval-gate.png", approve);
  await approve.click();

  await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
  await page.getByRole("button", { name: "Next good slot" }).click();
  await expect(page.getByRole("status")).toContainText("Scheduled");
  await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible();
  await hold(page, options);
}

/** The schedule queue lists a scheduled row containing `text`. */
export async function expectQueued(page: Page, text: string, options: Pace = {}): Promise<void> {
  await page.goto("/app/schedule");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  await expect(page.getByText(/official TikTok, Instagram and Facebook APIs only/)).toBeVisible();
  const queued = page.getByRole("row").filter({ hasText: text });
  await expect(queued).toContainText("Scheduled");
  await shot(page, options, "08-schedule-queue.png", page.getByText(/official TikTok, Instagram and Facebook APIs only/));
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
