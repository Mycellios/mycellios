import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Publication belongs to the canonical repository; Desktop preview upgrades are manual.
const repository = path.resolve(import.meta.dirname, "../../../../..");
const agent = path.join(repository, "src/agent");
const read = (name: string) => readFileSync(path.join(repository, name), "utf8");
const quality = read(".github/workflows/agent-quality.yml");
const desktop = JSON.parse(readFileSync(path.join(agent, "apps/desktop/package.json"), "utf8"));
const windows = read("src/agent/apps/desktop/scripts/windows-installer.mjs");

describe("canonical Desktop preview release boundaries", () => {
  it("checks both owned dependency graphs with read-only CI credentials", () => {
    expect(quality).toContain("permissions:\n  contents: read");
    expect(quality).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(quality).toContain("npm ci --prefix src/agent");
    expect(quality).not.toContain("secrets.");
    expect(quality).not.toMatch(/--publish|gh release|npm publish/);
  });

  it("pins every third-party quality action to an immutable commit", () => {
    const actions = [...quality.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("gates ordinary and unified packaging on current source receipts", () => {
    expect(desktop.build.beforePack).toBe("./scripts/verify-release.cjs");
    expect(windows).toContain("scripts/verify-release.cjs");
    const continuity = read("src/agent/apps/desktop/scripts/release-continuity.mjs");
    expect(continuity).toContain("['desktop', 'web', 'local-server']");
    expect(continuity).toContain("Stale ${surface} build");
    expect(continuity).toContain("Modified ${surface} bundle");
  });

  it("keeps per-user upgrades and requires signature verification for an update", () => {
    expect(desktop.build.appId).toBe("com.mycellios.agent.desktop");
    expect(windows).toContain("perMachine: false");
    expect(windows).toContain("deleteAppDataOnUninstall: false");
    expect(windows).toContain("verifyUpdateCodeSignature: true");
    expect(windows).toContain("publish: []");
    expect(read("src/agent/apps/desktop/scripts/package-windows.mjs")).toContain("publish: 'never'");
  });

  it("retains the separately pinned Apple Silicon publication inputs", () => {
    const workflow = read(".github/workflows/desktop-macos.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).toContain("desktop-v0.3.9-macos-preview");
    expect(workflow).toContain("shasum -a 256 -c");
    expect(workflow).toContain("permissions:\n  contents: read");
  });
});
