import { describe, expect, it } from "vitest";
import { linuxPackageKind } from "./linux-package.js";

const executable = "/opt/Mycellios Desktop/mycellios-desktop";

describe("Linux package ownership", () => {
  it("recognizes the Fedora RPM that owns the running executable", () => {
    const calls: Array<[string, string[]]> = [];
    const kind = linuxPackageKind(executable, (command, args) => {
      calls.push([command, args]);
      return command === "rpm" ? "mycellios-desktop" : null;
    });
    expect(kind).toBe("fedora-x64");
    // The path is an argument, never part of a shell command line.
    expect(calls).toEqual([["rpm", ["-qf", "--qf", "%{NAME}", executable]]]);
  });
  it("recognizes the Debian package that owns the running executable", () => {
    const kind = linuxPackageKind(executable, (command, args) =>
      command === "dpkg-query" && args.at(-1) === executable
        ? "mycellios-desktop: /opt/Mycellios Desktop"
        : null,
    );
    expect(kind).toBe("linux-x64");
  });
  it("offers nothing to an AppImage, an unpackaged build or another package", () => {
    expect(linuxPackageKind(executable, () => null)).toBeNull();
    expect(
      linuxPackageKind(executable, (command) =>
        command === "rpm" ? "other-product" : "other: /opt/other",
      ),
    ).toBeNull();
  });
});
