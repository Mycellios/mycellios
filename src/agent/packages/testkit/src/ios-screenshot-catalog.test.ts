import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadIosScreenshotCatalog } from "./ios-screenshot-catalog.js";

const catalogDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/mobile/e2e/ios-screenshots",
);

describe("iOS screenshot catalog", () => {
  it("lists named sections whose flows target the current Expo app", async () => {
    const sections = await loadIosScreenshotCatalog(catalogDir);
    expect(sections.map((section) => section.id)).toEqual([
      "auth",
      "onboarding",
      "inbox",
      "thread",
      "thread-errors",
      "search",
      "compose",
      "split-view",
      "settings",
    ]);
    const app = JSON.parse(await readFile(path.resolve(catalogDir, "../../app.json"), "utf8"));
    const flowPaths = [
      ...sections.map((section) => section.flow),
      "subflows/launch-app.yaml",
      "subflows/sign-in.yaml",
    ];
    for (const flowPath of flowPaths) {
      const flow = await readFile(path.join(catalogDir, flowPath), "utf8");
      expect(flow.split(/\r?\n/, 1)[0], flowPath).toBe("appId: " + app.expo.ios.bundleIdentifier);
    }
  });
});
