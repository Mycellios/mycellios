import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { ProjectWorkspaces } from "./project-workspaces.js";

const exec = promisify(execFile);
it("creates parallel conversation worktrees, retains dirty source files and recovers the same owned worktree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mycellios-projects-"));
  const git = async (...args: string[]) => (await exec("git", ["-C", root, ...args], { windowsHide: true })).stdout.trim();
  try {
    await git("init"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
    const nested = "src/projects/account/dashboard/features/settings/profile/notifications/components/project-conversation-preferences/index.ts";
    await mkdir(path.dirname(path.join(root, nested)), { recursive: true }); await writeFile(path.join(root, nested), "deep tracked file");
    await writeFile(path.join(root, "app.txt"), "baseline"); await git("add", "app.txt", nested); await git("commit", "-m", "fixture");
    await writeFile(path.join(root, "app.txt"), "uncommitted owner changes");
    const storage = path.join(root, ".native-fixture"), manager = new ProjectWorkspaces(storage);
    let picks = 0;
    const choose = async () => { picks++; return root; };
    const validate = async () => {};
    const [one, two] = await Promise.all([
      manager.prepare("account-space", "project", "one", choose, validate),
      manager.prepare("account-space", "project", "two", choose, validate),
    ]);
    expect(picks).toBe(1); expect(one).not.toBe(two);
    expect(path.basename(one!)).toHaveLength(32);
    expect(await readFile(path.join(one!, "app.txt"), "utf8")).toBe("baseline");
    expect(await readFile(path.join(one!, nested), "utf8")).toBe("deep tracked file");
    await Promise.all([writeFile(path.join(one!, "app.txt"), "first"), writeFile(path.join(two!, "app.txt"), "second")]);
    expect(await readFile(path.join(root, "app.txt"), "utf8")).toBe("uncommitted owner changes");
    expect(await readFile(path.join(one!, "app.txt"), "utf8")).toBe("first");
    const legacy = path.join(path.dirname(one!), createHash("sha256").update(JSON.stringify("one")).digest("hex"));
    await git("worktree", "move", one!, legacy);
    await copyFile(one! + ".json", legacy + ".json");
    expect(await new ProjectWorkspaces(storage).prepare("account-space", "project", "one", choose, validate)).toBe(legacy);
    expect(await readFile(path.join(two!, "app.txt"), "utf8")).toBe("second");
    const reopened = new ProjectWorkspaces(storage);
    expect(await reopened.prepare("account-space", "project", "one", async () => { throw Error("must not ask again"); }, validate)).toBe(legacy);
    expect(await readFile(path.join(legacy, "app.txt"), "utf8")).toBe("first");
    expect(await reopened.prepare("another-owner", "project", "one", async () => null, validate)).toBeNull();
    await expect(reopened.prepare("account-space", "project", "three", choose, async () => { throw Error("revoked"); })).rejects.toThrow("revoked");
    expect(await readdir(storage)).toHaveLength(2);
  } finally {
    if (!path.basename(root).startsWith("mycellios-projects-")) throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30000);
