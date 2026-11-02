import { mkdtemp, mkdir, writeFile, rm, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { runInNewContext } from "node:vm";
import { createPackageWithOptions, extractFile, statFile } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Standalone packaging adapter has no application declarations.
import { adaptDesktopLinux, patchDesktopMain } from "../scripts/adapt-desktop-linux.mjs";

const original = `function windowChrome(platform) {
  const mac5 = platform === "darwin";
  return {
    frame: mac5,
    titleBarStyle: mac5 ? "hiddenInset" : void 0
  };
}
function developmentIcon() {
  if (app2.isPackaged) return void 0;
  const icon = path12.join(app2.getAppPath(), "assets", "icon.png");
  return existsSync(icon) ? icon : void 0;
}
`;
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });

describe("Fedora Desktop window integration", () => {
  it("restores Linux controls while retaining Windows and macOS behavior", () => {
    const source = patchDesktopMain(original);
    for (const platform of ["linux", "win32", "darwin"]) {
      const result = runInNewContext(source + "; windowChrome(process.platform)", { process: { platform } });
      expect(result.frame).toBe(platform !== "win32");
      expect(result.titleBarStyle).toBe(platform === "darwin" ? "hiddenInset" : undefined);
    }
  });

  it("provides the installed Linux window icon without changing other platforms", () => {
    const source = patchDesktopMain(original);
    for (const platform of ["linux", "win32", "darwin"]) {
      const result = runInNewContext(source + "; developmentIcon()", {
        process: { platform, resourcesPath: "/resources" }, path12: posix, app2: { isPackaged: true },
      });
      expect(result).toBe(platform === "linux" ? "/resources/web/mycellios/app-icon-v2-512.png" : undefined);
    }
  });

  it("refuses unknown or ambiguous upstream bundles", () => {
    expect(() => patchDesktopMain(original.replace("frame: mac5,", "frame: true,"))).toThrow("unexpected_main_bundle");
    expect(() => patchDesktopMain(original + original)).toThrow("unexpected_main_bundle");
  });

  it("retains every other file and the native module's unpack and executable flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "mycellios-linux-chrome-")); temporary.push(root);
    const source = join(root, "source");
    await mkdir(join(source, "dist"), { recursive: true });
    await mkdir(join(source, "native"));
    await writeFile(join(source, "dist/main.js"), original);
    await writeFile(join(source, "LICENSE"), "unchanged license");
    await writeFile(join(source, "native/helper.node"), "unchanged native bytes");
    await chmod(join(source, "native/helper.node"), 0o755);
    const archive = join(root, "original.asar");
    await createPackageWithOptions(source, archive, { unpack: "**/*.node" });
    const output = join(root, "fedora.asar");
    const result = await adaptDesktopLinux(archive, output);
    expect(result.changedFiles).toEqual(["dist/main.js"]);
    expect(result.retainedFiles).toBe(2);
    expect(extractFile(output, "LICENSE")).toEqual(extractFile(archive, "LICENSE"));
    expect(extractFile(output, "native/helper.node")).toEqual(extractFile(archive, "native/helper.node"));
    const native = statFile(output, "native/helper.node") as { unpacked?: boolean };
    expect(native.unpacked).toBe(true);
    const originalMode = (await stat(join(source, "native/helper.node"))).mode & 0o777;
    expect((await stat(output + ".unpacked/native/helper.node")).mode & 0o777).toBe(originalMode);
    if (process.platform !== "win32") expect(originalMode).toBe(0o755);
    expect(extractFile(output, "dist/main.js").toString()).toBe(patchDesktopMain(original));
  });
});
