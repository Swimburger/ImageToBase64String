import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4273",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm run preview",
    url: "http://127.0.0.1:4273",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

