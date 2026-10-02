import type { Locator, Page } from "@playwright/test";

/** `pace` slows a run down for the demo capture; tests leave it off. */
export type Pace = { pace?: boolean };

export async function hold(page: Page, { pace }: Pace): Promise<void> {
  if (pace) await page.waitForTimeout(750);
}

/** Saves `docs/images/<name>` when pacing for the capture; a no-op in tests. */
export async function shot(page: Page, { pace }: Pace, name: string, focus?: Locator): Promise<void> {
  if (!pace) return;
  if (focus) await focus.scrollIntoViewIfNeeded();
  await page.waitForTimeout(750);
  await page.screenshot({ path: `docs/images/${name}`, fullPage: true });
}
