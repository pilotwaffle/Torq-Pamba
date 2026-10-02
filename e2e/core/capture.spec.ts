import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";
import { runMockJourney } from "../support";

test.use({
  viewport: { width: 1280, height: 800 },
  video: { mode: "on", size: { width: 1280, height: 800 } },
});

test.describe("demo capture", () => {
  test.skip(process.env.CAPTURE !== "1", "set CAPTURE=1 to record screenshots and the demo video");

  test("walks the journey and saves screenshots plus a video", async ({ page }) => {
    await mkdir("docs/images", { recursive: true });
    await mkdir("docs/media", { recursive: true });
    await runMockJourney(page, { pace: true });

    const video = page.video();
    if (!video) throw new Error("Playwright did not record a video");
    await page.close();
    await video.saveAs("docs/media/demo.webm");
  });
});
