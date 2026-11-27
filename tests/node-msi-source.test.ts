import { describe, expect, it } from "vitest";
import { generateWixSource } from "../scripts/build-node-msi.mjs";

describe("native Windows MSI source", () => {
  it("binds every staged file, a per-machine identity and pairing association", () => {
    const source = generateWixSource({ stagedRoot: "C:\\staged", version: "0.2.77", sourceRevision: "a".repeat(40), files: [
      { path: "bin/node.exe", bytes: 1, sha256: "b".repeat(64) }, { path: "app/node/install-main.js", bytes: 1, sha256: "c".repeat(64) },
      { path: "install.ps1", bytes: 1, sha256: "d".repeat(64) },
    ] });
    expect(source).toContain('InstallScope="perMachine"'); expect(source).toContain(".mycellios-enrollment");
    expect(source).toContain("[INSTALLFOLDER]install.ps1"); expect(source).toContain("%1"); expect(source).toContain("MYCELLIOSSOURCEREVISION");
    expect(source.match(/<File /g)).toHaveLength(4); expect(source).toContain("layout-manifest.json"); expect(source).not.toContain("enrollmentToken");
  });

  it("includes the product manifest exactly once when the inventory already contains it", () => {
    const source = generateWixSource({ stagedRoot: "C:\\staged", version: "0.2.77", sourceRevision: "a".repeat(40), files: [
      { path: "layout-manifest.json", bytes: 1, sha256: "d".repeat(64) },
    ] });
    expect(source.match(/<File /g)).toHaveLength(1);
    expect(source).toContain("layout-manifest.json");
  });

  it("replaces an installed product of the same version from another revision", () => {
    const build = (sourceRevision: string) => generateWixSource({ stagedRoot: "C:\\staged", version: "0.2.124", sourceRevision, files: [{ path: "install.ps1", bytes: 1, sha256: "d".repeat(64) }] });
    const older = build("a".repeat(40)), newer = build("b".repeat(40));
    // package.json is not bumped per revision, so a same-version MajorUpgrade is the only upgrade path.
    expect(newer).toContain('<MajorUpgrade AllowSameVersionUpgrades="yes"');
    const upgradeCode = (source: string) => /UpgradeCode="([^"]+)"/.exec(source)?.[1];
    const productId = (source: string) => /<Product Id="([^"]+)"/.exec(source)?.[1];
    expect(upgradeCode(newer)).toBe(upgradeCode(older));
    expect(productId(newer)).not.toBe(productId(older));
  });

  it("is deterministic for identical source identity", () => {
    const input = { stagedRoot: "C:\\staged", version: "0.2.77", sourceRevision: "a".repeat(40), files: [{ path: "install.ps1", bytes: 1, sha256: "d".repeat(64) }] };
    expect(generateWixSource(input)).toBe(generateWixSource(input));
  });
});
