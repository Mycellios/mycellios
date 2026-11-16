import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { windowIcon } from "./window-icon";

it("finds the packaged dist/assets icon before a development fallback", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mycellios-icon-"));
  try {
    const compiled = path.join(root, "app.asar", "dist");
    mkdirSync(path.join(compiled, "assets"), { recursive: true });
    const png = path.join(compiled, "assets", "icon.png");
    writeFileSync(png, "fixture");
    expect(windowIcon(compiled, root, "win32")).toBe(png);
    expect(windowIcon(compiled, root, "linux")).toBe(png);
    expect(windowIcon(compiled, root, "darwin")).toBeUndefined();
    mkdirSync(path.join(root, "assets"));
    const mac = path.join(root, "assets", "icon-macos.png");
    writeFileSync(mac, "fixture");
    expect(windowIcon(compiled, root, "darwin")).toBe(mac);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
