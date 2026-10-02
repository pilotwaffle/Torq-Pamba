import { synthWav } from "../../src/lib/voices/wav";
import { expect, test, workspaceLink } from "../support";

test("voices: preview the catalog, pick a voice, make a talking clip, clone with consent, choose by chat", async ({
  page,
  account,
}) => {
  expect(account.email).toBeTruthy();
  const yours = page.getByRole("region", { name: "Your avatars" });
  await workspaceLink(page, "Avatars").click();
  await expect(page.getByRole("heading", { name: "Avatars", exact: true })).toBeVisible();

  await test.step("the catalog plays real mock audio with no keys", async () => {
    const catalog = page.getByRole("region", { name: "Voice catalog" });
    await expect(catalog.getByRole("listitem")).toHaveCount(8);
    await expect(catalog).toContainText("Mock voices");
    const src = await catalog.getByLabel("Preview Warm alto").getAttribute("src");
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("audio/wav");
    expect((await response.body()).subarray(0, 4).toString()).toBe("RIFF");
  });

  await test.step("choose a voice for an avatar", async () => {
    const stock = page.getByRole("region", { name: "Stock avatars" });
    await stock.getByRole("listitem").filter({ hasText: "Mina Cole" }).getByRole("button", { name: "Use this avatar" }).click();
    await expect(page.getByRole("heading", { name: "Your avatars" })).toBeVisible();
    await expect(yours.getByText("Voice: Warm alto")).toBeVisible();
    await page.getByLabel("Voice for Mina Cole").selectOption({ label: "Bright soprano" });
    await expect(page.getByLabel("Preview Bright soprano").first()).toBeAttached();
    await page.getByRole("button", { name: "Save voice" }).click();
    await expect(yours.getByText("Voice: Bright soprano")).toBeVisible();
  });

  await test.step("preview a lip-synced talking clip", async () => {
    await page.getByRole("button", { name: /^Preview talking clip \(est\. \$/ }).click();
    const clip = page.getByTestId("talking-clip");
    await expect(clip).toBeVisible();
    await expect(clip.locator("svg[data-mock-lipsync='true']")).toBeAttached();
    await expect(page.getByLabel("Mina Cole talking clip audio")).toHaveAttribute("src", /^data:audio\/wav;base64,/);
    await expect(page.getByText(/Mock lip-sync — placeholder mouth animation · Bright soprano/)).toBeVisible();
  });

  await test.step("clone a voice only after confirming consent", async () => {
    const form = page.getByRole("form", { name: "Clone a voice" });
    await form.getByLabel("Voice name").fill("Dana's voice");
    await form.getByLabel("Speaker’s name").fill("Dana Reyes");
    await form.getByLabel("Upload samples").setInputFiles({
      name: "dana.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from(synthWav("This is my own voice, reading a few sentences for the clone.").bytes),
    });
    const submit = form.getByRole("button", { name: "Clone voice" });
    await expect(submit).toBeDisabled();
    const consent = form.getByRole("checkbox", { name: /the voice in these samples is my own \(Dana Reyes\)/ });
    await expect(consent).not.toBeChecked();
    await consent.check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("status").filter({ hasText: "“Dana's voice” is ready" })).toBeVisible();
    const row = page.getByRole("table", { name: "Your voice clones" }).getByRole("row", { name: /Dana's voice/ });
    await expect(row).toContainText("Ready");
    await expect(page.getByLabel("Voice for Mina Cole").locator("option", { hasText: "Dana's voice" })).toBeAttached();
  });

  await test.step("choose a voice from chat", async () => {
    await workspaceLink(page, "Chat").click();
    await page.getByLabel("Message").fill("use the warm tenor voice");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Mina Cole now speaks with Warm tenor.", { exact: false }).last()).toBeVisible();
    await workspaceLink(page, "Avatars").click();
    await expect(yours.getByText("Voice: Warm tenor")).toBeVisible();
  });
});
