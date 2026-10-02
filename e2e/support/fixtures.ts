import { test as base } from "@playwright/test";
import { signUpFresh } from "./auth";

export { expect } from "@playwright/test";

/**
 * `test` with an `account` fixture: the page is signed in to a brand-new
 * workspace before the test body runs. Feature specs should start here so
 * they never depend on another spec's data.
 */
export const test = base.extend<{ account: { email: string } }>({
  account: async ({ page }, provide, testInfo) => {
    const email = await signUpFresh(page, testInfo.title);
    await provide({ email });
  },
});
