import { expect, generateAndReview, test, workspaceLink } from "../support";

test("research: discover, trends, accounts, ideas, and Make this video into the chat plan", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await workspaceLink(page, "Research").click();
  await expect(page.getByRole("heading", { name: "Research", level: 1 })).toBeVisible();
  await expect(workspaceLink(page, "Research")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/^Sample data: no research source is connected/)).toBeVisible();

  const sections = page.getByRole("navigation", { name: "Research sections" });

  await test.step("Discover feed with why-it-worked notes and filters", async () => {
    await sections.getByRole("link", { name: "Discover" }).click();
    await page.getByRole("button", { name: "Find viral posts" }).click();
    const feed = page.getByRole("feed", { name: "Discover feed" });
    await expect(feed.getByRole("article").first()).toBeVisible();
    expect(await feed.getByRole("article").count()).toBeGreaterThanOrEqual(6);
    await expect(feed.getByRole("region", { name: "Why it worked" }).first()).toBeVisible();
    await expect(feed.getByText(/× baseline/).first()).toBeVisible();

    await page.getByLabel("Platform").selectOption("youtube");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/platform=youtube/);
    const cards = feed.getByRole("article");
    await expect(cards.first()).toBeVisible();
    for (const card of await cards.all()) await expect(card).toContainText("YouTube");

    await page.getByLabel("Niche").selectOption("Wellness");
    await page.getByLabel("Platform").selectOption("");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByText(/Nothing here yet for Wellness/)).toBeVisible();
  });

  await test.step("Trends", async () => {
    await sections.getByRole("link", { name: "Trends" }).click();
    await page.getByRole("button", { name: "Refresh trends" }).click();
    const table = page.getByRole("table", { name: /Trends for/ });
    await expect(table.getByRole("rowheader", { name: "#coffeetok" })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: "Espresso (sped up)" })).toContainText("+64%");
  });

  await test.step("Track an inspiration account and see its recent posts", async () => {
    await sections.getByRole("link", { name: "Accounts" }).click();
    await page.getByLabel("Handle or profile URL").fill("https://www.tiktok.com/@BrewByBea");
    await page.getByLabel("Type").selectOption("competitor");
    await page.getByRole("button", { name: "Track account" }).click();
    await expect(page.getByRole("heading", { name: "@brewbybea" })).toBeVisible();
    await expect(page.getByText("TikTok · Competitor")).toBeVisible();
    const posts = page.getByRole("table", { name: "Recent posts and their performance" });
    await expect(posts.getByRole("row").nth(1)).toBeVisible();
    expect(await posts.getByRole("row").count()).toBeGreaterThan(3);

    await page.getByRole("link", { name: "Back to accounts" }).click();
    await expect(page.getByRole("list", { name: "Tracked accounts" }).getByRole("link", { name: "@brewbybea" })).toBeVisible();
  });

  await test.step("Generate ideas and hand one to the chat plan flow", async () => {
    await sections.getByRole("link", { name: "Ideas" }).click();
    await page.getByRole("button", { name: "Generate ideas" }).click();
    const ideas = page.getByRole("list", { name: "Ideas" });
    await expect(ideas.getByRole("listitem").first()).toBeVisible();
    expect(await ideas.getByRole("listitem").count()).toBe(5);

    const first = ideas.getByRole("listitem").first();
    const title = (await first.getByRole("heading").textContent())?.trim() ?? "";
    expect(title.length).toBeGreaterThan(3);
    await first.getByRole("button", { name: "Make this video" }).click();

    await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
    await expect(page.getByText(/^Make a 30s video about /).last()).toBeVisible();
    await expect(page.getByRole("table", { name: "Cost preview" })).toBeVisible();
    await generateAndReview(page);

    await page.goto("/app/research");
    const used = page.getByRole("list", { name: "Ideas" }).getByRole("listitem", { name: title });
    await expect(used).toContainText("used");
    await used.getByRole("link", { name: "View video" }).click();
    await expect(page).toHaveURL(/\/app\/videos\//);
  });

  await test.step("Chat tools find trends and ideas", async () => {
    await workspaceLink(page, "Chat").click();
    await page.getByLabel("Message").fill("what's trending?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^Trends for Coffee:/)).toBeVisible();
    await page.getByLabel("Message").fill("give me 2 video ideas");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/^2 new video ideas:/)).toBeVisible();
  });
});
