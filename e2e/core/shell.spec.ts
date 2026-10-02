import { expect, test, workspaceNav } from "../support";

test("every workspace nav entry opens its page and marks itself current", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  const links = workspaceNav(page).getByRole("link");
  const entries = await links.evaluateAll((nodes) =>
    nodes.map((node) => ({ href: node.getAttribute("href") ?? "", label: node.textContent?.trim() ?? "" })),
  );
  expect(entries.length).toBeGreaterThanOrEqual(9);
  expect(entries.map((entry) => entry.label)).toContain("Dashboard");

  for (const entry of entries) {
    await test.step(entry.label, async () => {
      const response = await page.goto(entry.href);
      expect(response?.status(), entry.href).toBeLessThan(400);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(workspaceNav(page).getByRole("link", { name: entry.label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }
});
