import { test } from "@playwright/test";
import { runMockJourney } from "../support";

test("completes a mock video from signup through the schedule", async ({ page }) => {
  await runMockJourney(page);
});
