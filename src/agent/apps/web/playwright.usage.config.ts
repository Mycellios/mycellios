import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig({ testDir: "./e2e", testMatch: ["usage-dashboard.spec.ts", "marketplace.spec.ts"], workers: 1, timeout: 180_000, expect: { timeout: 30_000 }, reporter: "list", use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: "http://127.0.0.1:5192", viewport: { width: 1264, height: 866 }, timezoneId: "Europe/Madrid", actionTimeout: 15_000, reducedMotion: "reduce", screenshot: "only-on-failure" },
  webServer: [
    { command: "node scripts/project-local.mjs backend", cwd: projectRoot, url: "http://127.0.0.1:3101/ready", reuseExistingServer: true, timeout: 180_000, stdout: "ignore", stderr: "ignore" },
    { command: "node scripts/project-local.mjs web", cwd: projectRoot, url: "http://127.0.0.1:5192", reuseExistingServer: true, timeout: 120_000, stdout: "ignore", stderr: "ignore" },
  ],
});
