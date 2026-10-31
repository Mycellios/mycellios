import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const namespaceArguments = [
  "--unshare-all", "--die-with-parent", "--uid", "0", "--gid", "0",
  "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib64", "/lib64",
  "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/run", "--dir", "/run/lock",
  "--clearenv", "--setenv", "PATH", "/test/commands:/usr/bin",
];
const sandboxAvailable = process.platform === "linux" && spawnSync("bwrap", [...namespaceArguments, "/usr/bin/true"], { stdio: "ignore" }).status === 0;

function command(name: string, args: string[], cwd?: string) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mycellios-runtime-fedora-")); roots.push(root);
  for (const directory of ["control", "data", "etc", "opt", "commands"]) await mkdir(join(root, directory));
  await writeFile(join(root, "control/control"), "Package: mycellios-node\nArchitecture: amd64\nVersion: 0.2.95\n");
  // All root-visible paths below are temporary bind mounts. No network is available.
  const files: Record<string, string> = {
    "data/opt/mycellios/bin/node": '#!/bin/sh\nscript=$1; shift; exec /bin/sh "$script" "$@"\n',
    "data/opt/mycellios/app/node/install-main.js": '#!/bin/sh\n[ "$1" = --install-root ] && [ "$2" = /opt/mycellios ] && [ "$3" = --enrollment ] && [ "$4" = /test/grant.json ] || exit 90\nmkdir -p /etc/mycellios\nprintf \'{"nodeId":"fixture"}\\n\' > /etc/mycellios/node.json\n',
    "commands/systemctl": '#!/bin/sh\n[ "$1" = is-active ] && [ "$2" = --quiet ] && [ "$3" = mycellios-node.service ]\n',
    "describe-runtime.sh": '#!/bin/sh\n[ -f /etc/mycellios/node.json ]\n',
    "grant.json": '{"enrollmentId":"fixture"}',
  };
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path); await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents); await chmod(file, 0o755);
  }
  await copyFile(resolve("deploy/linux/install-desktop-runtime.sh"), join(root, "install-runtime.sh"));
  command("tar", ["-czf", join(root, "control.tar.gz"), "-C", join(root, "control"), "."]);
  command("tar", ["-czf", join(root, "data.tar.gz"), "-C", join(root, "data"), "."]);
  await writeFile(join(root, "debian-binary"), "2.0\n");
  command("ar", ["r", "runtime.deb", "debian-binary", "control.tar.gz", "data.tar.gz"], root);
  const hash = createHash("sha256").update(await readFile(join(root, "runtime.deb"))).digest("hex");
  const execute = (expected = hash) => spawnSync("bwrap", [...namespaceArguments,
    "--ro-bind", root, "/test", "--bind", join(root, "etc"), "/etc", "--bind", join(root, "opt"), "/opt",
    "/bin/sh", "/test/install-runtime.sh", "/test/runtime.deb", expected, "/test/grant.json",
  ], { encoding: "utf8", timeout: 15_000 });
  return { root, execute };
}

describe.skipIf(!sandboxAvailable)("Fedora runtime enrollment in an isolated user namespace", () => {
  it("extracts the pinned payload and invokes enrollment without dpkg", async () => {
    const { root, execute } = await fixture();
    const result = execute();
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(root, "etc/mycellios/node.json"), "utf8")).toContain('"nodeId":"fixture"');
    await access(join(root, "opt/mycellios/bin/node"));
  });

  it("preserves an existing enrolled identity", async () => {
    const { root, execute } = await fixture();
    await mkdir(join(root, "etc/mycellios"));
    await writeFile(join(root, "etc/mycellios/node.json"), "existing account identity");
    expect(execute().status).toBe(22);
    expect(await readFile(join(root, "etc/mycellios/node.json"), "utf8")).toBe("existing account identity");
    await expect(access(join(root, "opt/mycellios"))).rejects.toThrow();
  });

  it("rejects a changed payload before extracting or enrolling", async () => {
    const { root, execute } = await fixture();
    expect(execute("0".repeat(64)).status).toBe(25);
    await expect(access(join(root, "opt/mycellios"))).rejects.toThrow();
    await expect(access(join(root, "etc/mycellios"))).rejects.toThrow();
  });

  it("refuses to overwrite an incomplete installation", async () => {
    const { root, execute } = await fixture();
    await mkdir(join(root, "opt/mycellios"));
    await writeFile(join(root, "opt/mycellios/keep"), "existing data");
    expect(execute().status).toBe(28);
    expect(await readFile(join(root, "opt/mycellios/keep"), "utf8")).toBe("existing data");
  });
});
