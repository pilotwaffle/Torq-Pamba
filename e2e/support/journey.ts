import { expect, type Page } from "@playwright/test";
import { signUp, uniqueEmail } from "./auth";
import { hold, shot, type Pace } from "./pace";
import { approveAndSchedule, checkTierPrices, completeOnboarding, expectQueued, generateAndReview, planVideo } from "./steps";

/** Full mock journey from the public landing page through the schedule queue. Used by the core spec and the capture. */
export async function runMockJourney(page: Page, options: Pace & { email?: string } = {}): Promise<void> {
  const email = options.email ?? uniqueEmail("journey");

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Terms", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  await shot(page, options, "01-landing.png");

  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await hold(page, options);
  await signUp(page, email);
  await hold(page, options);

  await completeOnboarding(page, options);
  await planVideo(page, undefined, options);
  await checkTierPrices(page, options);
  await generateAndReview(page, options);
  await approveAndSchedule(page, options);
  await expectQueued(page, "oat-milk cold brew", options);

  if (!options.pace) return;

  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByText(/Placeholder test-mode prices/)).toBeVisible();
  await shot(page, options, "09-billing.png", page.getByRole("heading", { name: "Billing", exact: true }));

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await shot(page, options, "10-terms.png", page.getByRole("heading", { name: "Terms of Service" }));
  await hold(page, options);
}
