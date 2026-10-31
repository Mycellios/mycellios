import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Packaging tooling intentionally runs as JavaScript without a product dependency.
// @ts-expect-error This standalone release script has no application declarations.
import { buildDesktopRpm, sha256, validateRelease, verifyPinnedFile } from "../scripts/build-desktop-rpm.mjs";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function command(name: string, args: string[], cwd?: string) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}

async function fixture(version = "0.3.9") {
  const root = await mkdtemp(join(tmpdir(), "mycellios-fedora-")); temporary.push(root);
  const control = join(root, "control"); const data = join(root, "data");
  await mkdir(control);
  await writeFile(join(control, "control"), `Package: mycellios-desktop\nVersion: ${version}\nArchitecture: amd64\n`);
  const runtimeContents = "unchanged pinned runtime";
  const files: Record<string, string> = {
    "opt/Mycellios Desktop/resources/app.asar": "unchanged upstream application",
    "opt/Mycellios Desktop/resources/contribution/mycellios-runtime.deb": runtimeContents,
    "opt/Mycellios Desktop/resources/contribution/install-runtime.sh": "original Debian helper",
    "opt/Mycellios Desktop/chrome-sandbox": "sandbox fixture",
    "opt/Mycellios Desktop/mycellios-desktop": "executable fixture",
    "usr/share/applications/mycellios-desktop.desktop": "[Desktop Entry]\nType=Application\nName=Mycellios Desktop\n",
  };
  files["opt/Mycellios Desktop/resources/contribution/runtime.json"] = JSON.stringify({
    schema: "mycellios-desktop-runtime/1", file: "mycellios-runtime.deb",
    sha256: createHash("sha256").update(runtimeContents).digest("hex"),
  });
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(data, path)), { recursive: true }); await writeFile(join(data, path), contents);
  }
  command("tar", ["-czf", join(root, "control.tar.gz"), "-C", control, "."]);
  command("tar", ["-czf", join(root, "data.tar.gz"), "-C", data, "."]);
  await writeFile(join(root, "debian-binary"), "2.0\n");
  const deb = join(root, "desktop.deb"); const source = join(root, "source.tar.gz");
  command("ar", ["r", deb, "debian-binary", "control.tar.gz", "data.tar.gz"], root);
  await writeFile(source, "source fixture");
  const release = {
    version: "0.3.9", runtimeVersion: "0.2.95", baseline: "1".repeat(40),
    desktop: { url: "https://www.mycellios.com/downloads/desktop/releases/0.3.9/desktop.deb", sha256: await sha256(deb) },
    source: { url: "https://www.mycellios.com/downloads/desktop/releases/0.3.9/source.tar.gz", sha256: await sha256(source) },
  };
  return { root, deb, source, release, outputDirectory: join(root, "output"), installer: resolve("deploy/linux/install-desktop-runtime.sh") };
}

const packagingAvailable = process.platform === "linux" && ["ar", "tar", "rpm", "rpmbuild", "rpm2cpio", "cpio"]
  .every(name => !spawnSync(name, ["--version"], { stdio: "ignore" }).error);

describe.skipIf(!packagingAvailable)("Fedora Desktop packaging", () => {
  it("rejects modified inputs and release URLs outside the pinned version", async () => {
    const input = await fixture();
    await writeFile(input.deb, "tampered payload");
    await expect(verifyPinnedFile(input.deb, input.release.desktop.sha256)).rejects.toThrow("hash_mismatch");
    input.release.desktop.url = "https://www.mycellios.com/downloads/desktop/releases/0.3.8/desktop.deb";
    expect(() => validateRelease(input.release)).toThrow("invalid_release_artifact");
  });

  it("refuses an input package whose metadata does not match the release", async () => {
    const input = await fixture("0.3.8");
    await expect(buildDesktopRpm(input)).rejects.toThrow("control_mismatch:Version");
  });

  it("produces an RPM retaining application/runtime bytes, native dependencies and the enrollment helper", async () => {
    const input = await fixture();
    const result = await buildDesktopRpm(input);
    expect(command("rpm", ["-qp", "--qf", "%{NAME}|%{VERSION}|%{ARCH}", result.rpm])).toBe("mycellios-desktop|0.3.9|x86_64");
    const requires = command("rpm", ["-qp", "--requires", result.rpm]);
    expect(requires).toContain("polkit"); expect(requires).toContain("binutils");
    expect(requires).not.toMatch(/dpkg|policykit-1|libgtk-3-0/);
    const cpio = spawnSync("rpm2cpio", [result.rpm]);
    expect(cpio.status).toBe(0);
    const extracted = join(input.root, "extracted"); await mkdir(extracted);
    const unpacked = spawnSync("cpio", ["-idm", "--quiet", "--no-absolute-filenames"], { cwd: extracted, input: cpio.stdout });
    expect(unpacked.status, unpacked.stderr.toString()).toBe(0);
    const resources = join(extracted, "opt/Mycellios Desktop/resources");
    expect(await sha256(join(resources, "app.asar"))).toBe(result.provenance.applicationSha256);
    expect(await sha256(join(resources, "contribution/mycellios-runtime.deb"))).toBe(result.provenance.runtimeSha256);
    const helper = await readFile(join(resources, "contribution/install-runtime.sh"), "utf8");
    expect(helper).toContain("--enrollment"); expect(helper).not.toContain("dpkg -i");
    const scripts = command("rpm", ["-qp", "--scripts", result.rpm]);
    expect(scripts).not.toMatch(/systemctl.*(?:start|enable)|rm.*mycellios|no-sandbox/);
    expect(await readFile(`${result.rpm}.sha256`, "utf8")).toContain(await sha256(result.rpm));
  }, 30_000);
});
