import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { macosSelfUpdateBundle } from "./manual-update-macos";

const helper = path.join(import.meta.dirname, "manual-update-macos.sh");
const run = promisify(execFile);

it("replaces only a writable, non-translocated app bundle", () => {
  const exe = "/Applications/Mycellios Desktop.app/Contents/MacOS/Mycellios Desktop";
  expect(macosSelfUpdateBundle(exe, () => true)).toBe("/Applications/Mycellios Desktop.app");
  expect(macosSelfUpdateBundle(exe, file => file !== "/Applications")).toBeNull();
  expect(macosSelfUpdateBundle(exe, file => file !== "/Applications/Mycellios Desktop.app")).toBeNull();
  expect(macosSelfUpdateBundle("/private/var/folders/x/AppTranslocation/1/d/Mycellios Desktop.app/Contents/MacOS/Mycellios Desktop", () => true)).toBeNull();
  expect(macosSelfUpdateBundle("/usr/local/bin/mycellios", () => true)).toBeNull();
});

it("verifies the disk image and keeps the previous app until the new one opens", async () => {
  const text = await readFile(helper, "utf8");
  expect(text).not.toMatch(/xattr|com.apple.quarantine|spctl|sudo/);
  expect(text).toContain("codesign --verify --deep --strict");
  expect(text).toContain("CFBundleIdentifier");
  expect(text).toContain("CFBundleShortVersionString");
  expect(text.indexOf('mv "$bundle" "$previous"')).toBeLessThan(text.indexOf('mv "$staged" "$bundle"'));
  expect(text.indexOf('/usr/bin/open "$bundle" ||')).toBeLessThan(text.indexOf('rm -rf "$previous"\nresult'));
  await run("bash", ["-n", helper]);
});

it.skipIf(process.platform === "win32")("refuses a missing disk image without reopening or touching the app", async () => {
  const job = await mkdtemp(path.join(os.tmpdir(), "macos-update-"));
  try {
    await expect(run("bash", [helper, job, "1", path.join(job, "missing.dmg"), "/Applications/Example.app", "1.2.3", "com.example"]))
      .rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await readFile(path.join(job, "result.json"), "utf8"))).toEqual({
      installed: false, phase: "preflight", error: "Missing disk image" });
  } finally { await rm(job, { recursive: true, force: true }); }
});
