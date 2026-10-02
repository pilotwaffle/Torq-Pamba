import type { Page } from "@playwright/test";
import { expect, test, workspaceLink } from "../support";

function balanceLink(page: Page, credits: string) {
  return page.getByRole("link", { name: `Credit balance: ${credits} credits` });
}

/** Sends a video request in chat and returns the newest plan card. */
async function planInChat(page: Page, prompt: string) {
  await workspaceLink(page, "Chat").click();
  await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
  await expect(page.getByLabel("Message")).toBeEditable();
  const cards = page.getByRole("listitem").filter({ has: page.getByRole("table", { name: "Cost preview" }) });
  const before = await cards.count();
  await page.getByLabel("Message").fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(cards).toHaveCount(before + 1);
  return cards.last();
}

test("prices in credits, blocks when short, and unblocks after a top-up or plan", async ({ page, account }) => {
  expect(account.email).toMatch(/@example\.com$/);
  // Mock mode: a fresh workspace starts with simulated starter credits.
  await expect(balanceLink(page, "5,000")).toBeVisible();

  // Two premium videos are over the default $25 provider budget cap, so raise it.
  await workspaceLink(page, "Settings").click();
  await page.getByLabel("Monthly budget cap").fill("500");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const first = await planInChat(page, "Make a 60s video about our oat-milk cold brew for busy commuters");
  const firstPrice = first.getByRole("region", { name: "Credit price" });
  await expect(firstPrice).toContainText("956 credits");
  await first.getByLabel("Quality tier").selectOption("premium");
  await expect(firstPrice).toContainText("3,685 credits");
  await expect(firstPrice).toContainText("You have 5,000 credits.");
  await first.getByRole("button", { name: /^Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await expect(balanceLink(page, "1,315")).toBeVisible();

  const second = await planInChat(page, "Make a 60s video about cold brew on the morning train");
  await second.getByLabel("Quality tier").selectOption("premium");
  const secondPrice = second.getByRole("region", { name: "Credit price" });
  await expect(secondPrice.getByRole("alert")).toContainText("Not enough credits for this video.");
  await second.getByRole("button", { name: /^Generate \(est\. \$/ }).click();
  await expect(second.getByText("This costs 3,685 credits and you have 1,315 credits.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Video ready" })).toHaveCount(1);

  await secondPrice.getByRole("link", { name: "Top up credits" }).click();
  await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  await expect(page.getByTestId("credit-balance")).toHaveText("1,315 credits");
  const history = page.getByRole("table", { name: "Credit history" });
  await expect(history.getByRole("row").filter({ hasText: "Starter credits (simulated billing)" })).toContainText("+5,000");
  await expect(history.getByRole("row").filter({ hasText: "premium, 60s" })).toContainText("−3,685");

  await page.getByRole("button", { name: "Buy 5,000 credits" }).click();
  await expect(page.getByText("Simulated top-up: the credits were added. No card was charged.")).toBeVisible();
  await expect(page.getByTestId("credit-balance")).toHaveText("6,315 credits");
  await expect(history.getByRole("row").filter({ hasText: "Top-up: 5,000 credits" })).toContainText("+5,000");

  const retry = await planInChat(page, "Make a 60s video about cold brew for night-shift nurses");
  await retry.getByLabel("Quality tier").selectOption("premium");
  await expect(retry.getByRole("region", { name: "Credit price" })).toContainText("You have 6,315 credits.");
  await retry.getByRole("button", { name: /^Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toHaveCount(2);
  await expect(balanceLink(page, "2,630")).toBeVisible();

  await workspaceLink(page, "Billing").click();
  await page.getByRole("region", { name: "Hobby plan" }).getByRole("button", { name: "Subscribe to Hobby" }).click();
  await expect(page.getByText(/Simulated checkout: the plan changed/)).toBeVisible();
  await expect(page.getByTestId("credit-balance")).toHaveText("4,230 credits");
  await expect(page.getByRole("region", { name: "Hobby plan" })).toContainText("Current plan");
  await expect(history.getByRole("row").filter({ hasText: "Hobby monthly credits" })).toContainText("+1,600");

  await workspaceLink(page, "Chat").click();
  await page.getByLabel("Message").fill("How many credits do I have?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("You have 4,230 credits on the Hobby plan. A standard 30s video costs 500 credits.")).toBeVisible();
});
