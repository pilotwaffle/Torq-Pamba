import { expect, test } from "@playwright/test";
import { makeApprovedVideo, signUp, uniqueEmail, VIDEO_PROMPT } from "./journey";

test("runs a hook test on Trial Reels, saves the winner to Knowledge, and the next plan leads with it", async ({ page }) => {
  await page.goto("/signup");
  await signUp(page, uniqueEmail("reach"));
  await page.goto("/app/accounts");
  await page.getByRole("button", { name: "Connect Instagram (mock)" }).click();
  await expect(page.getByRole("status")).toContainText("Account connected");
  await makeApprovedVideo(page, { privacy: "Public" });

  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Reach", exact: true }).click();
  await page.getByLabel("Number of variants").selectOption("3");
  await page.getByRole("button", { name: "Create hook test" }).click();
  const variants = page.getByRole("table", { name: "Hook variants" });
  await expect(variants.getByRole("row")).toHaveCount(4);
  await expect(variants.getByRole("row").nth(1)).toContainText("Original hook");

  await page.getByRole("button", { name: "Launch as Trial Reels" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Approve variant B before launch" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Use the original video's approval/ }).check();
  await page.getByRole("button", { name: "Approve all variants" }).click();
  await expect(page.getByRole("status")).toContainText("Variants approved.");
  await page.getByLabel("Instagram account").selectOption({ label: "@mock-instagram" });
  await page.getByRole("button", { name: "Launch as Trial Reels" }).click();
  await expect(page.getByRole("status")).toContainText("Launched.");
  await expect(variants.getByRole("row").filter({ hasText: "Posted as Trial Reel" })).toHaveCount(3);

  await page.getByRole("button", { name: "Pick winner" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Not enough data yet" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh metrics" }).click();
  await expect(page.getByRole("status")).toContainText("Stored 3 new snapshot(s).");
  await page.getByRole("button", { name: "Pick winner" }).click();
  await expect(page.getByRole("heading", { name: /^Variant [ABC] won/ })).toBeVisible();
  const winnerRow = variants.getByRole("row").filter({ hasText: "Winner" });
  await expect(winnerRow).toHaveCount(1);
  const winnerHook = (await winnerRow.getByRole("link").textContent())?.trim() ?? "";
  expect(winnerHook.length).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Knowledge" }).last().click();
  await expect(page.getByRole("article", { name: `Hook: ${winnerHook}` })).toContainText("Hook-test winner");

  await page.goto("/app/chat");
  await page.getByLabel("Message").fill(VIDEO_PROMPT);
  await page.getByRole("button", { name: "Send" }).click();
  const hookChoices = page.getByRole("group", { name: "Text hook" }).last();
  await expect(hookChoices.getByRole("radio").first()).toBeChecked();
  await expect(hookChoices.locator("label").first()).toContainText(winnerHook);
});

test("writes a creator brief, exports it, and tracks a Spark Ads hand-off", async ({ page, playwright, baseURL }) => {
  await page.goto("/signup");
  await signUp(page, uniqueEmail("creators"));
  await makeApprovedVideo(page, { privacy: "Public" });

  await page.goto("/app/creators");
  await page.getByLabel("Brief title").fill("Fall cold brew UGC");
  await page.getByLabel("Budget (USD)").fill("750");
  await page.getByRole("checkbox", { name: "Collabstr" }).check();
  await page.getByRole("button", { name: "Save brief" }).click();
  await expect(page.getByRole("status")).toContainText("Brief saved.");
  const row = page.getByRole("table", { name: "Creator briefs" }).getByRole("row").filter({ hasText: "Fall cold brew UGC" });
  await expect(row).toContainText("$750.00");
  await expect(row).toContainText("TikTok One, Collabstr");

  const csvHref = (await row.getByRole("link", { name: "CSV" }).getAttribute("href")) ?? "";
  const csv = await page.request.get(csvHref);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).trimEnd().split("\r\n");
  expect(lines[0]).toMatch(/^brief_title,platform,format,video_count/);
  expect(lines).toHaveLength(3);
  const md = await page.request.get(csvHref.replace("format=csv", "format=md"));
  expect(await md.text()).toContain("# Fall cold brew UGC");
  const anonymous = await playwright.request.newContext({ baseURL });
  expect((await anonymous.get(csvHref)).status()).toBe(401);
  await anonymous.dispose();

  await page.goto("/app/reach");
  await page.getByLabel("Ad type").selectOption({ label: "TikTok Spark Ads" });
  await page.getByLabel("Creator handle").fill("@northwind.nurse");
  await page.getByRole("button", { name: "Start hand-off" }).click();
  await expect(page.getByRole("status")).toContainText("Hand-off started.");
  const handoffs = page.getByRole("table", { name: "Ad hand-offs" });
  await expect(handoffs).toContainText("Waiting on the creator");
  await page.getByLabel("Spark Ads code for @northwind.nurse").fill("bad code");
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "spaces" })).toBeVisible();
  await page.getByLabel("Spark Ads code for @northwind.nurse").fill("#SparkE2E123456");
  await page.getByRole("button", { name: "Save code" }).click();
  await expect(page.getByRole("status")).toContainText("Spark Ads code saved (encrypted).");
  await expect(handoffs).toContainText("Ready to boost in Ads Manager");
  await expect(handoffs).toContainText("Code …3456");
  await expect(page.getByText("#SparkE2E123456")).toHaveCount(0);
});
