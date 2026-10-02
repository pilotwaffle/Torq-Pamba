import type { Page } from "@playwright/test";
import { expect, test } from "../support";
import { completeOnboarding, planVideo } from "../support/steps";

async function send(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  // The draft clears in the same render that marks the turn busy.
  await expect(page.getByLabel("Message")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
}

function toolCall(page: Page, name: string) {
  return page
    .getByRole("list", { name: "Tool calls" })
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

test("the agent shows tool calls and generates only after the user confirms", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await completeOnboarding(page);
  await planVideo(page, "Make a 20s video about iced oat lattes");
  await expect(toolCall(page, "plan")).toContainText("Done");
  await expect(page.getByText("Agent: Keyless mode")).toBeVisible();

  await send(page, "show my brand brief");
  await expect(toolCall(page, "brand-brief")).toContainText("Done");
  await expect(page.getByText(/Company: Northwind Cold Brew[\s\S]*Budget left this month: \$/)).toBeVisible();

  await send(page, "generate it");
  const card = page.getByRole("region", { name: /^Generate “/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Estimated cost: $");
  await expect(toolCall(page, "start-generation")).toContainText("Needs your confirmation");
  await expect(page.getByRole("heading", { name: "Video ready" })).toHaveCount(0);

  await card.getByRole("button", { name: /^Confirm and generate/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await expect(toolCall(page, "start-generation")).toContainText("Done");
  await expect(page.getByRole("region", { name: /^Generate “/ })).toHaveCount(0);

  await send(page, "list my videos");
  await expect(toolCall(page, "list-videos")).toContainText("Done");
  await page.getByRole("link", { name: "Review & approve" }).click();
  await expect(page.getByText("Mock provider — placeholder frames")).toBeVisible();
});

test("declining a confirmation runs nothing, and a new chat starts empty", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await planVideo(page, "Make a 15s video about cold brew");
  await send(page, "generate it");
  const card = page.getByRole("region", { name: /^Generate “/ });
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(toolCall(page, "start-generation")).toContainText("Declined");
  await expect(page.getByRole("heading", { name: "Video ready" })).toHaveCount(0);

  await send(page, "hello there");
  await expect(page.getByText(/^I can plan a video/).last()).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("link", { name: "New conversation" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table", { name: "Cost preview" })).toHaveCount(0);
  await page.getByRole("link", { name: "Make a 15s video about cold brew" }).click();
  await expect(toolCall(page, "start-generation")).toContainText("Declined");
});
