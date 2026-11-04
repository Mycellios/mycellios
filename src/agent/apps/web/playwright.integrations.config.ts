import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "integration-auth-proof.spec.ts",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../../playwright-integration-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4197",
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm exec -- vite build --config e2e/integration-auth.vite.config.mjs && npm exec -- vite preview --config e2e/integration-auth.vite.config.mjs",
    url: "http://127.0.0.1:4197",
    timeout: 120_000,
  },
});
