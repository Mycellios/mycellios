import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));

const configs = [
  "vite.config.ts",
  "e2e/integration-auth.vite.config.mjs",
  "e2e/contribution.vite.config.mjs",
  ".desktop-development.config.mjs",
  ".managed-development.config.mjs",
  ".project-binding.config.mjs",
  ".project-browser.config.mjs",
];

describe("Lingui macro", () => {
  it("keeps the source message in production so a missing catalog entry cannot render its id", () => {
    for (const config of configs) {
      const source = readFileSync(join(webRoot, config), "utf8");
      expect(source, config).toContain("@lingui/babel-plugin-lingui-macro");
      expect(source, config).toContain('descriptorFields: "message"');
      expect(source, config).not.toMatch(
        /plugins:\s*\[\s*"@lingui\/babel-plugin-lingui-macro"\s*\]/,
      );
    }
    const lingui = readFileSync(join(webRoot, "lingui.config.ts"), "utf8");
    expect(lingui).toContain('fallbackLocales: { default: "en" }');
  });
});
