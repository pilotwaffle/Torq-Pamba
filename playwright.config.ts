import { defineConfig } from "@playwright/test";

const ci = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: ci,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: {
      PGLITE_DIR: "./.data/e2e-pglite",
      PROVIDER_MODE: "mock",
      ALLOW_LOCAL_ONBOARDING: "1",
    },
  },
});
