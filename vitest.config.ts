import { defineConfig } from "vitest/config";
import { agentChangelogRecent } from "./scripts/agent-changelog-recent.mjs";

export default defineConfig({
  plugins: [agentChangelogRecent(import.meta.dirname)],
  test: {
    include: ["tests/**/*.test.ts", "landing/**/*.test.ts", "landing/**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
