import { defineConfig } from "@playwright/test";
import shared from "./playwright.usage.config";
export default defineConfig({
  ...shared,
  testMatch: "settings-workspace.spec.ts",
  outputDir: "test-results/settings",
  timeout: 240_000,
  webServer: shared.webServer.map((server) => ({ ...server, stderr: "pipe" as const })),
});
