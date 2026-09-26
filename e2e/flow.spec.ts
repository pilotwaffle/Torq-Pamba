import { expect, test } from "@playwright/test";
import { runMockJourney, signUp, uniqueEmail } from "./journey";

test("completes a mock video from signup through the schedule", async ({ page }) => {
  await runMockJourney(page);
});

test("shows a fallback when the prompt contains [refuse]", async ({ page }) => {
  await page.goto("/signup");
  await signUp(page, uniqueEmail("refuse"));
  await page.goto("/app/chat");
  await page.getByLabel("Message").fill("Make a 30s video about [refuse] oat-milk cold brew");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("table", { name: "Cost preview" })).toBeVisible();
  await page.getByRole("button", { name: /Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await expect(page.getByText("omni-flash refused → veo-3.1-lite ok")).toBeVisible();
});
