import { approveAndSchedule, expect, generateAndReview, planVideo, test, workspaceLink } from "../support";

test("fixes a video scene by scene, then locks the editor after approval", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await planVideo(page);
  await generateAndReview(page);
  const reviewUrl = page.url();

  await page.getByRole("link", { name: "Edit scenes, captions and hook" }).click();
  await expect(page.getByRole("heading", { name: "Editor", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Scene \d$/ })).toHaveCount(3);
  const scene2Takes = page.getByRole("list", { name: "Scene 2 takes" });
  await expect(scene2Takes.getByRole("listitem")).toHaveCount(1);

  // Regenerate one scene: a second take appears and is selected; scene 1 keeps its single take.
  await page.getByLabel("Direction for scene 2").fill("closer on the can");
  await page.getByRole("button", { name: "Regenerate scene 2" }).click();
  await expect(page.getByRole("status")).toHaveText("Scene 2 take 2 is ready and selected.");
  await expect(scene2Takes.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("listitem", { name: "Scene 2 take 2" })).toContainText("Selected");
  await expect(page.getByRole("list", { name: "Scene 1 takes" }).getByRole("listitem")).toHaveCount(1);

  // Pick the earlier take; the choice survives a reload.
  await page.getByRole("button", { name: "Use scene 2 take 1" }).click();
  await expect(page.getByRole("status")).toHaveText("Take selected.");
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Scene 2 take 1" })).toContainText("Selected");
  await expect(page.getByRole("button", { name: "Use scene 2 take 2" })).toBeVisible();

  // Edit a caption.
  await page.getByLabel("Caption 1").fill("Cold brew that keeps up with your commute.");
  await page.getByRole("button", { name: "Save captions" }).click();
  await expect(page.getByRole("status")).toHaveText("Captions saved.");
  await expect(page.getByLabel("Caption 1")).toHaveValue("Cold brew that keeps up with your commute.");

  // Add a hook and use it.
  await page.getByRole("textbox", { name: "New hook" }).fill("Your 7am just got easier");
  await page.getByRole("radio", { name: "Use the new hook" }).check();
  await page.getByRole("button", { name: "Save hooks" }).click();
  await expect(page.getByRole("status")).toHaveText("Hooks saved.");
  await expect(page.getByRole("radio", { name: "Use hook 4" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Hook 4", exact: true })).toHaveValue("Your 7am just got easier");

  // The review page shows the edits, and the approval gate still works the same way.
  await page.getByRole("link", { name: "Back to review" }).click();
  await expect(page).toHaveURL(reviewUrl);
  await expect(page.getByText("Your 7am just got easier")).toBeVisible();
  await approveAndSchedule(page);

  await page.getByRole("link", { name: "View scenes and takes" }).click();
  await expect(page.getByText(/Editing is closed for this video/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Regenerate scene/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save captions" })).toHaveCount(0);
  await expect(page.getByLabel("Caption 1")).toBeDisabled();
});

test("regenerates a scene from chat", async ({ page, account }) => {
  expect(account.email).toBeTruthy();
  await planVideo(page);
  await generateAndReview(page);
  await workspaceLink(page, "Chat").click();
  await page.getByLabel("Message").fill("regenerate scene 1");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Scene 1 has a new take \(take 2, \$\d+\.\d{2}\)/)).toBeVisible();

  await page.goto("/app/videos");
  await page.getByRole("link", { name: /cold brew/i }).first().click();
  await page.getByRole("link", { name: "Edit scenes, captions and hook" }).click();
  await expect(page.getByRole("listitem", { name: "Scene 1 take 2" })).toContainText("Selected");
});
