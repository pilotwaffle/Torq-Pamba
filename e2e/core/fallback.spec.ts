import { expect, planVideo, test } from "../support";

test("shows a fallback when the prompt contains [refuse]", async ({ page, account }) => {
  expect(account.email).toMatch(/@example\.com$/);
  await planVideo(page, "Make a 30s video about [refuse] oat-milk cold brew");
  await page.getByRole("button", { name: /Generate \(est\. \$/ }).click();
  await expect(page.getByRole("heading", { name: "Video ready" })).toBeVisible();
  await expect(page.getByText("omni-flash refused → veo-3.1-lite ok")).toBeVisible();
});
