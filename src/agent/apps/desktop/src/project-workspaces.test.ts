import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { isGitProjectRoot, ProjectWorkspaces } from "./project-workspaces.js";

const exec = promisify(execFile);
it("creates parallel conversation worktrees, retains dirty source files and recovers the same owned worktree", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mycellios-projects-"));
  const git = async (...args: string[]) => (await exec("git", ["-C", root, ...args], { windowsHide: true })).stdout.trim();
  try {
    expect(await isGitProjectRoot(root)).toBe(false);
    await git("init"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
    expect(await isGitProjectRoot(root)).toBe(false);
    const nested = "src/projects/account/dashboard/features/settings/profile/notifications/components/project-conversation-preferences/index.ts";
    await mkdir(path.dirname(path.join(root, nested)), { recursive: true }); await writeFile(path.join(root, nested), "deep tracked file");
    await writeFile(path.join(root, "app.txt"), "baseline"); await git("add", "app.txt", nested); await git("commit", "-m", "fixture");
    expect(await isGitProjectRoot(root)).toBe(true);
    expect(await isGitProjectRoot(path.join(root, "src"))).toBe(false);
    const sourceBranch = await git("branch", "--show-current");
    const sourceCommit = await git("rev-parse", "HEAD");
    await git("config", "branch.autoSetupMerge", "always");
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
    const oneBranch = await git("-C", one!, "branch", "--show-current");
    const twoBranch = await git("-C", two!, "branch", "--show-current");
    expect(oneBranch).toMatch(/^mycellios\/task-[0-9a-f]{32}$/);
    expect(twoBranch).not.toBe(oneBranch);
    expect(await git("-C", one!, "for-each-ref", "--format=%(upstream:short)", "refs/heads/" + oneBranch)).toBe("");
    expect(await readFile(path.join(one!, "app.txt"), "utf8")).toBe("baseline");
    expect(await readFile(path.join(one!, nested), "utf8")).toBe("deep tracked file");
    await Promise.all([writeFile(path.join(one!, "app.txt"), "first"), writeFile(path.join(two!, "app.txt"), "second")]);
    expect(await readFile(path.join(root, "app.txt"), "utf8")).toBe("uncommitted owner changes");
    expect(await readFile(path.join(one!, "app.txt"), "utf8")).toBe("first");
    const remote = path.join(root, "remote.git");
    await git("init", "--bare", remote);
    await git("remote", "add", "origin", remote);
    await git("-C", one!, "add", "app.txt");
    await git("-C", one!, "commit", "-m", "task work");
    const taskCommit = await git("-C", one!, "rev-parse", "HEAD");
    await git("-C", one!, "push", "--set-upstream", "origin", "HEAD");
    await git("-C", one!, "pull", "--ff-only");
    expect(await git("--git-dir", remote, "rev-parse", "refs/heads/" + oneBranch)).toBe(taskCommit);
    expect(await git("--git-dir", remote, "for-each-ref", "--format=%(refname:short)", "refs/heads")).toBe(oneBranch);
    expect(await git("branch", "--show-current")).toBe(sourceBranch);
    expect(await git("rev-parse", "HEAD")).toBe(sourceCommit);
    const legacy = path.join(path.dirname(one!), createHash("sha256").update(JSON.stringify("one")).digest("hex"));
    await git("worktree", "move", one!, legacy);
    await git("-C", legacy, "switch", "--detach");
    await git("branch", "-D", oneBranch);
    const { common, threadId } = JSON.parse(await readFile(one! + ".json", "utf8"));
    await writeFile(legacy + ".json", JSON.stringify({ common, threadId }));
    await writeFile(path.join(legacy, "app.txt"), "old detached edits");
    await git("-C", legacy, "add", "app.txt");
    expect(await new ProjectWorkspaces(storage).prepare("account-space", "project", "one", choose, validate)).toBe(legacy);
    expect(await git("-C", legacy, "branch", "--show-current")).toBe(oneBranch);
    expect(await git("-C", legacy, "rev-parse", "HEAD")).toBe(taskCommit);
    expect(await git("-C", legacy, "diff", "--cached", "--name-only")).toBe("app.txt");
    expect(await readFile(path.join(two!, "app.txt"), "utf8")).toBe("second");
    const reopened = new ProjectWorkspaces(storage);
    expect(await reopened.prepare("account-space", "project", "one", async () => { throw Error("must not ask again"); }, validate)).toBe(legacy);
    expect(await readFile(path.join(legacy, "app.txt"), "utf8")).toBe("old detached edits");
    expect(await reopened.prepare("another-owner", "project", "one", async () => null, validate)).toBeNull();
    await expect(reopened.prepare("account-space", "project", "three", choose, async () => { throw Error("revoked"); })).rejects.toThrow("revoked");
    expect(await readdir(storage)).toHaveLength(2);
  } finally {
    if (!path.basename(root).startsWith("mycellios-projects-")) throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 30000);
