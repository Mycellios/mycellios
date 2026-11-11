import { describe, expect, it } from "vitest";
import { macosPackageKind } from "./macos-package.js";

describe("macOS package kind", () => {
  it("maps the running architecture to its disk image", () => {
    expect(macosPackageKind("arm64")).toBe("macos-arm64");
    expect(macosPackageKind("x64")).toBe("macos-x64");
  });

  it("offers nothing to an architecture without a published image", () => {
    expect(macosPackageKind("ia32")).toBeNull();
    expect(macosPackageKind("")).toBeNull();
  });
});
