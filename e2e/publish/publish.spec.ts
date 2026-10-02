import { expect, test } from "@playwright/test";
import { makeApprovedVideo, signUpFresh } from "../support";

test("posts an approved video to mock TikTok and Instagram, then shows analytics", async ({ page }) => {
  await signUpFresh(page, "publish");

  await page.goto("/app/accounts");
  await expect(page.getByText(/TikTok audit pending/)).toBeVisible();
  await page.getByRole("button", { name: "Connect TikTok (mock)" }).click();
  await expect(page.getByRole("status")).toContainText("Account connected");
  await page.getByRole("button", { name: "Connect Instagram (mock)" }).click();
  const table = page.getByRole("table", { name: "Connected accounts" });
  await expect(table.getByRole("row")).toHaveCount(3);

  await makeApprovedVideo(page, { privacy: "Public" });
  await page.getByRole("checkbox", { name: "Post to TikTok @mock-tiktok" }).check();
  await page.getByRole("checkbox", { name: "Post to Instagram @mock-instagram" }).check();
  await page.getByLabel("Instagram @mock-instagram format").selectOption({ label: "Trial Reel (non-followers first)" });
  await page.getByRole("button", { name: "Post now" }).click();

  const status = page.getByRole("table", { name: "Publish status" });
  await expect(status.getByRole("row").filter({ hasText: "TikTok @mock-tiktok" })).toContainText("Posted (private — Only me)");
  await expect(status.getByRole("row").filter({ hasText: "Instagram @mock-instagram" })).toContainText("Posted as Trial Reel");

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Analytics", exact: true }).click();
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(page.getByRole("status")).toContainText("Stored 2 new snapshot(s)");
  await expect(page.getByRole("table", { name: "Post analytics" }).getByRole("row")).toHaveCount(3);
});

// The v2 foundation's fail-closed status is 401 (src/lib/local-mode.ts); phase 2 used 503.
test("cron, Stripe webhook and media endpoints fail closed", async ({ request }) => {
  const cron = await request.post("/api/cron/tick");
  expect(cron.status()).toBe(401);
  const forged = await request.post("/api/cron/tick", { headers: { authorization: "Bearer guess" } });
  expect(forged.status()).toBe(401);
  const webhook = await request.post("/api/billing/webhook", {
    data: { object: "event", type: "checkout.session.completed", data: { object: { metadata: { plan: "studio" } } } },
  });
  expect(webhook.status()).toBe(401);
  // Wave 1's media route (src/app/api/media/[id]) serves only to a signed-in member of the workspace.
  const media = await request.get("/api/media/not-a-key.mp4");
  expect(media.status()).toBe(401);
  const guessed = await request.get("/api/media/00000000-0000-4000-8000-000000000000");
  expect(guessed.status()).toBe(401);
});
