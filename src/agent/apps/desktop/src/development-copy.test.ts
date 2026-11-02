import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevelopmentCopy } from "./development-copy.js";

let root: string, source: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mc-development-copy-"));
  source = path.join(root, "source");
  const workspace = path.join(source, "src/agent");
  await mkdir(path.join(workspace, "scripts"), { recursive: true });
  await mkdir(path.join(workspace, "apps/web"), { recursive: true });
  await mkdir(path.join(workspace, "packages"));
  await writeFile(path.join(workspace, "scripts/desktop-development.mjs"), "// runner");
  await writeFile(path.join(workspace, "package.json"), '{"name":"any-fork"}');
  await writeFile(path.join(workspace, "apps/web/package.json"), '{"name":"web"}');
  await writeFile(
    path.join(workspace, "development-toolchain.json"),
    '{"name":"private-tools","private":true,"dependencies":{}}',
  );
  await writeFile(path.join(workspace, "apps/web/app.tsx"), "original");
  await writeFile(path.join(workspace, ".env"), "DO_NOT_COPY=fixture");
  await mkdir(path.join(workspace, "outputs"));
  await writeFile(path.join(workspace, "outputs/private.txt"), "private");
  for (const folder of [
    "local-server",
    "local-server.previous-123",
    "local-server.partial-build",
    "out",
  ]) {
    await mkdir(path.join(workspace, "apps/desktop", folder), { recursive: true });
    await writeFile(path.join(workspace, "apps/desktop", folder, "generated.exe"), "fixture");
  }
  await mkdir(path.join(workspace, "apps/desktop/src"), { recursive: true });
  await writeFile(path.join(workspace, "apps/desktop/src/local-native-stack.ts"), "// source");
});
afterEach(async () => {
  if (
    path.dirname(root) !== path.resolve(tmpdir()) ||
    !path.basename(root).startsWith("mc-development-copy-")
  )
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});
it("automatically creates an independent copy, omits state and preserves edits across reopen and source updates", async () => {
  const directory = path.join(root, "pc-a"),
    prepare = vi.fn(async () => {});
  const manager = new DevelopmentCopy(directory, async () => [source], prepare);
  const [first, second] = await Promise.all([manager.ensure(), manager.ensure()]);
  expect(first.root).toBe(second.root);
  expect(prepare).toHaveBeenCalledOnce();
  const edited = path.join(first.workspace, "apps/web/app.tsx");
  await writeFile(edited, "local edit");
  expect(await readFile(path.join(source, "src/agent/apps/web/app.tsx"), "utf8")).toBe("original");
  await expect(readFile(path.join(first.workspace, ".env"))).rejects.toThrow();
  await expect(readFile(path.join(first.workspace, "outputs/private.txt"))).rejects.toThrow();
  for (const folder of [
    "local-server",
    "local-server.previous-123",
    "local-server.partial-build",
    "out",
  ]) {
    await expect(
      readFile(path.join(first.workspace, "apps/desktop", folder, "generated.exe")),
    ).rejects.toThrow();
  }
  expect(
    await readFile(path.join(first.workspace, "apps/desktop/src/local-native-stack.ts"), "utf8"),
  ).toBe("// source");
  await writeFile(path.join(source, "src/agent/apps/web/app.tsx"), "source update");
  const reopened = await new DevelopmentCopy(directory, async () => [source], prepare).ensure();
  expect(await readFile(path.join(reopened.workspace, "apps/web/app.tsx"), "utf8")).toBe(
    "local edit",
  );
  const other = await new DevelopmentCopy(
    path.join(root, "pc-b"),
    async () => [source],
    async () => {},
  ).ensure();
  expect(await readFile(path.join(other.workspace, "apps/web/app.tsx"), "utf8")).toBe(
    "source update",
  );
});
it("preserves an unrecognized/replaced working folder instead of overwriting local work", async () => {
  const directory = path.join(root, "pc-a"),
    first = await new DevelopmentCopy(
      directory,
      async () => [source],
      async () => {},
    ).ensure();
  await rename(first.root, first.root + "-saved");
  await mkdir(first.root);
  await writeFile(path.join(first.root, "keep.txt"), "keep");
  await expect(
    new DevelopmentCopy(
      directory,
      async () => [source],
      async () => {},
    ).ensure(),
  ).rejects.toThrow("changed location");
  expect(await readFile(path.join(first.root, "keep.txt"), "utf8")).toBe("keep");
});
